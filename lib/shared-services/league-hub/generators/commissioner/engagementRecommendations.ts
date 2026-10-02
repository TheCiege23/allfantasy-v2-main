/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 6,
 * engagement domain.
 *
 * Maps real, already-computed `CommissionerAttentionItem`s
 * (`lib/shared-services/commissioner/CommissionerAttentionService.ts`,
 * itself reusing `deriveLeagueAttentionSignals()` — a real engine this
 * phase's inventory found had no live consumer until now) into engagement
 * recommendations. Deliberately excludes `lineup_attention_carryover`
 * items (member-permission, per-roster — those belong to the User OS
 * lineup domain, not a commissioner-wide engagement action) and
 * deliberately does NOT recommend "artificial engagement" (a scheduled
 * post, a poll) when no real evidence backs it — every recommendation here
 * traces to a real attention signal or a real recommended action from
 * Mission Control, never a generic "engage your league!" suggestion.
 *
 * Part 18 — also excludes `manager_engagement_risk` items
 * (`lib/decision-os/attentionSignals.ts::managerEngagementRiskSignal`, title
 * "This team has gone inactive") for a snapshot-only (Fantrax CSV) league.
 * That signal is an ongoing-inactivity claim; a single point-in-time upload
 * can never prove an ongoing pattern, only a lineup's state at upload time.
 */
import type { CommissionerOsContext } from '../../commissionerOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../../types'

const SEVERITY_TO_PRIORITY: Record<string, LeagueRecommendation['priority']> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  informational: 'low',
}

export function generateEngagementRecommendations(
  context: CommissionerOsContext,
  generatedAt: string
): LeagueRecommendation[] {
  const recommendations: LeagueRecommendation[] = []

  const leagueWideItems = context.attentionItems.filter(
    (item) =>
      item.reasonCode !== 'lineup_attention_carryover' &&
      !(context.isSnapshotOnly && item.category === 'manager_engagement_risk')
  )
  for (const item of leagueWideItems) {
    const priority = SEVERITY_TO_PRIORITY[item.severity] ?? 'medium'
    if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) continue

    recommendations.push(
      buildRecommendation({
        leagueId: context.canonicalLeagueId,
        domain: 'commissioner',
        type: `engagement_${item.category}`,
        key: `${item.reasonCode}-${item.category}`,
        priority,
        title: item.message,
        summary: item.recommendedAction ?? item.message,
        rationale: item.evidence,
        evidence: item.evidence.map((detail, i) => ({ label: `Signal ${i + 1}`, detail, source: 'deriveLeagueAttentionSignals' })),
        affectedManagerIds: item.affectedManagerIds,
        confidence: item.confidence / 100,
        sourceFreshness: context.syncFreshness,
        executionCapability: item.actionAvailableInApp ? 'copy_action' : 'recommendation_only',
        action: item.providerDeepLink ? { label: 'Open', href: item.providerDeepLink } : undefined,
        commissionerScope: item.affectedManagerIds.length === 1 ? 'single_manager' : 'league_wide',
        publicationAudience: 'commissioner_only',
        governanceSeverity: 'none',
        generatedAt,
      })
    )
  }

  // Real recommended actions from Mission Control (already deterministic, already surfaced in the
  // real Commissioner Brief's "commissioner_actions" section) — not duplicated logic, just mapped.
  for (const action of context.shared.missionControl.recommendedActions) {
    const priority: LeagueRecommendation['priority'] = action.priority === 'urgent' ? 'high' : 'medium'
    if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) continue
    recommendations.push(
      buildRecommendation({
        leagueId: context.canonicalLeagueId,
        domain: 'commissioner',
        type: 'mission_control_action',
        key: action.message,
        priority,
        title: action.message,
        summary: action.message,
        rationale: [`Mission Control priority: ${action.priority}.`],
        evidence: [{ label: 'Source', detail: 'resolveMissionControlSnapshot', source: 'lib/decision-os/missionControl.ts' }],
        sourceFreshness: context.syncFreshness,
        executionCapability: 'recommendation_only',
        commissionerScope: 'league_wide',
        publicationAudience: 'commissioner_only',
        governanceSeverity: 'none',
        generatedAt,
      })
    )
  }

  return recommendations
}
