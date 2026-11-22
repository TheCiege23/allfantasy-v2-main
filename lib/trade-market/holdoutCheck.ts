import { gatherFormatObservations } from './formatMarkets'
import {
  backtestNeed,
  backtestPicks,
  backtestPosture,
  cutoffAtShare,
  type DatedObservation,
  type LearnerBacktest,
} from './learnedMarketBacktest'
import type { NeedObservation } from './needMarketLearner'
import type { PickObservation } from './pickMarketLearner'
import type { PostureObservation } from './postureMarketLearner'

/**
 * A LEARNED NUMBER THAT DOES NOT HOLD ON LATER TRADES TURNS ITSELF OFF (owner's call, 2026-11-22: "act on the
 * backtest — turn off any switch whose numbers don't hold").
 *
 * The backtest (`learnedMarketBacktest.ts`) was a script someone had to run and read. This is the same check run by
 * the daily market job and STORED, per learner and per book: fit on the trades before a cutoff, then ask whether the
 * grade with the learned numbers lands closer to what the LATER trades cost than the grade without them.
 *
 *   held       closer, on enough later trades            -> the grades use it (if its switch is on)
 *   not_held   further, on enough later trades           -> the grades ignore that learner for that book
 *   unknown    too few later trades, or no difference    -> unchanged: the publish thresholds alone decide, as before
 *
 * 🛑 FAIL-SAFE DIRECTION. A missing, stale or unreadable verdict gates NOTHING — it can only ever switch a learner
 * OFF on positive evidence that it made grades worse. `TRADE_HOLDOUT_CHECK=off` stops the check being computed; with
 * no stored verdict the grades behave exactly as they did before this existed.
 *
 * ⚠ It answers "does the price match", not "did the trade work out" — see the backtest's own header.
 */

export const HOLDOUT_CACHE_KEY = 'af-trade-market:holdout:NFL'
export const TRADE_HOLDOUT_CHECK_ENV = 'TRADE_HOLDOUT_CHECK'
export const holdoutCheckOn = (env: NodeJS.ProcessEnv = process.env) => String(env[TRADE_HOLDOUT_CHECK_ENV] ?? '').trim().toLowerCase() !== 'off'

/** Later trades a learned row could move, below which a verdict is not given either way. */
export const HOLDOUT_MIN_TEST_TRADES = 30
const HOLDOUT_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000

export type HoldoutVerdict = 'held' | 'not_held' | 'unknown'
export type HoldoutLearner = LearnerBacktest['learner']
export type HoldoutRow = {
  learner: HoldoutLearner
  book: string
  verdict: HoldoutVerdict
  /** How much closer the learned grade was on later trades, in percent of the plain grade's error; null = not measurable. */
  improvementPct: number | null
  trainTrades: number
  /** Later trades a published row could move — what the verdict rests on. */
  testTrades: number
  publishedRows: number
  flippedRows: number
}
export type HoldoutDoc = { generatedAt: string; cutoff: string; sinceSeason: number; rows: HoldoutRow[] }

/** One backtest as a stored verdict. PURE. */
export function holdoutRowOf(b: LearnerBacktest): HoldoutRow {
  const published = b.rows.filter((r) => r.trainPct != null)
  const moved = b.overall.learned.trades
  const imp = b.overall.improvementPct
  const verdict: HoldoutVerdict =
    published.length === 0 || imp == null || moved < HOLDOUT_MIN_TEST_TRADES ? 'unknown' : imp > 0 ? 'held' : imp < 0 ? 'not_held' : 'unknown'
  return {
    learner: b.learner,
    book: b.book,
    verdict,
    improvementPct: imp,
    trainTrades: b.trainTrades,
    testTrades: moved,
    publishedRows: published.length,
    flippedRows: published.filter((r) => r.sameDirection === false).length,
  }
}

type Gathered = Awaited<ReturnType<typeof gatherFormatObservations>>
type DateReader = { leagueTrade: { findMany: (args: unknown) => PromiseLike<Array<{ transactionId: string; tradeDate: Date | null }>> } }

