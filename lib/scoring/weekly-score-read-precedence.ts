export type WeeklyScoreReadSource = 'league_scoped' | 'global' | 'compute' | 'none'

export type WeeklyScoreReadDecision = {
  source: WeeklyScoreReadSource
  reason:
    | 'league_scoped_row_present'
    | 'league_scoped_required_no_fallback'
    | 'league_scoped_required_compute_fallback'
    | 'global_allowed_and_present'
    | 'compute_requested'
    | 'no_source_available'
}

export type ResolveWeeklyScoreReadInput = {
  hasLeagueScopedScore: boolean
  hasGlobalScore: boolean
  /**
   * When true, global PWS fallback is disallowed.
   */
  leagueScopedRequired: boolean
  /**
   * Intended for standardized contexts only.
   */
  allowGlobalFallback: boolean
  /**
   * Explicit diagnostic/compute path; never implied.
   */
  allowComputeFallback: boolean
  telemetry?: (event: 'global_fallback_prevented', payload: { hasGlobalScore: boolean; reason: string }) => void
}

/**
 * Phase 7H read contract (not wired to consumers yet):
 * 1) league-scoped row
 * 2) global row only in allowed standard contexts
 * 3) compute fallback only when explicitly requested
 */
export function resolveWeeklyScoreReadDecision(input: ResolveWeeklyScoreReadInput): WeeklyScoreReadDecision {
  if (input.hasLeagueScopedScore) {
    return { source: 'league_scoped', reason: 'league_scoped_row_present' }
  }

  if (input.leagueScopedRequired) {
    if (input.allowComputeFallback) {
      return { source: 'compute', reason: 'league_scoped_required_compute_fallback' }
    }
    if (input.hasGlobalScore && input.allowGlobalFallback) {
      input.telemetry?.('global_fallback_prevented', {
        hasGlobalScore: true,
        reason: 'league_scoped_required_no_fallback',
      })
    }
    return { source: 'none', reason: 'league_scoped_required_no_fallback' }
  }

  if (input.allowGlobalFallback && input.hasGlobalScore) {
    return { source: 'global', reason: 'global_allowed_and_present' }
  }

  if (input.allowComputeFallback) {
    return { source: 'compute', reason: 'compute_requested' }
  }

  return { source: 'none', reason: 'no_source_available' }
}

