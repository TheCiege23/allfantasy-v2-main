import { Prisma, type PrismaClient } from '@prisma/client'

/**
 * FAAB FOR THE TRADES THAT WERE STORED WITHOUT IT (owner's call, 2026-11-22 — trade learning, FAAB for old seasons).
 *
 * Both Sleeper trade writers dropped `waiver_budget` until #4044, so `LeagueTrade.budgetGiven/Received` is null for
 * every older Sleeper trade. The transaction warehouse kept it all along, one row per (trade, roster):
 *   - the historical sync (`SleeperHistoricalTransactionSyncService`) stores `faabNet` — FAAB received minus sent by
 *     that roster, null when the trade moved none for it;
 *   - the live trade facts store `faabIn` / `faabOut`.
 * This fills the two columns from those rows, for empty rows only, and only where the answer is unambiguous:
 *   - the trade has EXACTLY TWO rosters' facts — with three or more a net figure cannot say who paid whom;
 *   - the row's own roster is the fact that is NOT its partner (`LeagueTrade.partnerRosterId`);
 *   - that roster's facts agree with each other (two writers stored it twice, the same way).
 * A `faabNet` of null on a fact that carries the key is a READ zero (the trade moved no FAAB for that roster); a fact
 * without either field says nothing and the row stays null.
 *
 * ⚠ A NET IS NOT TWO FLOWS. `faabNet` of +20 is stored as received 20, given 0. A trade where both sides sent FAAB
 * (rare) loses its gross figures — the value moved, which is what pricing needs, is exact.
 *
 * DB-first, no provider call: one bounded UPDATE per run, newest trades first. `TRADE_FAAB_BACKFILL=off` stops it.
 */

export const TRADE_FAAB_BACKFILL_ENV = 'TRADE_FAAB_BACKFILL'
/** Trade rows filled per run at most. */
export const TRADE_FAAB_BACKFILL_LIMIT = 5000

export function tradeFaabBackfillOn(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[TRADE_FAAB_BACKFILL_ENV] ?? '').trim().toLowerCase() !== 'off'
}

/** The SQL, exported so a test can run it against a real Postgres. */
export function tradeFaabBackfillSql(limit: number): Prisma.Sql {
  return Prisma.sql`
    WITH facts AS (
      SELECT payload->>'sleeperTransactionId' AS tx,
             "rosterId" AS roster,
             CASE
               WHEN payload ? 'faabIn' OR payload ? 'faabOut'
                 THEN COALESCE((payload->>'faabIn')::float, 0) - COALESCE((payload->>'faabOut')::float, 0)
               WHEN payload ? 'faabNet'
                 THEN COALESCE((payload->>'faabNet')::float, 0)
             END AS net,
             (payload ? 'faabIn' OR payload ? 'faabOut' OR payload ? 'faabNet') AS read
      FROM dw_transaction_facts
      WHERE type = 'trade' AND payload ? 'sleeperTransactionId' AND "rosterId" IS NOT NULL
    ),
    per_tx AS (
      SELECT tx, count(DISTINCT roster) AS rosters, bool_and(read) AS all_read FROM facts GROUP BY tx
    ),
    target AS (
      -- One row per trade side; a side whose own facts disagree (two writers, two answers) is left alone.
      SELECT lt.id, min(f.net) AS net
      FROM "LeagueTrade" lt
      JOIN per_tx p ON p.tx = lt."transactionId" AND p.rosters = 2 AND p.all_read
      JOIN facts f ON f.tx = lt."transactionId" AND f.roster <> lt."partnerRosterId"::text
      WHERE lt.platform = 'sleeper' AND lt."budgetGiven" IS NULL AND lt."budgetReceived" IS NULL
        AND lt."partnerRosterId" IS NOT NULL
      GROUP BY lt.id
      HAVING count(DISTINCT f.net) = 1
      ORDER BY max(lt."tradeDate") DESC NULLS LAST
      LIMIT ${limit}
    )
    UPDATE "LeagueTrade" lt
    -- ABS(LEAST(…)), not GREATEST(-net, 0): negating a float zero stores -0.
    SET "budgetReceived" = GREATEST(target.net, 0), "budgetGiven" = ABS(LEAST(target.net, 0))
    FROM target
    WHERE lt.id = target.id`
}

/** Fill empty FAAB columns on stored Sleeper trades from the transaction warehouse. Returns rows filled. */
export async function backfillTradeFaab(
  prisma: Pick<PrismaClient, '$executeRaw'>,
  opts: { env?: NodeJS.ProcessEnv; limit?: number } = {},
): Promise<{ off?: true; rowsFilled: number }> {
  if (!tradeFaabBackfillOn(opts.env)) return { off: true, rowsFilled: 0 }
  const rowsFilled = await prisma.$executeRaw(tradeFaabBackfillSql(opts.limit ?? TRADE_FAAB_BACKFILL_LIMIT))
  return { rowsFilled }
}
