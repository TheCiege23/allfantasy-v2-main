/**
 * Guilly league team-count limits — the one rule for every sport, read by the create wizard,
 * the create-options catalog and the server-side validator so the three cannot disagree.
 *
 *   4–27 teams   single elimination (one team chopped per week)
 *   28–35 teams  allowed when the commissioner adds double-elimination weeks
 *                (League.settings.guillotine_advanced, see ./chopSchedule.ts)
 *
 * Pure: safe to import from client components.
 */

export const GUILLOTINE_MIN_TEAMS = 4
export const GUILLOTINE_SINGLE_ELIMINATION_MAX_TEAMS = 27
export const GUILLOTINE_MAX_TEAMS = 35

/** Every allowed team count, 4 through 35 inclusive. */
export function guillotineTeamCountOptions(): number[] {
  return Array.from(
    { length: GUILLOTINE_MAX_TEAMS - GUILLOTINE_MIN_TEAMS + 1 },
    (_, index) => GUILLOTINE_MIN_TEAMS + index,
  )
}

/** True when a league this size needs the commissioner to add double-elimination weeks. */
export function guillotineNeedsDoubleElimination(teamCount: number): boolean {
  return teamCount > GUILLOTINE_SINGLE_ELIMINATION_MAX_TEAMS
}
