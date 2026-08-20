export type LeagueScopedWeeklyScoreReadMode = 'off' | 'internal' | 'canary' | 'on'

export const DEFAULT_LEAGUE_SCOPED_WEEKLY_SCORE_READ_MODE: LeagueScopedWeeklyScoreReadMode = 'off'

export function parseLeagueScopedWeeklyScoreReadMode(
  value: string | undefined,
): LeagueScopedWeeklyScoreReadMode {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'internal') return 'internal'
  if (normalized === 'canary') return 'canary'
  if (normalized === 'on') return 'on'
  return 'off'
}

export type ResolveLeagueScopedReadPlanInput = {
  mode: LeagueScopedWeeklyScoreReadMode
  isInternalRequest: boolean
  isCanaryLeague: boolean
}

export type LeagueScopedReadPlan = {
  readFromLeagueScoped: boolean
  allowGlobalFallback: boolean
  allowComputeFallback: boolean
  reason:
    | 'mode_off'
    | 'mode_internal_non_internal_request'
    | 'mode_internal_internal_request'
    | 'mode_canary_non_canary_request'
    | 'mode_canary_request'
    | 'mode_on'
}

/**
 * Phase 7K planning helper for first internal read-path canary.
 * This does not switch any user-facing consumer on its own.
 */
export function resolveLeagueScopedReadPlan(input: ResolveLeagueScopedReadPlanInput): LeagueScopedReadPlan {
  if (input.mode === 'off') {
    return {
      readFromLeagueScoped: false,
      allowGlobalFallback: true,
      allowComputeFallback: false,
      reason: 'mode_off',
    }
  }

  if (input.mode === 'internal') {
    if (!input.isInternalRequest) {
      return {
        readFromLeagueScoped: false,
        allowGlobalFallback: true,
        allowComputeFallback: false,
        reason: 'mode_internal_non_internal_request',
      }
    }
    return {
      readFromLeagueScoped: true,
      allowGlobalFallback: true,
      allowComputeFallback: true,
      reason: 'mode_internal_internal_request',
    }
  }

  if (input.mode === 'canary') {
    if (!input.isCanaryLeague) {
      return {
        readFromLeagueScoped: false,
        allowGlobalFallback: true,
        allowComputeFallback: false,
        reason: 'mode_canary_non_canary_request',
      }
    }
    return {
      readFromLeagueScoped: true,
      allowGlobalFallback: true,
      allowComputeFallback: true,
      reason: 'mode_canary_request',
    }
  }

  return {
    readFromLeagueScoped: true,
    allowGlobalFallback: true,
    allowComputeFallback: true,
    reason: 'mode_on',
  }
}
