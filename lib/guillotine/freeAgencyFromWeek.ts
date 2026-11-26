/**
 * "Chopped players stop hitting waivers after week N" (owner's list, 2026-11-25). From week N on, a chop's
 * released players skip the waiver run and are free agents the moment the chop is final, exactly as a league
 * set to "Right after the chop" (`rosterReleaseTiming: 'immediate'`) has them every week. Late in a season a
 * three-team waiver run over a dead roster is a chore; this ends it without changing the early weeks.
 *
 * Stored in `League.settings` under FREE_AGENCY_FROM_WEEK_KEY; absent = never (every chop goes to waivers as
 * the release choice says). Pure, so the hold (lib/waiver-wire/dropped-player-waivers.ts), the alert, the
 * preview and the rules page all read this one definition.
 */

export const FREE_AGENCY_FROM_WEEK_KEY = 'guillotineFreeAgencyFromWeek'

/** A week a commissioner can pick: 1 to 30, whole. */
export function isFreeAgencyFromWeek(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 30
}

export function readFreeAgencyFromWeek(settings: unknown): number | null {
  const v = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[FREE_AGENCY_FROM_WEEK_KEY] : null
  return isFreeAgencyFromWeek(v) ? v : null
}

/** True when a chop in `week` releases its players straight to free agency under this rule. */
export function choppedPlayersAreFreeAgents(freeAgencyFromWeek: number | null | undefined, week: number): boolean {
  return freeAgencyFromWeek != null && week >= freeAgencyFromWeek
}

/**
 * The release timing a chop in `week` actually has: the league's choice, or "immediate" from week N on. Every
 * reader that SAYS when players can be claimed (alert, preview) goes through this, so the words match the hold.
 */
export function effectiveReleaseTiming<T extends string>(timing: T, freeAgencyFromWeek: number | null | undefined, week: number): T | 'immediate' {
  return choppedPlayersAreFreeAgents(freeAgencyFromWeek, week) ? 'immediate' : timing
}
