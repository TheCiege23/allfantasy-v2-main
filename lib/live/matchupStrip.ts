import type { MatchupData } from '@/lib/core-app/matchup'

/**
 * The live matchup strip's view-model: you vs your opponent for the league held on `/core/live`.
 *
 * Reuses `getMatchupData` (the `/core/matchup` loader) rather than computing a second score, so the
 * two screens cannot disagree. This module only decides what to SAY, and says each absence plainly:
 * a matchup with nothing scored is "not started", never 0–0, and a failed read is never "no matchup".
 */
export type SideRemaining = { upcoming: number; live: number }

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
      /**
       * Starters still to play, per team. A side is null unless EVERY one of its starters' game states
       * is known — a partial count would read as fewer left than there are. The whole object is null
       * when the loader could not tally the lineups at all.
       */
      remaining: { you: SideRemaining | null; opponent: SideRemaining | null } | null
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
  const bySide = data.starterCountsBySide ?? null
  const side = (c: { upcoming: number; live: number; unknown: number } | undefined): SideRemaining | null =>
    c && c.unknown === 0 ? { upcoming: c.upcoming, live: c.live } : null
  return {
    kind: 'scored',
    week,
    isFinal: data.week.available ? data.week.data.isFinal : false,
    you: { name: you.teamName, points: you.points },
    opponent: { name: opponent.teamName, points: opponent.points },
    margin: Math.round((you.points - opponent.points) * 100) / 100,
    pWin: data.winProbability.available ? data.winProbability.data.pWin : null,
    remaining: bySide ? { you: side(bySide.you), opponent: side(bySide.opponent) } : null,
  }
}

/**
 * What the strip shows after a refresh. A failed poll keeps the last good strip and says it is stale,
 * rather than replacing real points with an error or quietly presenting old ones as current.
 */
export function nextStripState(
  prev: MatchupStrip | null,
  result: MatchupStrip | null | 'error',
): { strip: MatchupStrip | null; stale: boolean } {
  if (result === 'error') return { strip: prev, stale: prev != null }
  return { strip: result, stale: false }
}

/** "3 to play (1 live)", "none left", or "unknown" when this side's game states are not all known. */
export function describeRemaining(r: SideRemaining | null): string {
  if (r == null) return 'unknown'
  const left = r.upcoming + r.live
  if (left === 0) return 'none left'
  return r.live > 0 ? `${left} to play (${r.live} live)` : `${left} to play`
}
