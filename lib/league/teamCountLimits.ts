/**
 * Team-count limits for standard native leagues (redraft and dynasty).
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
