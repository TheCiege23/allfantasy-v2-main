import type { ValueBook } from './valueBook'

/**
 * His market value over the last 30 days, per value book your leagues price on — and, where the move
 * is unusual, a buy-low / sell-high nudge.
 *
 * Pure, client-safe. The loader is valueTrendLoader.ts.
 *
 * ⚠ "UNUSUAL" IS MEASURED AGAINST THE BOOK, NEVER A FIXED PERCENTAGE. Measured 2026-09-28 over players
 * worth >= 1,000: the median 30-day move is 11% in dynasty and 22% in redraft, and the 80th-percentile
 * 7-day move is ~10% in dynasty and ~24% in redraft. A threshold tuned on one book calls every redraft
 * player a mover or no dynasty player one. So a move is "big" when it is bigger than most of the
 * book's own players moved over the same week (`BIG_MOVE_SHARE`), which recalibrates itself as the
 * season's volatility changes.
 *
 * ⚠ A GAP IS A GAP. The snapshot cron misses days; the series carries only captured days, the
 * sparkline breaks at a gap rather than drawing through it, and a change needs a real capture at
 * least `days` before the latest one — a window with no such capture has no change, not a small one.
 */

export const TREND_WINDOW_DAYS = 30
/** A 7-day move bigger than this share of the book's players is "big". */
export const BIG_MOVE_SHARE = 0.8
/** Below this value a percentage move is mostly noise — a 300-point player doubling is 300 points. */
export const NUDGE_MIN_VALUE = 1000
/** The book's own distribution needs enough players to rank against. */
export const MIN_BOOK_PLAYERS = 50

export type TrendPoint = { day: string; value: number }
export type Change = { pct: number; from: number; fromDay: string }

export type BookTrend = {
  book: ValueBook
  /** "dynasty · superflex" — the book is always named, since a number without it is ambiguous. */
  label: string
  points: TrendPoint[]
  value: number
  lastDay: string
  change7: Change | null
  change30: Change | null
  /** Share of the book's players whose 7-day move was smaller than his (0..1), or null when not ranked. */
  moverShare: number | null
  /** Leagues in scope that price on this book, and how many of them roster him on YOUR team. */
  leagues: number
  yours: number
}

export type TrendNudge = { kind: 'sell-high' | 'buy-low' | 'check-cause'; text: string; bookLabel: string }

export type ValueTrend = {
  books: BookTrend[]
  /** Null when there is none, or when the viewer is locked (then `nudgeLocked`). */
  nudge: TrendNudge | null
  /** True when a nudge exists but the viewer's plan does not include it. */
  nudgeLocked: boolean
}

const DAY_MS = 86_400_000
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`)

/** The change from the latest capture at least `days` before the newest one; null when none exists. */
export function changeOver(points: readonly TrendPoint[], days: number): Change | null {
  if (points.length < 2) return null
  const last = points[points.length - 1]
  const cutoff = dayMs(last.day) - days * DAY_MS
  for (let i = points.length - 2; i >= 0; i--) {
    if (dayMs(points[i].day) <= cutoff) {
      const from = points[i]
      if (!(from.value > 0)) return null
      return { pct: (last.value - from.value) / from.value, from: from.value, fromDay: from.day }
    }
  }
  return null
}

/** Share of the book's absolute 7-day moves that are smaller than his. Null with too few to rank. */
export function moverShareOf(absPct: number, distribution: readonly number[]): number | null {
  if (!Number.isFinite(absPct) || distribution.length < MIN_BOOK_PLAYERS) return null
  let below = 0
  for (const d of distribution) if (d < absPct) below += 1
  return below / distribution.length
}

/** Captured days as runs of consecutive days — the sparkline draws one line per run. */
export function consecutiveRuns(points: readonly TrendPoint[]): TrendPoint[][] {
  const runs: TrendPoint[][] = []
  for (const p of points) {
    const run = runs[runs.length - 1]
    const prev = run?.[run.length - 1]
    if (prev && dayMs(p.day) - dayMs(prev.day) === DAY_MS) run.push(p)
    else runs.push([p])
  }
  return runs
}

const pct = (x: number) => `${Math.round(Math.abs(x) * 100)}%`
const leaguesWord = (n: number) => `${n} ${n === 1 ? 'league' : 'leagues'}`

/**
 * The nudge, from the book that matters most to you: where he is yours in the most leagues, else the
 * one your leagues use most. Only a BIG 7-day move on a player worth enough for a percentage to mean
 * something produces one.
 */
export function nudgeFor(books: readonly BookTrend[]): TrendNudge | null {
  const ranked = [...books].sort((a, b) => b.yours - a.yours || b.leagues - a.leagues)
  const b = ranked[0]
  if (!b || !b.change7 || b.moverShare == null || b.moverShare < BIG_MOVE_SHARE || b.value < NUDGE_MIN_VALUE) return null
  if (b.change7.pct === 0) return null
  const tenths = Math.floor(b.moverShare * 10)
  const up = b.change7.pct > 0
  const move = `${up ? 'Up' : 'Down'} ${pct(b.change7.pct)} this week — a bigger ${up ? 'jump' : 'drop'} than ${tenths} in 10 players on this chart.`
  if (up && b.yours > 0) return { kind: 'sell-high', bookLabel: b.label, text: `${move} You hold him in ${leaguesWord(b.yours)}: a sell-high window, if you would move him.` }
  if (!up && b.yours > 0) return { kind: 'check-cause', bookLabel: b.label, text: `${move} You hold him in ${leaguesWord(b.yours)}: check the cause before selling into the drop.` }
  if (!up && b.leagues > 0) return { kind: 'buy-low', bookLabel: b.label, text: `${move} He isn’t yours in these leagues: a buy-low window, if the cause is temporary.` }
  return null
}
