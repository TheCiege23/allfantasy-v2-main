/**
 * Team-count limits for standard native leagues (redraft and dynasty), and the real-league cap for pro sports.
 *
 * Pure and dependency-free so the create wizard, the create/settings routes, the import carryover
 * and the resize path all read one number. Special modes (Survivor, Zombie, Guilly, Big Brother,
 * Salary Cap, Devy, C2C, IDP, Keeper, Best Ball) keep their own lists: their rules are sized to them.
 */

/** Largest standard native league. */
export const MAX_NATIVE_TEAMS = 250
/** Smallest redraft league. */
export const MIN_REDRAFT_TEAMS = 2
/** Smallest dynasty league. */
export const MIN_DYNASTY_TEAMS = 4

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}

/** Every redraft size, odd sizes included. */
export const REDRAFT_TEAM_COUNTS: readonly number[] = range(MIN_REDRAFT_TEAMS, MAX_NATIVE_TEAMS)
/** Every dynasty size, odd sizes included. */
export const DYNASTY_TEAM_COUNTS: readonly number[] = range(MIN_DYNASTY_TEAMS, MAX_NATIVE_TEAMS)

export function isNativeTeamCount(value: unknown, min: number = MIN_REDRAFT_TEAMS): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= MAX_NATIVE_TEAMS
}

/**
 * A pro-sport league is never bigger than the real league it drafts from (owner's rule, 2026-11-22:
 * "pro football should only be 32 teams allowed … MLB, NBA and NHL should max out at the total amount
 * of teams there are in the real league"). Every format, except a Tournament, whose sizes are pools
 * of several feeder leagues, not one league.
 *
 * College and soccer are not capped here: the owner's college leagues run 140 and 180 teams.
 * An IMPORTED league keeps its own size when it becomes native (lib/league-creation/importedTeamCount.ts):
 * the owner's commissioner runs 34- and 36-team pro leagues on Fantrax.
 */
export const PRO_LEAGUE_TEAMS: Readonly<Record<string, number>> = { NFL: 32, NBA: 30, MLB: 30, NHL: 32 }

/**
 * League types whose sizes are not one league's, so the real-league cap does not apply. C2C joined
 * 2026-11-24 (owner's decision): a C2C league's extra teams draw on college players too, so it is sized by
 * its pro player pool instead (lib/league-creation/playerSupply.ts), letting big C2C leagues run on the
 * NFL / NBA engine.
 */
const NOT_ONE_LEAGUE_TYPES: readonly string[] = ['tournament', 'c2c']

/** `counts` without any size larger than the sport's real league. Other sports are returned as they are. */
export function capToRealLeague(sport: string, leagueType: string, counts: readonly number[]): number[] {
  const max = PRO_LEAGUE_TEAMS[String(sport ?? '').trim().toUpperCase()]
  if (!max || NOT_ONE_LEAGUE_TYPES.includes(String(leagueType ?? '').trim().toLowerCase())) return [...counts]
  return counts.filter((n) => n <= max)
}
