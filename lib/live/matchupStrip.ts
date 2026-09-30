import type { MatchupData } from '@/lib/core-app/matchup'

/**
 * The live matchup strip's view-model: you vs your opponent for the league held on `/core/live`.
 *
 * Reuses `getMatchupData` (the `/core/matchup` loader) rather than computing a second score, so the
 * two screens cannot disagree. This module only decides what to SAY, and says each absence plainly:
 * a matchup with nothing scored is "not started", never 0–0, and a failed read is never "no matchup".
 */
export type MatchupStrip =
  | { kind: 'failed' }
  | { kind: 'unavailable'; reason: string }
  | {
      kind: 'scheduled'
      week: number | null
      you: string
      opponent: string
    }
  | {
      kind: 'scored'
      week: number | null
      isFinal: boolean
      you: { name: string; points: number }
      opponent: { name: string; points: number }
      /** Positive when you lead. Both sides are the platform's own totals. */
      margin: number
      /** Null when the win probability could not be computed — never a guess. */
      pWin: number | null
      /** Starters across BOTH lineups not yet finished. Null unless every starter's game state is known. */
      remaining: { upcoming: number; live: number } | null
    }

export function buildMatchupStrip(data: MatchupData | null, loadFailed = false): MatchupStrip | null {
  if (loadFailed) return { kind: 'failed' }
  if (!data) return null
  const week = data.week.available ? data.week.data.week : null
  if (!data.sides.available) {
    if (data.teams.available) {
      return { kind: 'scheduled', week, you: data.teams.data.you.teamName, opponent: data.teams.data.opponent.teamName }
    }
    return { kind: 'unavailable', reason: data.sides.reason }
  }
  const { you, opponent } = data.sides.data
  const counts = data.starterCounts ?? null
  return {
    kind: 'scored',
    week,
    isFinal: data.week.available ? data.week.data.isFinal : false,
    you: { name: you.teamName, points: you.points },
    opponent: { name: opponent.teamName, points: opponent.points },
    margin: Math.round((you.points - opponent.points) * 100) / 100,
    pWin: data.winProbability.available ? data.winProbability.data.pWin : null,
    remaining: counts && counts.unknown === 0 ? { upcoming: counts.upcoming, live: counts.live } : null,
  }
}
