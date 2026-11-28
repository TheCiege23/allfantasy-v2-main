import type { DailyLineupView } from '@/lib/redraft/dailyLineupView'
import { slotCategory } from '@/lib/league-runtime/redraftSlotType'

/**
 * "Week by player" on the lineup screen of a daily-lineup league (2026-11-27): each player's points
 * day by day, his running week total, and what he scored on the bench.
 *
 * Hockey managers leaving Yahoo's late-2026 redesign named this one directly — "no straightforward
 * way to view your individual players' cumulative points for the week". The numbers already existed
 * (`loadDailyLineupView` prices every day with the league's own scorer); nothing rendered them.
 *
 * ⚠ THE WEEK TOTAL IS `startedPoints`, NOT A RE-SUM. It is the matchup scorer's own per-player
 * breakdown, so the rows add up to the "Week N so far" figure on the same screen — a test pins that.
 * A day COUNTS when the view says so (`startedIds`, the scorer's starter rule); slot names are only
 * the fallback for a view built before that field existed.
 */

export type WeekByPlayerCell = {
  day: string
  /** His points that day; null = no stat line (no game, or not yet played). */
  pts: number | null
  /** His points counted toward the matchup that day. */
  counted: boolean
  /** He was on the roster that day. */
  onRoster: boolean
}

export type WeekByPlayerRow = {
  playerId: string
  cells: WeekByPlayerCell[]
  /** Points that counted — his share of the matchup total. */
  week: number
  /** Points he scored on days they did not count (benched, IR, taxi). */
  bench: number
  /** Days his points counted. */
  daysCounted: number
}

export type WeekByPlayer = {
  week: number
  /** `starterPoints`: what that day's counted lines scored, the day's share of the matchup. */
  days: Array<{ day: string; status: 'past' | 'today' | 'future'; starterPoints: number }>
  rows: WeekByPlayerRow[]
  /** Σ rows.week — equals the view's `weekPoints` (to rounding). */
  total: number
  /** Σ rows.bench — the week's points left on the bench. */
  benchTotal: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

function countedOn(day: DailyLineupView['days'][number], playerId: string): boolean {
  if (Array.isArray(day.startedIds)) return day.startedIds.includes(playerId)
  return slotCategory(day.slots[playerId]) === 'starter' && day.points[playerId] != null
}

/** Null without a view, or before any player on the roster has a stat line this week. */
export function weekByPlayer(view: DailyLineupView | null | undefined): WeekByPlayer | null {
  if (!view || view.days.length === 0) return null
  const ids = new Set<string>()
  for (const d of view.days) for (const id of Object.keys(d.slots)) ids.add(id)

  const rows: WeekByPlayerRow[] = [...ids].map((playerId) => {
    let all = 0
    let daysCounted = 0
    let countedSum = 0
    const cells = view.days.map((d) => {
      const onRoster = Object.hasOwn(d.slots, playerId)
      const pts = onRoster && d.points[playerId] != null ? d.points[playerId] : null
      const counted = onRoster && pts != null && countedOn(d, playerId)
      if (pts != null) all += pts
      if (counted) {
        daysCounted += 1
        countedSum += pts!
      }
      return { day: d.day, pts, counted, onRoster }
    })
    // The scorer's own breakdown when present; the day-by-day sum otherwise (they agree to rounding).
    const week = round2(view.startedPoints?.[playerId] ?? countedSum)
    return { playerId, cells, week, bench: round2(Math.max(0, all - countedSum)), daysCounted }
  })

  // Before anyone has a line this week every cell is blank: nothing to show yet.
  if (!rows.some((r) => r.cells.some((c) => c.pts != null))) return null

  rows.sort((a, b) => b.week - a.week || b.bench - a.bench || a.playerId.localeCompare(b.playerId))
  return {
    week: view.week,
    days: view.days.map((d) => ({ day: d.day, status: d.status, starterPoints: d.starterPoints })),
    rows,
    total: round2(rows.reduce((s, r) => s + r.week, 0)),
    benchTotal: round2(rows.reduce((s, r) => s + r.bench, 0)),
  }
}
