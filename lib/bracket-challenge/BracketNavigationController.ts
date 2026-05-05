/**
 * BracketNavigationController — canonical routes and back links for bracket challenge.
 */

/** Bracket landing (marketing + shell entry). */
export const BRACKET_LANDING_PATH = '/brackets'

/** Brackets app home (authenticated shell). */
export const BRACKETS_HOME_PATH = '/brackets'

/** Create a new pool. */
export function getCreatePoolPath(options?: {
  sport?: string | null
  challengeType?: 'playoff_challenge' | 'mens_ncaa'
}): string {
  if (!options?.sport && !options?.challengeType) return '/brackets/leagues/new'
  const params = new URLSearchParams()
  if (options.sport) params.set('sport', options.sport)
  if (options.challengeType) params.set('challengeType', options.challengeType)
  return `/brackets/leagues/new?${params.toString()}`
}

/** Join a pool (with optional code query). */
export function getJoinPoolPath(joinCode?: string): string {
  if (joinCode) return `/brackets/join?code=${encodeURIComponent(joinCode)}`
  return '/brackets/join'
}

/** League/pool detail. */
export function getLeaguePath(leagueId: string): string {
  return `/brackets/leagues/${encodeURIComponent(leagueId)}`
}

/** Entry bracket (fill picks) — tournament + entry. */
export function getEntryBracketPath(tournamentId: string, entryId: string): string {
  const tid = encodeURIComponent(tournamentId)
  const eid = encodeURIComponent(entryId)
  return `/brackets/tournament/${tid}?entry=${eid}`
}

/** Sign-in next param for bracket flows. */
export function getSignInNextForBrackets(): string {
  return '/brackets'
}

/** Sign-up next param for create flow. */
export function getSignUpNextForCreate(): string {
  return '/brackets/leagues/new'
}

/** Login next param for join flow. */
export function getLoginNextForJoin(): string {
  return '/brackets/join'
}
