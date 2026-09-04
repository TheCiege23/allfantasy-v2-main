/**
 * Commissioner OS module-level feature flags.
 *
 * Deliberately separate from lib/feature-toggle — that system's
 * FEATURE_KEYS is a closed, curated set tied to existing, live product
 * features, with its own defaults map. Adding nine placeholder-phase
 * module keys there would be a more invasive edit to shared, in-production
 * infrastructure than this foundation phase should make, especially
 * before any of these modules have real functionality to gate. See the
 * Repository Discovery Rules appendix (Developer Playbook) — same general
 * concept as the existing system, no real content overlap, correctly
 * isolated rather than force-extended.
 *
 * Every module defaults to enabled during this scaffolding phase — there
 * is nothing yet to hide. The mechanism exists so a later phase can flip a
 * specific module off independently, per the Implementation Program §15
 * ("one flag per module, gating its route and its nav entry together").
 */

import type { CommissionerModuleId } from './navigation/moduleNav'

export type CommissionerModuleFlags = Record<CommissionerModuleId, boolean>

export const DEFAULT_COMMISSIONER_MODULE_FLAGS: CommissionerModuleFlags = {
  'mission-control': true,
  'league-health': true,
  recommendations: true,
  managers: true,
  workspace: true,
  automations: true,
  analytics: true,
  reports: true,
  settings: true,
  activity: true,
  help: true,
}

export function isCommissionerModuleEnabled(
  moduleId: CommissionerModuleId,
  flags: CommissionerModuleFlags = DEFAULT_COMMISSIONER_MODULE_FLAGS
): boolean {
  return flags[moduleId] ?? false
}
