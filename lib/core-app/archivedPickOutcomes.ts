import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { TRADE_GRADES_CACHE_PREFIX } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { LedgerTradeSide } from './archivedPickMatch'

/**
 * What each used pick in an ARCHIVED trade row became — read from the league's graded ledger.
 *
 * 🛑 WHY THE LEDGER AND NOT A SECOND RESOLVER. An archived `LeagueTrade` row stores a pick as
 * `{ season, round }` and nothing else (`tradePicks.ts` says why), so it cannot say which draft slot
 * the pick was — and the slot is the whole answer. The graded ledger (`trade-grades:v2:<league>`)
 * already resolved every pick of every Sleeper trade from the draft results, by the pick's original
 * owner, with the rerouted case handled (`sleeperTradeGradeService.ts`). Reading its answer keeps
 * ONE rule for what a pick became, which is the rule the grade emails and the live /core history use.
 *
 * DB-only: no provider call. A league whose ledger has not been built yet, or a platform with no
 * ledger (Yahoo, ESPN, MFL), gets nothing back and its picks are graded exactly as before.
 *
 * ⚠ ONE QUERY, AND ONLY THE PICK FIELDS. A ledger row holds a league's whole trade history with
 * per-season points; reading whole rows for every league on the board would move megabytes to use a
 * few names. Postgres unnests `data->'trades'` and returns just the sides' picks for the requested
 * transaction ids.
 *
 * ⚠ THE LEDGER IS READ WHATEVER ITS `expiresAt` — it is history, rebuilt only when read through
 * `getTradeGrades`; the purge never takes the family (see `PURGEABLE_KEY_PREFIXES`).
 */

export type ArchivedPickRequest = {
  /** The Sleeper league id the ledger is keyed by (`LeagueTradeHistory.sleeperLeagueId`). */
  sleeperLeagueId: string
  transactionId: string
}

type LedgerRow = { sleeperLeagueId: string; transactionId: string; sides: unknown }

export async function loadLedgerSidesForTrades(
  requests: ReadonlyArray<ArchivedPickRequest>,
): Promise<Map<string, LedgerTradeSide[]>> {
  const out = new Map<string, LedgerTradeSide[]>()
  const keys = [...new Set(requests.map((r) => r.sleeperLeagueId).filter(Boolean))].map((id) => `${TRADE_GRADES_CACHE_PREFIX}${id}`)
  const txIds = [...new Set(requests.map((r) => r.transactionId).filter(Boolean))]
  if (keys.length === 0 || txIds.length === 0) return out

  /*
   * ⚠ `::int` ON THE OFFSET IS LOAD-BEARING. Prisma binds a JS number as bigint, Postgres has no
   * `substring(text, bigint)`, and the failure is caught below — so without the cast this read fails
   * on every call and quietly changes nothing. Found by running it against the test database.
   *
   * A try, not `.catch`: a client without `$queryRaw` (a test double) throws before any promise
   * exists, and a ledger that cannot be read must cost the drafted names, never the page.
   */
  let rows: LedgerRow[] = []
  try {
    rows = await prisma.$queryRaw<LedgerRow[]>(Prisma.sql`
      SELECT substring(c."key" from ${TRADE_GRADES_CACHE_PREFIX.length + 1}::int) AS "sleeperLeagueId",
             split_part(t->>'id', ':', 2) AS "transactionId",
             COALESCE((
               SELECT jsonb_agg(jsonb_build_object(
                 'rosterId', s->'rosterId',
                 'picksIn', COALESCE(s->'picksIn', '[]'::jsonb),
                 'picksOut', COALESCE(s->'picksOut', '[]'::jsonb)))
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t->'sides') = 'array' THEN t->'sides' ELSE '[]'::jsonb END) s
             ), '[]'::jsonb) AS "sides"
      FROM "SportsDataCache" c
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.data->'trades') = 'array' THEN c.data->'trades' ELSE '[]'::jsonb END
      ) t
      WHERE c."key" = ANY(${keys}::text[])
        AND split_part(t->>'id', ':', 2) = ANY(${txIds}::text[])
    `)
  } catch (err) {
    console.warn('[archived-picks] ledger read failed', { name: err instanceof Error ? err.name : typeof err })
  }

  for (const row of rows) {
    if (Array.isArray(row.sides)) out.set(ledgerKey(row.sleeperLeagueId, row.transactionId), row.sides as LedgerTradeSide[])
  }
  return out
}

export function ledgerKey(sleeperLeagueId: string, transactionId: string): string {
  return `${sleeperLeagueId}:${transactionId}`
}

