/**
 * Read-only feature flag for the scoring-upgrade shadow harness.
 *
 * Mirrors the shape of `league-scoped-weekly-score-read-flag.ts`:
 *  - Pure functions, no I/O, no env reads inside the module.
 *  - Caller is responsible for sourcing the mode (e.g. from env or a
 *    feature-flag service) and passing it in.
 *  - Default mode is `'off'`. The shadow harness must remain inert until a
 *    deliberate mode change is made.
 *
 * This file does NOT modify any production scoring path. It only describes
 * whether a separate, read-only diff harness is allowed to run.
 */

export type ScoringUpgradeShadowMode = 'off' | 'internal' | 'canary' | 'on'

export const DEFAULT_SCORING_UPGRADE_SHADOW_MODE: ScoringUpgradeShadowMode = 'off'

export function parseScoringUpgradeShadowMode(
  value: string | undefined | null,
): ScoringUpgradeShadowMode {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'internal') return 'internal'
  if (normalized === 'canary') return 'canary'
  if (normalized === 'on') return 'on'
  return 'off'
}

export type ResolveScoringUpgradeShadowPlanInput = {
  mode: ScoringUpgradeShadowMode
  isInternalRequest: boolean
  isCanaryLeague: boolean
}

export type ScoringUpgradeShadowPlan = {
  enabled: boolean
  reason:
    | 'mode_off'
    | 'mode_internal_non_internal_request'
    | 'mode_internal_internal_request'
    | 'mode_canary_non_canary_league'
    | 'mode_canary_league'
    | 'mode_on'
}

/**
 * Decide whether the scoring-upgrade shadow harness may run for the current
 * request/league. This decision never changes user-facing behavior; it only
 * gates whether a parallel, read-only candidate computation is performed.
 */
export function resolveScoringUpgradeShadowPlan(
  input: ResolveScoringUpgradeShadowPlanInput,
): ScoringUpgradeShadowPlan {
  if (input.mode === 'off') {
    return { enabled: false, reason: 'mode_off' }
  }

  if (input.mode === 'internal') {
    if (!input.isInternalRequest) {
      return { enabled: false, reason: 'mode_internal_non_internal_request' }
    }
    return { enabled: true, reason: 'mode_internal_internal_request' }
  }

  if (input.mode === 'canary') {
    if (!input.isCanaryLeague) {
      return { enabled: false, reason: 'mode_canary_non_canary_league' }
    }
    return { enabled: true, reason: 'mode_canary_league' }
  }

  return { enabled: true, reason: 'mode_on' }
}
