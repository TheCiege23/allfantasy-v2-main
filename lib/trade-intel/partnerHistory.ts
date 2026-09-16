import 'server-only'

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { buildRosterIdMap } from '@/lib/core-app/rosterIdMatch'
import type { RankingTradeHistory } from '@/lib/trade-intel/partnerRanking'

/**
 * Completed-trade history for one league, in `Roster.id` space — the history component of the
 * partner ranking.
 *
 * ── TWO LEDGERS, BECAUSE TRADES LIVE IN TWO PLACES ──────────────────────────────────────────────
 *
 *   `dw_transaction_facts` (type 'trade') — imported leagues, every provider. Keyed by the
 *     PROVIDER roster id (`LeagueTeam.externalId`), one row per side or per moved asset.
 *   `AfLeagueTrade` (status 'processed') — native leagues, already in `Roster.id` space.
 *
 * ⚠ A TRADE IS A GROUP OF FACT ROWS, NOT A ROW. Writers emit one row per party (Sleeper) or per
 * moved asset (ESPN, Yahoo, MFL, Fantrax, import commit), so rows are grouped by the provider's own
 * transaction id and each group counts once per party. The id lives under a provider-specific key;
 * all of them are listed below. `importedTradeLedgerService.providerTransactionId` reads only the
 * Yahoo/ESPN keys — a narrower copy of this rule, left as it is and noted here.
 *
 * ⚠ ONLY THE KEYS ARE READ, IN SQL. Payloads carry whole add/drop lists; a league's trade facts
 * fetched as full JSON would ship megabytes to count a few hundred trades.
 */

/** Every payload key a trade-fact writer uses for the provider transaction id. */
const TRANSACTION_ID_KEYS = [
  'sleeperTransactionId',
  'providerTransactionId',
  'espnTransactionId',
  'yahooTransactionId',
  'mflTransactionId',
  'fantraxTransactionId',
  'transactionId',
] as const

/**
 * Statuses that are NOT a completed trade. Absent status counts as completed: the Sleeper sweep
 * only ever writes `complete` facts, and older rows predate the field.
 */
const NOT_COMPLETED = new Set(['pending', 'proposed', 'failed', 'rejected', 'declined', 'vetoed', 'canceled', 'cancelled', 'expired'])

/** Most recent facts considered. A league's whole trade history is far below this. */
const FACT_LIMIT = 5000

export type TradeFactRow = {
  factId: string
  rosterId: string | null
  tradeKey: string | null
  rosterIds: unknown
  status: string | null
}

/**
 * Pure: facts and native trades in, per-roster counts out. `null` when there is nothing to say
 * whether this league's history was ever synced — see `loadLeagueTradeHistory`.
 */
export function summarizeTradeHistory(args: {
  facts: TradeFactRow[]
  nativeTrades: Array<{ id: string; proposerRosterId: string; receiverRosterId: string }>
  /** Provider roster id (`LeagueTeam.externalId`) → `Roster.id`, padding-safe. */
  rosterIdByProviderId: Map<string, string>
  viewerRosterId: string
}): RankingTradeHistory {
  const parties = new Map<string, Set<string>>()
  const add = (key: string, rosterId: string | undefined) => {
    if (!rosterId) return
    const set = parties.get(key) ?? new Set<string>()
    set.add(rosterId)
    parties.set(key, set)
  }

  for (const f of args.facts) {
    if (f.status && NOT_COMPLETED.has(f.status.toLowerCase())) continue
    // A row with no transaction id is still one trade for its own roster — it just cannot be paired.
    const key = f.tradeKey ? `fact:${f.tradeKey}` : `row:${f.factId}`
    if (f.rosterId != null) add(key, args.rosterIdByProviderId.get(String(f.rosterId)))
    if (Array.isArray(f.rosterIds)) {
      for (const id of f.rosterIds) add(key, args.rosterIdByProviderId.get(String(id)))
    }
  }
  for (const t of args.nativeTrades) {
    add(`native:${t.id}`, t.proposerRosterId)
    add(`native:${t.id}`, t.receiverRosterId)
  }

  const tradesByRoster = new Map<string, number>()
  const tradesWithViewer = new Map<string, number>()
  for (const set of parties.values()) {
    for (const rosterId of set) tradesByRoster.set(rosterId, (tradesByRoster.get(rosterId) ?? 0) + 1)
    if (set.has(args.viewerRosterId)) {
      for (const rosterId of set) {
        if (rosterId !== args.viewerRosterId) tradesWithViewer.set(rosterId, (tradesWithViewer.get(rosterId) ?? 0) + 1)
      }
    }
  }
  return { tradesByRoster, tradesWithViewer }
}

/**
 * Load and summarise. Returns `null` — "history not on file" — when the league has NO transaction
 * facts of any type and no native trades: that is a league whose history was never synced, and
 * reporting it as "nobody here trades" would be a claim about managers we have not looked at.
 * A synced league with zero trades returns empty maps, which the ranking reads as a real zero.
 */
export async function loadLeagueTradeHistory(args: {
  leagueId: string
  viewerRosterId: string
  /**
   * A native league's trades ARE `AfLeagueTrade` — there is no sync to have missed — so its history
   * is always on file, and zero processed trades is a real zero.
   */
  isNative: boolean
  /** `{ externalId, rosterId }` for every team in the league. */
  teams: Array<{ externalId: string; rosterId: string }>
}): Promise<RankingTradeHistory | null> {
  const keyExpr = Prisma.raw(
    `COALESCE(${TRANSACTION_ID_KEYS.map((k) => `payload->>'${k}'`).join(', ')})`,
  )
  const [facts, nativeTrades, anyFact] = await Promise.all([
    prisma.$queryRaw<TradeFactRow[]>(Prisma.sql`
      SELECT "transactionId" AS "factId",
             "rosterId",
             ${keyExpr} AS "tradeKey",
             payload->'rosterIds' AS "rosterIds",
             payload->>'status' AS status
      FROM "dw_transaction_facts"
      WHERE "leagueId" = ${args.leagueId} AND type = 'trade'
      ORDER BY "createdAt" DESC
      LIMIT ${FACT_LIMIT}
    `),
    prisma.afLeagueTrade.findMany({
      where: { leagueId: args.leagueId, status: 'processed' },
      select: { id: true, proposerRosterId: true, receiverRosterId: true },
      take: 1000,
    }),
    prisma.transactionFact.findFirst({ where: { leagueId: args.leagueId }, select: { transactionId: true } }),
  ])

  if (!args.isNative && facts.length === 0 && nativeTrades.length === 0 && !anyFact) return null

  return summarizeTradeHistory({
    facts,
    nativeTrades,
    rosterIdByProviderId: buildRosterIdMap(args.teams, (t) => t.externalId, (t) => t.rosterId),
    viewerRosterId: args.viewerRosterId,
  })
}
