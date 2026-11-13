/**
 * BracketLeaderboardResolver — leaderboard URLs and rank display for bracket challenge.
 */

/**
 * URL to pool/league leaderboard (standings within a league).
 */
export function getPoolLeaderboardUrl(leagueId: string): string {
  return `/brackets/leagues/${encodeURIComponent(leagueId)}`
}

