import 'server-only'

import { createHash } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import type { GradedTrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

/**
 * The trades card's computed grades, kept so the next open does not grade the same trades again (2026-11-23).
 *
 * WHY. Measured on the owner's 91-league cold open (13:34Z 11-23): of 20 visible trades, 11 already had their
 * original stored and 9 never get a letter, yet grading still took 5.0–7.2s of a 9–13s card. Every open rebuilds a
 * grader per league and re-grades every trade at today's values to show today's letter beside the original. That
 * work repeats on every open, and the owner's opens are hours apart, longer than the grader's own 5-minute memo.
 *
 * WHAT IS CACHED is exactly what `oneGradeForCompletedTrade` returns for one trade: THE grade (the stored original,
 * with today's letter beside it when it moved) or the reason there is no letter. Nothing viewer-shaped is cached.
 * One row per AF league (`sportsDataCache`), holding that league's visible trades.
 *
 * ⚠ WHY IT CANNOT SERVE THE WRONG TRADE'S GRADE. Each entry carries a fingerprint of everything the grade is computed
 * from on the trade itself: its id, completion time, the managers, and every player, pick (and what the pick became)
 * and FAAB amount on each side. Any difference is a miss. A grade that FAILED, or whose original could not be saved,
 * is never written.
 *
 * ⚠ WHAT IT TRADES AWAY, said rather than hidden: the league's values. Today's letter beside a stored original, and a
 * "no value on this league's chart" reason, are read off the league's chart, and a cached entry may be up to
 * `STALE_MS` old. Up to `FRESH_MS` it is served as-is (the trade history page reuses its grades for the same time).
 * Between the two it is served and then re-graded in the background, so the NEXT open has today's values. The same
 * window the matchup rail's boards use (`ROSTER_WEEK_BOARD_SERVE_STALE_MS`). The stored ORIGINAL is unaffected: it
 * lives in `trade_analysis_snapshots` and never changes.
 *
 * Failure-contained both ways: a read that fails is a miss, a write that fails is dropped.
 */

const KEY_PREFIX = 'core-trade-grades:v1:'
/** Served as-is for this long. Same as the trade history page's own grade reuse. */
export const CORE_TRADE_GRADE_FRESH_MS = 10 * 60_000
/** Served, then re-graded in the background, up to this age. Same window as the matchup rail's boards. */
export const CORE_TRADE_GRADE_STALE_MS = 3 * 60 * 60_000

export type CachedCoreTradeGrade = { fp: string; at: string; grade: TradeGradeView }

type Entry = { version: 1; byTrade: Record<string, CachedCoreTradeGrade> }

export function coreTradeGradeKey(afLeagueId: string): string {
  return `${KEY_PREFIX}${afLeagueId}`
}

/**
 * Everything on the trade itself that its grade is computed from. Not the realized points, which change weekly.
 * Null when the trade cannot be read (a ledger written before a field existed): such a trade is graded every time and
 * never cached. ⚠ NEVER THROWS — it runs outside the grading's own failure containment, so a throw would cost the card.
 */
export function coreTradeGradeFingerprint(trade: GradedTrade, currentSeason: number): string | null {
  try {
    return fingerprint(trade, currentSeason)
  } catch {
    return null
  }
}

function fingerprint(trade: GradedTrade, currentSeason: number): string {
  const list = <T,>(xs: T[] | null | undefined): T[] => (Array.isArray(xs) ? xs : [])
  const player = (p: { playerId?: string | null; name?: string | null; position?: string | null }) => [p.playerId ?? null, p.name ?? null, p.position ?? null]
  const pick = (k: GradedTrade['sides'][number]['picksIn'][number]) => [
    k.season, k.round, k.originalRosterId ?? null, k.label, k.resolved ? player(k.resolved) : null,
  ]
  const shape = {
    s: currentSeason,
    id: trade.id,
    at: trade.createdIso,
    m: trade.multiTeam === true,
    sides: list(trade.sides).map((side) => [
      side.rosterId, side.managerName,
      list(side.playersIn).map(player), list(side.playersOut).map(player),
      list(side.picksIn).map(pick), list(side.picksOut).map(pick),
      side.faabIn ?? null, side.faabOut ?? null,
    ]),
  }
  return createHash('sha256').update(JSON.stringify(shape)).digest('base64url').slice(0, 22)
}

export type CoreTradeGradeHit = { grade: TradeGradeView; stale: boolean }

/** Every cached league entry for these AF leagues, by league. A failed read is an empty map. */
export async function readCoreTradeGrades(
  afLeagueIds: ReadonlyArray<string>,
  now: Date = new Date(),
): Promise<Map<string, Record<string, CachedCoreTradeGrade>>> {
  const out = new Map<string, Record<string, CachedCoreTradeGrade>>()
  const ids = [...new Set(afLeagueIds.filter(Boolean))]
  if (ids.length === 0) return out
  try {
    const rows = await prisma.sportsDataCache.findMany({
      where: { cacheKey: { in: ids.map(coreTradeGradeKey) }, expiresAt: { gt: now } },
      select: { cacheKey: true, data: true },
    })
    for (const row of rows) {
      const entry = row.data as Partial<Entry> | null
      if (!entry || entry.version !== 1 || !entry.byTrade || typeof entry.byTrade !== 'object') continue
      out.set(row.cacheKey.slice(KEY_PREFIX.length), entry.byTrade)
    }
  } catch {
    // A failed read grades every trade, as before.
  }
  return out
}

/** The cached grade for one trade, if its fingerprint matches and it is within the stale window. */
export function coreTradeGradeHit(
  entry: Record<string, CachedCoreTradeGrade> | undefined,
  tradeId: string,
  fp: string | null,
  now: Date = new Date(),
): CoreTradeGradeHit | null {
  if (!fp) return null
  const hit = entry?.[tradeId]
  if (!hit || hit.fp !== fp || !hit.grade) return null
  const age = now.getTime() - Date.parse(hit.at)
  if (!Number.isFinite(age) || age < 0 || age > CORE_TRADE_GRADE_STALE_MS) return null
  return { grade: hit.grade, stale: age > CORE_TRADE_GRADE_FRESH_MS }
}

/**
 * Write one league's newly computed grades, merged into what was read for it. Entries past the stale window are
 * dropped. Never throws. Two renders writing the same league at once: the last write wins, and the other's trades
 * are simply graded again on the next open.
 */
export async function writeCoreTradeGrades(
  afLeagueId: string,
  previous: Record<string, CachedCoreTradeGrade> | undefined,
  fresh: ReadonlyMap<string, CachedCoreTradeGrade>,
  now: Date = new Date(),
): Promise<void> {
  if (!afLeagueId || fresh.size === 0) return
  const byTrade: Record<string, CachedCoreTradeGrade> = {}
  for (const [id, hit] of Object.entries(previous ?? {})) {
    const age = now.getTime() - Date.parse(hit?.at ?? '')
    if (Number.isFinite(age) && age >= 0 && age <= CORE_TRADE_GRADE_STALE_MS) byTrade[id] = hit
  }
  for (const [id, hit] of fresh) byTrade[id] = hit
  const entry: Entry = { version: 1, byTrade }
  const cacheKey = coreTradeGradeKey(afLeagueId)
  const expiresAt = new Date(now.getTime() + CORE_TRADE_GRADE_STALE_MS)
  const data = JSON.parse(JSON.stringify(entry)) as object
  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey },
      update: { data, expiresAt },
      create: { cacheKey, data, expiresAt },
    })
  } catch {
    // A missed write costs the next open one grading pass, nothing more.
  }
}
