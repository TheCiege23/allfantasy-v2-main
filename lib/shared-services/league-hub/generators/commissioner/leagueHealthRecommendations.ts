/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 5,
 * League Health domain.
 *
 * A thin mapper, not a scorer — the real health score comes from
 * `monitorLeagueHealth()` via `lib/shared-services/commissioner/LeagueHealthService.ts`'s
 * `buildLeagueHealthAssessment()`, already computed in `CommissionerOsContext.health`.
 * This generator never recomputes the score; narrative generation never
 * determines it either (per the explicit guardrail).
 */
import type { CommissionerOsContext } from '../../commissionerOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../../types'

/** Maps the real shared-service's 5-category output onto the phase brief's suggested health bands. */
const CATEGORY_TO_BAND: Record<string, string> = {
  healthy: 'healthy',
  watch: 'stable',
  attention_required: 'declining',
  critical: 'at_risk',
  unavailable: 'insufficient_evidence',
}

const CATEGORY_TO_PRIORITY: Record<string, LeagueRecommendation['priority']> = {
  healthy: 'low',
  watch: 'medium',
  attention_required: 'high',
  critical: 'critical',
  unavailable: 'low',
}

export function generateLeagueHealthRecommendations(
  context: CommissionerOsContext,
  generatedAt: string
): LeagueRecommendation[] {
  const { health } = context
  const priority = CATEGORY_TO_PRIORITY[health.category] ?? 'medium'
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  const band = CATEGORY_TO_BAND[health.category] ?? 'insufficient_evidence'
  const isUnavailable = health.category === 'unavailable'

  return [
    buildRecommendation({
      leagueId: context.canonicalLeagueId,
      domain: 'commissioner',
      type: 'league_health_score',
      key: 'league-health',
      priority,
      title: isUnavailable ? 'League health could not be assessed' : `League health: ${band.replace('_', ' ')}`,
      summary: isUnavailable
        ? health.sourceAttribution.missingDataReason ?? 'League health data is unavailable for this league.'
        : `Overall score ${health.score.toFixed(0)}/100 (${band.replace('_', ' ')}). ${health.issues.length} issue(s) flagged.`,
      rationale: health.issues.length > 0 ? health.issues : ['No specific issues flagged by the health engine this period.'],
      evidence: health.evidence.map((detail, i) => ({ label: `Signal ${i + 1}`, detail, source: 'monitorLeagueHealth' })),
      confidence: health.confidence / 100,
      sourceFreshness: context.syncFreshness,
      executionCapability: 'recommendation_only',
      commissionerScope: 'league_wide',
      publicationAudience: 'commissioner_only',
      governanceSeverity: 'none',
      generatedAt,
    }),
  ]
}
