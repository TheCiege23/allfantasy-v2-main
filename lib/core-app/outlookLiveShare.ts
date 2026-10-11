import type { StarterGameState } from './matchupGameState'
import type { SimGame } from './outlookSim'

/**
 * The share of one lineup's week still to play, from its starters' game states. Null with no starters.
 *
 * ⚠ AN UNREADABLE STARTER COUNTS AS STILL TO PLAY. `unknown` covers an unresolved player id (about
 * one in eight Sleeper ids), a bye, and a live feed more than an hour stale — so treating it as
 * finished would freeze a score while players are still on the field. Counting it as unplayed only
 * widens the draw toward the old pre-game model. A game in progress is half played.
 */
export function remainingShare(states: readonly StarterGameState[]): number | null {
  if (states.length === 0) return null
  let left = 0
  for (const s of states) left += s === 'final' ? 0 : s === 'live' ? 0.5 : 1
  return left / states.length
}

export type LiveRow = { week: number; rosterId: string; pointsFor: number; pointsAgainst: number }

const hasPoints = (r: LiveRow | undefined) => r != null && (r.pointsFor > 0 || r.pointsAgainst > 0)

/** Weeks with an unfinished game that already has points on either side. */
export function liveWeeks(remaining: readonly SimGame[], rows: readonly LiveRow[]): number[] {
  const scored = new Set(rows.filter(hasPoints).map((r) => `${r.week}|${r.rosterId}`))
  return [...new Set(remaining.filter((g) => scored.has(`${g.week}|${g.a}`) || scored.has(`${g.week}|${g.b}`)).map((g) => g.week))]
}

/**
 * The remaining schedule with each game under way carrying its board. A game whose two lineups cannot
 * both be read stays an unplayed draw, as before, and is counted in `unread` so the outlook can say so.
 */
export function withLiveScores(
  remaining: readonly SimGame[],
  rows: readonly LiveRow[],
  share: (week: number, rosterId: string) => number | null | undefined,
): { games: SimGame[]; attached: number[]; unread: number[] } {
  const byKey = new Map(rows.map((r) => [`${r.week}|${r.rosterId}`, r]))
  const attached: number[] = []
  const unread: number[] = []
  const games = remaining.map((g) => {
    const ra = byKey.get(`${g.week}|${g.a}`)
    const rb = byKey.get(`${g.week}|${g.b}`)
    if (!hasPoints(ra) && !hasPoints(rb)) return g
    const restA = share(g.week, g.a)
    const restB = share(g.week, g.b)
    if (restA == null || restB == null) {
      unread.push(g.week)
      return g
    }
    attached.push(g.week)
    return { ...g, live: { a: ra?.pointsFor ?? 0, b: rb?.pointsFor ?? 0, restA, restB } }
  })
  return { games, attached, unread }
}
