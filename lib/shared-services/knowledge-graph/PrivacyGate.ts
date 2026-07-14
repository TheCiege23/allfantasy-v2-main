/**
 * Cohort-size privacy gate — Knowledge Graph spec Part 9 / Part 3 §6, enforced
 * from this phase's first version per the phase brief's explicit instruction.
 *
 * Interpretation choice, disclosed: the spec's own text scopes the cohort gate
 * to aggregates "surfaced to a third party" and exempts a manager's own
 * self-view / their commissioner's view. This phase's brief is more strict —
 * "no aggregate ships without satisfying the gate," with no exception listed.
 * Since foundation phase has no real auth/permission wiring yet to correctly
 * distinguish "self" from "third party" in production, this implementation
 * takes the stricter reading: the gate is enforced unconditionally, checked
 * against the PLATFORM-WIDE distinct league count (not just one manager's
 * own leagues). Loosening this once real caller identity is wired (so a
 * manager can always see their own profile regardless of platform-wide
 * volume) is flagged as a deferred follow-up in the README, not implemented
 * here.
 */

import type { PrivacyGateResult } from './types'

export const MINIMUM_COHORT_LEAGUES = 20

export function checkPrivacyGate(distinctLeagueCount: number, threshold: number = MINIMUM_COHORT_LEAGUES): PrivacyGateResult {
  const allowed = distinctLeagueCount >= threshold
  return {
    allowed,
    reason: allowed
      ? null
      : `Insufficient cohort: ${distinctLeagueCount} distinct league(s) observed, ${threshold} required before this aggregate ships.`,
    cohortSize: distinctLeagueCount,
    threshold,
  }
}
