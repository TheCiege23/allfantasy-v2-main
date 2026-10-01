/**
 * League Health Service — Phase 10. Pure function only.
 *
 * Consolidates League Health into one canonical LeagueHealthAssessment by
 * reading directly from resolveDecisionOsLeagueHealth's real output (already
 * assembled into CommissionerContext.missionControl.leagueHealth) — the
 * score itself is monitorLeagueHealth()'s own untouched output, never
 * recomputed here. This module's only real job is mapping the engine's
 * 5-value OverallStatus ('excellent'|'healthy'|'watch'|'at_risk'|'critical')
 * onto this service's simpler 4-category contract (per the brief's suggested
 * categories) plus an honest 'unavailable' state — 'excellent' and 'healthy'
 * both map to 'healthy' since the brief's own category list doesn't
 * distinguish them.
 */

import type { CommissionerContext, LeagueHealthAssessment, LeagueHealthCategory } from './types'

const STATUS_TO_CATEGORY: Record<string, LeagueHealthCategory> = {
  excellent: 'healthy',
  healthy: 'healthy',
  watch: 'watch',
  at_risk: 'attention_required',
  critical: 'critical',
}

export function buildLeagueHealthAssessment(context: CommissionerContext): LeagueHealthAssessment {
  const generatedAt = new Date().toISOString()

  if (!context.missionControl.leagueHealth.available) {
    return {
      leagueId: context.leagueId,
      category: 'unavailable',
      score: 0,
      issues: [],
      evidence: [],
      confidence: 0,
      freshness: 'unknown',
      sourceAttribution: {
        source: 'league-health-service',
        fetchedAt: generatedAt,
        providerTimestamp: null,
        freshness: 'unknown',
        confidence: 0,
        missingDataReason: 'League health could not be resolved for this league.',
      },
    }
  }

  const { engine } = context.missionControl.leagueHealth.result
  const category = STATUS_TO_CATEGORY[engine.overallStatus] ?? 'unavailable'

  return {
    leagueId: context.leagueId,
    category,
    score: engine.leagueHealthScore,
    issues: engine.biggestProblems,
    evidence: [...engine.urgentAlerts, ...engine.earlyWarningSignals],
    confidence: engine.confidencePct,
    freshness: 'fresh',
    sourceAttribution: {
      source: 'monitorLeagueHealth (via resolveDecisionOsLeagueHealth)',
      fetchedAt: generatedAt,
      providerTimestamp: engine.generatedAt,
      freshness: 'fresh',
      confidence: engine.confidencePct,
      missingDataReason: null,
    },
  }
}
