import type { StarterGameState } from './matchupGameState'
import type { SimGame } from './outlookSim'

/** One starter as the board reads it: its game state, and the points it already carries. */
export type StarterRead = { state: StarterGameState; points: number }

/**
 * The share of one lineup's week still to play, from its starters. Null when it cannot be read.
 *
 * final 0, live ½, upcoming 1. An `unknown` starter (an unresolved id, a bye, a live feed more than
 * an hour stale) is judged by its own points: on the board means it has played, so ½; nothing yet, 1.
 *
 * 🛑 "UNREADABLE COUNTS AS STILL TO PLAY" WAS THE FIRST RULE AND IT DOUBLE-COUNTED. A starter whose
 * points are already on the board was drawn again for a whole game — and a lineup nobody could read
 * (a Fantrax college league: 0 of 120 starters resolve) became its board PLUS an entire extra week.
 * So a lineup with more unreadable starters than readable ones is not read at all: its game falls
 * back to the unplayed pre-game draw, which ignores the board rather than adding to it.
 */
export function remainingShare(starters: readonly StarterRead[]): number | null {
  if (starters.length === 0) return null
  const unknown = starters.filter((s) => s.state === 'unknown').length
  if (unknown * 2 > starters.length) return null
  let left = 0
  for (const s of starters) {
    if (s.state === 'final') continue
    left += s.state === 'live' ? 0.5 : s.state === 'upcoming' ? 1 : s.points > 0 ? 0.5 : 1
  }
  return left / starters.length
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
 *
 * `livePoints`, when given, is each read lineup's starter sum from the live per-player rows. It wins
 * over the matchup row's `pointsFor`, which lags it during games, and it alone can start a game the
 * matchup row still shows at zero.
 */
export function withLiveScores(
  remaining: readonly SimGame[],
  rows: readonly LiveRow[],
  share: (week: number, rosterId: string) => number | null | undefined,
  livePoints: (week: number, rosterId: string) => number | null | undefined = () => undefined,
): { games: SimGame[]; attached: number[]; unread: number[] } {
  const byKey = new Map(rows.map((r) => [`${r.week}|${r.rosterId}`, r]))
  const attached: number[] = []
  const unread: number[] = []
  const games = remaining.map((g) => {
    const ra = byKey.get(`${g.week}|${g.a}`)
    const rb = byKey.get(`${g.week}|${g.b}`)
    const la = livePoints(g.week, g.a)
    const lb = livePoints(g.week, g.b)
    if (!hasPoints(ra) && !hasPoints(rb) && !(la != null && la > 0) && !(lb != null && lb > 0)) return g
    const restA = share(g.week, g.a)
    const restB = share(g.week, g.b)
    if (restA == null || restB == null) {
      unread.push(g.week)
      return g
    }
    attached.push(g.week)
    return { ...g, live: { a: la ?? ra?.pointsFor ?? 0, b: lb ?? rb?.pointsFor ?? 0, restA, restB } }
  })
  return { games, attached, unread }
}
