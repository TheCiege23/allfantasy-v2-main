/**
 * Decision OS — Phase 7.2 Intelligence API Presentation Adapters.
 *
 * Pure bridge functions that map internal behavioral intelligence types to IPM
 * API presentation shapes for the `view=presentation` API response mode.
 *
 * Architecture constraints (ADR_F7_2_PRESENTATION_VIEW_MODE.md):
 *   - Pure functions: no IO, no DB, no auth, no network calls
 *   - No input mutation
 *   - No internal Decision OS fields in output (same STRIPS discipline as resolvers.ts)
 *   - No frontend-specific code: no CSS classes, no Tailwind, no HTML
 *   - Fields absent at this stage (archetype, benchmark) modelled as null with honest
 *     completeness — will become non-null when Phase 6 enrichment is wired
 *   - All IPM contracts stamped with PRESENTATION_VERSION (provided by IPM builders)
 *
 * ADR: ADR_F7_2_PRESENTATION_VIEW_MODE.md
 */

import type { ManagerBehavioralIntelligence }  from '../manager-intelligence'
import type { LeagueBehavioralIntelligence }   from '../league-intelligence'
import type { PlatformBehavioralIntelligence } from '../platform-intelligence'

import { buildHealthCard, buildRetentionCard, buildManagerCard, buildEngagementMetric, buildRetentionMetric } from '../../presentation/cards'
import {
  buildRecommendationPresentation,
  buildRecommendationPresentationSet,
} from '../../presentation/recommendations'
import {
  buildLeagueApiPresentation,
  buildManagerApiPresentation,
  buildPlatformApiPresentation,
} from '../../presentation/api-presentation'
import type {
  LeagueApiPresentation,
  ManagerApiPresentation,
  PlatformApiPresentation,
  MetricPresentation,
  Badge,
} from '../../presentation/types'
import { PRESENTATION_VERSION, scoreToColorToken } from '../../presentation/tokens'

// ── Shared helpers ────────────────────────────────────────────────────────────

function noOpBadges(): Badge[] { return [] }

function simpleMetric(
  entityId: string,
  key: string,
  label: string,
  displayValue: string,
  progressValue: number | null,
  completeness: number,
): MetricPresentation {
  const color = scoreToColorToken(progressValue ?? 0)
  return {
    metricId: `metric_${entityId}_${key}`,
    label,
    displayValue,
    numericValue: progressValue,
    colorToken: color,
    severityToken: color === 'success' ? 'positive'
      : color === 'warning' ? 'standard'
      : color === 'danger' || color === 'critical' ? 'elevated'
      : 'advisory',
    trend: null,
    subtext: null,
    progressValue,
    derivation: [`${key}=${displayValue} → metric`],
    completeness,
  }
}

// ── League adapter ────────────────────────────────────────────────────────────

/**
 * Adapts `LeagueBehavioralIntelligence` to `LeagueApiPresentation`.
 *
 * Archetype and benchmark are null — they require Phase 6 enrichment not yet
 * wired into the data provider. completeness is downgraded by 10 points when
 * either is absent to surface the data gap honestly.
 */
export function adaptLeagueBehavioralToPresentation(
  intel: LeagueBehavioralIntelligence,
): LeagueApiPresentation {
  const id = intel.leagueId
  const score = intel.leagueEngagementScore
  const completeness = Math.max(0, intel.completeness - 10) // archetype/benchmark absent

  const healthCard = buildHealthCard(id, score, intel.leagueEngagementTier, {
    completeness: intel.completeness,
    derivation: [`engagementScore=${score} tier=${intel.leagueEngagementTier} → health`],
  })

  const retentionCard = buildRetentionCard(
    id,
    intel.retentionRisk,
    intel.retentionRiskReasons,
    {
      managersAtRisk: intel.participationDistribution.inactiveManagers,
      totalManagers:  intel.participationDistribution.totalManagers,
      completeness:   intel.completeness,
    },
  )

  // Map league recommendations to IPM
  type RawRec = Parameters<typeof buildRecommendationPresentation>[0]
  const rawRecs: RawRec[] = intel.recommendations.map((rec, i) => ({
    id: rec.recommendationId ?? `rec_${id}_${i}`,
    tier: 'commissioner',
    category: rec.category === 'retention' ? 'retention_intervention'
      : rec.category === 'engagement' ? 'weekly_recap'
      : rec.category === 'activity' ? 'trade_activation'
      : 'weekly_recap',
    entityId: id,
    priority: rec.priority,
    severity: rec.priority === 'critical' ? 'urgent'
      : rec.priority === 'high' ? 'elevated'
      : rec.priority === 'medium' ? 'standard'
      : 'advisory',
    confidence: 'medium',
    affectedDimensions: [rec.category],
    expectedImpact: rec.message,
    derivation: [`category=${rec.category} priority=${rec.priority}`],
    evidence: [],
    benchmarkComparison: null,
    prerequisites: [],
    recommendedActions: [{ action: rec.message, rationale: 'Commissioner recommendation' }],
    rollbackCriteria: [],
    completeness: intel.completeness,
    uncertainty: [],
  }))

  const recommendationSet = buildRecommendationPresentationSet(
    rawRecs.map((rec) => buildRecommendationPresentation(rec)),
    id,
    'commissioner',
  )

  const metrics: MetricPresentation[] = [
    simpleMetric(id, 'engagement', 'Engagement Score', String(score), score, intel.completeness),
    simpleMetric(
      id, 'participation', 'Active Managers',
      `${intel.participationDistribution.activeManagers}/${intel.participationDistribution.totalManagers}`,
      intel.participationDistribution.activePercent,
      intel.completeness,
    ),
    simpleMetric(
      id, 'trade_rate', 'Trade Activity',
      String(intel.tradeActivity.tier),
      intel.tradeActivity.perManagerRate * 10, // normalize to 0-100-ish
      intel.completeness,
    ),
    simpleMetric(
      id, 'waiver_rate', 'Waiver Activity',
      String(intel.waiverActivity.tier),
      intel.waiverActivity.perManagerRate * 10,
      intel.completeness,
    ),
  ]

  return buildLeagueApiPresentation({
    leagueId:       id,
    healthCard,
    archetypeCard:  null,    // absent: Phase 6 archetype not yet wired
    benchmarkCard:  null,    // absent: Phase 6 benchmark not yet wired
    retentionCard,
    badges:         noOpBadges(),
    recommendations: recommendationSet,
    metrics,
    completeness,
  })
}

