import 'server-only'

import { prisma } from '@/lib/prisma'
import type { TradeExpectation } from '@/lib/trade-intel/tradeExpectation'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

/**
 * The graded half of a Sleeper trade history, kept so a second load of the SAME history does not
 * grade it again (2026-11-06).
 *
 * WHAT IS CACHED is exactly what `getSleeperTradeHistory` computes per trade and nothing more: the
 * market projection (`loadTradeExpectation`) and THE grade (`oneGradeForCompletedTrade`). Everything
 * viewer-shaped — which side is "you", the media, the notice — is still built on every read from the
 * same ledger, so two managers in one league share one entry and still see their own side.
 *
 * ⚠ WHY IT CANNOT SERVE A WRONG HISTORY:
 *  - It is keyed to the LEDGER it was graded from. The entry records the graded ledger's `fetchedAt`,
 *    and any other `fetchedAt` is a miss — so the moment a new completed trade lands (the reconcile
 *    and the 5-minute sweep both force a rebuild, which re-stamps `fetchedAt`), the old grades are
 *    never read again.
 *  - Every trade in the read must be in the entry, or it is a miss for the whole history.
 *  - A grade that FAILED (a thrown chart read, a timed-out projection) is never written: the caller
 *    writes only a complete, failure-free set, so an outage is not frozen in for ten minutes.
 *
 * ⚠ WHAT IT DOES TRADE AWAY, said rather than hidden: the `current` re-grade beside each frozen
 * original, and the projection's roster-need note, can be up to `TTL_MS` old instead of computed this
 * second. Both are read off inputs that themselves change on hours (the market chart's own cache) or
 * on a manager's roster move. The frozen ORIGINAL is unaffected — it is frozen in
 * `trade_analysis_snapshots` the first time and read from there on every path.
 *
 * One row per AF league (`sportsDataCache`), overwritten in place; failure-contained both ways — a
 * read that fails is a miss and a write that fails is dropped. Neither can cost the screen anything.
 */

const KEY_PREFIX = 'trade-history-grades:v1:'
/** How long a graded history is reused for the same ledger. */
export const TRADE_HISTORY_GRADE_TTL_MS = 10 * 60 * 1000

export type CachedTradeGrade = {
  expectation: TradeExpectation | null
  leagueGrade: TradeGradeView | null
}

type Entry = {
  version: 1
  /** The graded ledger's `fetchedAt` these grades were computed from. */
  ledgerFetchedAt: string
  /** The season `oneGradeForCompletedTrade` priced against. */
  season: number
  byTrade: Record<string, CachedTradeGrade>
}

function keyFor(afLeagueId: string, sleeperLeagueId: string): string {
  return `${KEY_PREFIX}${afLeagueId}:${sleeperLeagueId}`
}

/** The cached grades for every one of `tradeIds`, or null — a miss for the whole history. */
export async function readTradeHistoryGrades(input: {
  afLeagueId: string
  sleeperLeagueId: string
  ledgerFetchedAt: string
  season: number
  tradeIds: ReadonlyArray<string>
  now?: Date
}): Promise<Map<string, CachedTradeGrade> | null> {
  try {
    const row = await prisma.sportsDataCache.findUnique({
      where: { cacheKey: keyFor(input.afLeagueId, input.sleeperLeagueId) },
      select: { data: true, expiresAt: true },
    })
    if (!row || row.expiresAt <= (input.now ?? new Date())) return null
    const entry = row.data as Partial<Entry> | null
    if (!entry || entry.version !== 1) return null
    if (entry.ledgerFetchedAt !== input.ledgerFetchedAt || entry.season !== input.season) return null
    const byTrade = entry.byTrade ?? {}
    const out = new Map<string, CachedTradeGrade>()
    for (const id of input.tradeIds) {
      const hit = byTrade[id]
      if (!hit) return null
      out.set(id, { expectation: hit.expectation ?? null, leagueGrade: hit.leagueGrade ?? null })
    }
    return out
  } catch {
    return null
  }
}

/** Store a COMPLETE, failure-free graded history. Never throws. */
export async function writeTradeHistoryGrades(input: {
  afLeagueId: string
  sleeperLeagueId: string
  ledgerFetchedAt: string
  season: number
  grades: ReadonlyMap<string, CachedTradeGrade>
  now?: Date
}): Promise<void> {
  const entry: Entry = {
    version: 1,
    ledgerFetchedAt: input.ledgerFetchedAt,
    season: input.season,
    byTrade: Object.fromEntries(input.grades),
  }
  const cacheKey = keyFor(input.afLeagueId, input.sleeperLeagueId)
  const expiresAt = new Date((input.now ?? new Date()).getTime() + TRADE_HISTORY_GRADE_TTL_MS)
  const data = JSON.parse(JSON.stringify(entry)) as object
  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey },
      update: { data, expiresAt },
      create: { cacheKey, data, expiresAt },
    })
  } catch {
    // A missed write costs the next read one grading pass, nothing more.
  }
}