/** The three backtests per book from one gather and one read of trade dates — shared by the daily job and the script. */
export async function backtestGathered(
  prisma: DateReader,
  g: Gathered,
  cutoffGiven: Date | null = null,
): Promise<{ cutoff: Date; results: LearnerBacktest[] } | null> {
  const ids = new Set<string>()
  for (const m of [g.byBookPicks, g.byBookPosture, g.byBookNeed]) for (const v of m.values()) for (const o of v.observations) ids.add(o.transactionId)
  const dateOf = new Map<string, Date>()
  const all = [...ids]
  for (let i = 0; i < all.length; i += 5000) {
    const rows = await prisma.leagueTrade.findMany({ where: { transactionId: { in: all.slice(i, i + 5000) } }, select: { transactionId: true, tradeDate: true } })
    for (const r of rows) if (r.tradeDate && !dateOf.has(r.transactionId)) dateOf.set(r.transactionId, r.tradeDate)
  }
  const dated = <O extends { transactionId: string }>(obs: readonly O[]): Array<DatedObservation<O>> =>
    obs.flatMap((o) => (dateOf.has(o.transactionId) ? [{ obs: o, tradeDate: dateOf.get(o.transactionId)! }] : []))
  const cutoff = cutoffGiven ?? cutoffAtShare([...dateOf.values()])
  if (!cutoff) return null
  const results: LearnerBacktest[] = []
  for (const [book, v] of g.byBookPicks) results.push(backtestPicks(book, dated<PickObservation>(v.observations), cutoff))
  for (const [book, v] of g.byBookPosture) results.push(backtestPosture(book, dated<PostureObservation>(v.observations), cutoff))
  for (const [book, v] of g.byBookNeed) results.push(backtestNeed(book, dated<NeedObservation>(v.observations), cutoff))
  return { cutoff, results }
}

type Writer = DateReader & { sportsDataCache: { upsert: (args: unknown) => PromiseLike<unknown> } }

/** Run the check and store it for 21 days. Returns null when switched off or when there are too few dated trades. */
export async function runHoldoutCheck(
  prisma: Writer,
  opts: { now?: Date; sinceSeason: number; env?: NodeJS.ProcessEnv; gather?: typeof gatherFormatObservations },
): Promise<HoldoutDoc | null> {
  const env = opts.env ?? process.env
  if (!holdoutCheckOn(env)) return null
  const now = opts.now ?? new Date()
  const g = await (opts.gather ?? gatherFormatObservations)(prisma as never, { sinceSeason: opts.sinceSeason, now, env })
  const bt = await backtestGathered(prisma, g)
  if (!bt) return null
  const doc: HoldoutDoc = { generatedAt: now.toISOString(), cutoff: bt.cutoff.toISOString(), sinceSeason: opts.sinceSeason, rows: bt.results.map(holdoutRowOf) }
  const expiresAt = new Date(now.getTime() + HOLDOUT_MAX_AGE_MS)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: HOLDOUT_CACHE_KEY },
    create: { cacheKey: HOLDOUT_CACHE_KEY, expiresAt, data: doc as unknown as object },
    update: { expiresAt, data: doc as unknown as object },
  })
  return doc
}

/** The stored verdicts, or [] when absent, stale or unreadable (which gates nothing). PURE. */
export function holdoutRowsOf(raw: unknown, now: Date): HoldoutRow[] {
  const d = raw && typeof raw === 'object' ? (raw as { generatedAt?: unknown; rows?: unknown }) : null
  const at = d && typeof d.generatedAt === 'string' ? Date.parse(d.generatedAt) : NaN
  if (!d || !Number.isFinite(at) || now.getTime() - at > HOLDOUT_MAX_AGE_MS || !Array.isArray(d.rows)) return []
  return (d.rows as HoldoutRow[]).filter((r) => r && typeof r.learner === 'string' && typeof r.book === 'string' && typeof r.verdict === 'string')
}

/** The books a learner must not be used for: only those with a stored `not_held`. PURE. */
export function booksNotHeld(rows: readonly HoldoutRow[], learner: HoldoutLearner): Set<string> {
  return new Set(rows.filter((r) => r.learner === learner && r.verdict === 'not_held').map((r) => r.book))
}

/**
 * Is the learned market good enough to show outside the company (the partner page's panel)? At least one learner
 * held on later trades, and more held than failed. Absent verdicts = not yet. PURE.
 */
export function learnedMarketHolds(rows: readonly HoldoutRow[]): boolean {
  const held = rows.filter((r) => r.verdict === 'held').length
  const notHeld = rows.filter((r) => r.verdict === 'not_held').length
  return held >= 1 && held > notHeld
}

export function describeHoldout(r: HoldoutRow): string {
  const on = `${r.testTrades} later trades`
  if (r.verdict === 'held') return `Held: the learned grade was ${r.improvementPct}% closer to what later trades cost (${on}).`
  if (r.verdict === 'not_held') return `Did not hold: the learned grade was ${Math.abs(r.improvementPct ?? 0)}% further from what later trades cost (${on}) — grades ignore it for this book.`
  return r.publishedRows === 0 ? 'Not checked: nothing was published from the earlier trades.' : `Not enough later trades to tell yet (${on}; needs ${HOLDOUT_MIN_TEST_TRADES}).`
}