// ── Manager adapter ───────────────────────────────────────────────────────────

/**
 * Adapts `ManagerBehavioralIntelligence` to `ManagerApiPresentation`.
 *
 * DNA card is null — requires Phase 6.2 enrichment not yet wired.
 * completeness downgraded by 5 points when DNA is absent.
 */
export function adaptManagerBehavioralToPresentation(
  intel: ManagerBehavioralIntelligence,
): ManagerApiPresentation {
  const id = intel.managerId
  const score = intel.overallEngagementScore
  const completeness = Math.max(0, intel.completeness - 5)

  const managerCard = buildManagerCard(
    id,
    intel.leagueId,
    {
      participationTier: intel.participationTier,
      retentionRisk: intel.retentionRisk,
      overallEngagementScore: score,
      daysSinceLastActivity: intel.daysSinceLastActivity,
      isInactive: intel.isInactive,
      completeness: intel.completeness,
    },
  )

  const retentionMetric = buildRetentionMetric(id, intel.retentionRisk, intel.completeness)
  const engagementMetric = buildEngagementMetric(
    id,
    score,
    intel.participationTier === 'elite' || intel.participationTier === 'active' ? 'active'
      : intel.participationTier === 'moderate' ? 'moderate' : 'low',
    intel.completeness,
  )

  const dimMetrics: MetricPresentation[] = [
    simpleMetric(id, 'lineup',  'Lineup',  String(intel.lineupEngagement.score), intel.lineupEngagement.score,  intel.completeness),
    simpleMetric(id, 'waiver',  'Waiver',  String(intel.waiverEngagement.score), intel.waiverEngagement.score,  intel.completeness),
    simpleMetric(id, 'trade',   'Trade',   String(intel.tradeEngagement.score),  intel.tradeEngagement.score,   intel.completeness),
    simpleMetric(id, 'draft',   'Draft',   String(intel.draftEngagement.score),  intel.draftEngagement.score,   intel.completeness),
  ]

  const metrics = [retentionMetric, engagementMetric, ...dimMetrics]

  return buildManagerApiPresentation({
    managerId:      id,
    managerCard,
    dnaCard:        null,   // absent: Phase 6.2 DNA not yet wired
    badges:         noOpBadges(),
    recommendations: null,
    metrics,
    completeness,
  })
}

// ── Platform adapter ──────────────────────────────────────────────────────────

/**
 * Adapts `PlatformBehavioralIntelligence` to `PlatformApiPresentation`.
 */
export function adaptPlatformBehavioralToPresentation(
  intel: PlatformBehavioralIntelligence,
): PlatformApiPresentation {
  const id = 'platform'
  const score = intel.platformEngagementScore

  const healthMetric = simpleMetric(
    id, 'platform_health', 'Platform Health', String(score), score, intel.completeness,
  )
  const retentionMetric = simpleMetric(
    id, 'at_risk_pct', 'Managers At Risk',
    `${intel.retentionDistribution.managerAtRiskPercent}%`,
    100 - intel.retentionDistribution.managerAtRiskPercent,
    intel.completeness,
  )
  const leagueHealthMetric = simpleMetric(
    id, 'league_health_pct', 'Healthy Leagues',
    `${intel.leagueHealthDistribution.healthyPercent}%`,
    intel.leagueHealthDistribution.healthyPercent,
    intel.completeness,
  )

  const interventions = intel.interventionOpportunities.slice(0, 20).map((opp) => ({
    scope:    opp.scope,
    priority: opp.priority,
    message:  opp.message,
  }))

  return buildPlatformApiPresentation(
    {
      platformId:     id,
      fullDashboard:  null as never,  // not needed for API presentation adapter path
      badges:         noOpBadges(),
      recommendations: null,
      metrics:        [healthMetric, retentionMetric, leagueHealthMetric],
      completeness:   intel.completeness,
    },
    {
      platformEngagementScore: score,
      platformEngagementTier:  intel.platformEngagementTier,
      leagueCount:             intel.leagueHealthDistribution.totalLeagues,
      managerCount:            intel.retentionDistribution.totalManagers,
      archetypeDistribution:   undefined,
      interventions,
    },
  )
}

// ── Presentation version export (for handler meta) ────────────────────────────

export { PRESENTATION_VERSION }
