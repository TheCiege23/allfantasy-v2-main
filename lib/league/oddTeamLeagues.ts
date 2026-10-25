/**
 * Odd-team native leagues — who may create one, and the defaults one starts with.
 *
 * Pure and dependency-free: the create wizard, POST /api/leagues and the settings PATCH all read it,
 * so the client and the server cannot disagree about which sizes are locked.
 *
 * 🛑 REDRAFT ODD COUNTS ARE FREE AND STAY FREE HERE. A redraft league already offers every size from
 * 2 to 32 (UNIVERSAL_CREATE_TEAM_COUNTS), 7- and 9-team playoff fields were made free on purpose
 * (owner's Oct 15 paywall rule, 08d407e24, pinned by __tests__/free-commissioner-locks.test.ts), and
 * locking either would take a working option away from free commissioners mid-season. Only KEEPER,
 * whose native list was even-only (4–16), gains odd sizes as an AF Commissioner option. Whether
 * redraft odd sizes should become paid is the owner's call; it is one entry in the set below.
 */

/** League types whose odd sizes are an AF Commissioner option. */
export const ODD_TEAM_COUNT_GATED_LEAGUE_TYPES: ReadonlySet<string> = new Set(['keeper'])

/** League types where an odd size turns league median on by default. */
export const ODD_TEAM_MEDIAN_LEAGUE_TYPES: ReadonlySet<string> = new Set(['redraft', 'keeper'])

/** Odd keeper sizes, inside the keeper list's existing 4–16 range (NFL, NBA, NHL, MLB). */
export const KEEPER_ODD_TEAM_COUNTS: readonly number[] = [5, 7, 9, 11, 13, 15]

export function isOddTeamCount(teamCount: number | null | undefined): boolean {
  const n = Number(teamCount)
  return Number.isInteger(n) && n > 0 && n % 2 === 1
}

/** True when this size, for this league type, needs AF Commissioner. */
export function oddTeamCountNeedsAfCommissioner(leagueType: string | null | undefined, teamCount: number): boolean {
  return isOddTeamCount(teamCount) && ODD_TEAM_COUNT_GATED_LEAGUE_TYPES.has(String(leagueType ?? '').toLowerCase())
}

/** The sizes a commissioner may pick: the gated odd sizes drop out without AF Commissioner. */
export function teamCountOptionsForPlan(
  options: readonly number[],
  leagueType: string | null | undefined,
  hasAfCommissioner: boolean,
): number[] {
  if (hasAfCommissioner) return [...options]
  return options.filter((n) => !oddTeamCountNeedsAfCommissioner(leagueType, n))
}

/** The sizes shown locked, with the upgrade prompt, for a commissioner without the plan. */
export function lockedOddTeamCounts(
  options: readonly number[],
  leagueType: string | null | undefined,
  hasAfCommissioner: boolean,
): number[] {
  if (hasAfCommissioner) return []
  return options.filter((n) => oddTeamCountNeedsAfCommissioner(leagueType, n))
}

/**
 * League median is ON by default for an odd-team league. Each week one team has no opponent; the
 * median game is what still gives it a result. An explicit choice always wins.
 */
export function defaultMedianGameFor(teamCount: number, explicit: boolean | null | undefined): boolean {
  if (typeof explicit === 'boolean') return explicit
  return isOddTeamCount(teamCount)
}
