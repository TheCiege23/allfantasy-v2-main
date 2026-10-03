import type { BoardTeam } from './standingsModel'
import type { StandingsOdds } from './standingsOdds'
import type { StandingsSort, StandingsSortKey } from './standingsView'

/**
 * The league table's rows in a chosen column's order — PURE, so the ordering is pinned by a test rather
 * than by clicking headers.
 *
 * ⚠ A MISSING VALUE SINKS IN BOTH DIRECTIONS. A team with no playoff percentage, no schedule rank or no
 * projection is not "the lowest" or "the highest"; it is unknown, and flipping the direction must not
 * float it to the top. Ties fall back to the table's own seed, so a sort never reshuffles level rows.
 */

/** A streak as one number: +3 for W3, −2 for L2, 0 for a tie run or no result yet. */
function streakValue(t: BoardTeam): number | null {
  if (!t.streak) return null
  if (t.streak.result === 'W') return t.streak.length
  if (t.streak.result === 'L') return -t.streak.length
  return 0
}

export function sortValue(t: BoardTeam, key: StandingsSortKey, odds: StandingsOdds | null): number | null {
  switch (key) {
    case 'seed':
      return t.seed
    case 'pct':
      return t.winPct
    case 'pf':
      return t.pointsFor
    case 'pa':
      return t.pointsAgainst
    case 'streak':
      return streakValue(t)
    case 'odds':
      return odds?.byRoster[t.rosterId]?.playoffPct ?? null
    case 'sos':
      return odds?.byRoster[t.rosterId]?.sosRank ?? null
    case 'proj':
      return t.projected?.seed ?? null
  }
}

export function sortTeams(teams: BoardTeam[], sort: StandingsSort, odds: StandingsOdds | null): BoardTeam[] {
  if (sort.key === 'seed' && sort.dir === 'asc') return teams
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...teams].sort((a, b) => {
    const va = sortValue(a, sort.key, odds)
    const vb = sortValue(b, sort.key, odds)
    if (va == null && vb == null) return a.seed - b.seed
    if (va == null) return 1
    if (vb == null) return -1
    return (va - vb) * sign || a.seed - b.seed
  })
}
