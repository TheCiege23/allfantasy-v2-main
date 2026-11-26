/**
 * Odd-team native leagues — who may create one, and the defaults one starts with.
 *
 * Pure and dependency-free: the create wizard, POST /api/leagues and the settings PATCH all read it,
 * so the client and the server cannot disagree about which sizes are locked.
 *
 * 🛑 REDRAFT ODD COUNTS ARE AF COMMISSIONER SINCE 2026-11-25 — A KNOWING REVERSAL. On 2026-10-25 the
 * owner confirmed redraft odd sizes and 7-/9-team playoff fields stay free. On 2026-11-25 the owner was
 * shown that decision explicitly and chose to gate them ("Yes, gate them"), as part of the redraft
 * redesign's tier list: odd team counts and odd playoff fields are AF Commissioner (Supreme includes it).
 * Existing leagues keep the size they already have: only CHOOSING an odd size (create, or a resize to a
 * different odd size) is gated. Keeper odd sizes (5–19) were already gated; even sizes stay free.
 */

/** League types whose odd sizes are an AF Commissioner option. */
const ODD_TEAM_COUNT_GATED_LEAGUE_TYPES: ReadonlySet<string> = new Set(['redraft', 'keeper'])

/** League types where an odd size turns league median on by default. */
export const ODD_TEAM_MEDIAN_LEAGUE_TYPES: ReadonlySet<string> = new Set(['redraft', 'keeper'])

/**
 * Keeper sizes for NFL, NBA, NHL and MLB (owner's decision 2026-10-25): every size from 4 to 20. The
 * even ones are free; the odd ones (5–19) are AF Commissioner.
 */
export const KEEPER_MAX_TEAMS = 20
export const KEEPER_EVEN_TEAM_COUNTS: readonly number[] = Array.from({ length: 9 }, (_, i) => 4 + i * 2)
export const KEEPER_ODD_TEAM_COUNTS: readonly number[] = Array.from({ length: 8 }, (_, i) => 5 + i * 2)

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

/** "redraft" / "keeper" for the upgrade message; anything else reads as plain "league". */
export function oddTeamGateLeagueWord(leagueType: string | null | undefined): string {
  const lt = String(leagueType ?? '').toLowerCase()
  return lt === 'redraft' || lt === 'keeper' ? `${lt} ` : ''
}

/** Redraft playoff fields of an odd size need AF Commissioner (owner, 2026-11-25). */
export function oddPlayoffFieldNeedsAfCommissioner(leagueType: string | null | undefined, playoffTeams: number): boolean {
  return String(leagueType ?? '').toLowerCase() === 'redraft' && isOddTeamCount(playoffTeams)
}
