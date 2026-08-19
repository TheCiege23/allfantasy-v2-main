import type {
  CompanyIntelligenceInput,
  CompanyIntelligenceResult,
  RetentionDriverInsight,
  ChurnRiskFactor,
  FeatureAdoptionOpportunity,
  CommissionerBehaviorInsight,
  LeagueFormatEffectiveness,
  EngagementHealthSummary,
  CohortRecommendation,
  MonetizationSignal,
  DataQualityReport,
  DriverStrength,
  ChurnRiskLevel,
  AdoptionGap,
  CommissionerPrevalence,
  EngagementSignal,
  RetentionSignal,
  HealthTier,
  MonetizationPotential,
  LeagueSignalAggregateSlice,
  ArchetypeDistributionSlice,
} from './types'

export const COMPANY_INTELLIGENCE_VERSION = '6.6.0'

// ── Weights and thresholds ────────────────────────────────────────────────────

const HEALTH_WEIGHT_PASSIVE_DORMANT = 30
const HEALTH_WEIGHT_CRITICAL_RETENTION = 35
const HEALTH_WEIGHT_INACTIVE_ARCHETYPE = 20
const HEALTH_DEDUCTION_INSUFFICIENT_DATA = 10

// ── Utility helpers ───────────────────────────────────────────────────────────

function countOf(counts: Partial<Record<string, number>>, ...keys: string[]): number {
  return keys.reduce((sum, k) => sum + (counts[k] ?? 0), 0)
}

function frac(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100) / 100
}

function driverStrength(fraction: number): DriverStrength | null {
  if (fraction >= 0.35) return 'strong'
  if (fraction >= 0.15) return 'moderate'
  if (fraction >= 0.05) return 'weak'
  return null
}

function churnRiskLevel(fraction: number): ChurnRiskLevel | null {
  if (fraction > 0.40) return 'critical'
  if (fraction > 0.25) return 'high'
  if (fraction > 0.10) return 'medium'
  if (fraction > 0.05) return 'low'
  return null
}

function adoptionGap(fraction: number): AdoptionGap | null {
  if (fraction > 0.40) return 'large'
  if (fraction > 0.20) return 'moderate'
  if (fraction > 0.05) return 'small'
  return null
}

function commissionerPrevalence(fraction: number): CommissionerPrevalence | null {
  if (fraction >= 0.40) return 'widespread'
  if (fraction >= 0.20) return 'common'
  if (fraction >= 0.08) return 'occasional'
  if (fraction >= 0.02) return 'rare'
  return null
}

function monetizationPotential(fraction: number, highThreshold: number, modThreshold: number): MonetizationPotential | null {
  if (fraction >= highThreshold) return 'high'
  if (fraction >= modThreshold) return 'moderate'
  return null
}

function strengthOrder(s: DriverStrength): number {
  return s === 'strong' ? 3 : s === 'moderate' ? 2 : 1
}

function riskOrder(r: ChurnRiskLevel): number {
  return r === 'critical' ? 4 : r === 'high' ? 3 : r === 'medium' ? 2 : 1
}

function gapOrder(g: AdoptionGap): number {
  return g === 'large' ? 3 : g === 'moderate' ? 2 : 1
}

function potentialOrder(p: MonetizationPotential): number {
  return p === 'high' ? 2 : 1
}

function priorityOrder(p: 'high' | 'medium' | 'low'): number {
  return p === 'high' ? 3 : p === 'medium' ? 2 : 1
}

// ── Health score ──────────────────────────────────────────────────────────────

function healthTier(score: number): HealthTier {
  if (score >= 80) return 'excellent'
  if (score >= 65) return 'good'
  if (score >= 50) return 'moderate'
  if (score >= 35) return 'poor'
  return 'critical'
}

function computeHealthScore(
  passiveDormantFraction: number,
  criticalRetentionFraction: number,
  inactiveArchetypeFraction: number,
  insufficientData: boolean,
): number {
  const deduction =
    HEALTH_WEIGHT_PASSIVE_DORMANT * passiveDormantFraction +
    HEALTH_WEIGHT_CRITICAL_RETENTION * criticalRetentionFraction +
    HEALTH_WEIGHT_INACTIVE_ARCHETYPE * inactiveArchetypeFraction +
    (insufficientData ? HEALTH_DEDUCTION_INSUFFICIENT_DATA : 0)
  return Math.max(0, Math.min(100, Math.round(100 - deduction)))
}

// ── Archetype signal map ──────────────────────────────────────────────────────

function archetypeEngagementSignal(label: string): EngagementSignal {
  switch (label) {
    case 'highly_engaged':
    case 'competitive_balanced':
      return 'high'
    case 'trade_heavy':
    case 'waiver_active':
    case 'commissioner_driven':
    case 'casual_social':
      return 'moderate'
    case 'low_engagement':
    case 'high_churn_risk':
    case 'inactive_or_stale':
      return 'low'
    default:
      return 'unknown'
  }
}

function archetypeRetentionSignal(label: string): RetentionSignal {
  switch (label) {
    case 'highly_engaged':
    case 'competitive_balanced':
      return 'strong'
    case 'trade_heavy':
    case 'waiver_active':
    case 'commissioner_driven':
    case 'casual_social':
      return 'moderate'
    case 'low_engagement':
    case 'high_churn_risk':
    case 'inactive_or_stale':
      return 'at_risk'
    default:
      return 'unknown'
  }
}

// ── Cohort recommendation templates ──────────────────────────────────────────

interface CohortTemplate {
  priority: 'high' | 'medium' | 'low'
  recommendation: string
  expectedImpact: string
}

const COHORT_TEMPLATES: Partial<Record<string, CohortTemplate>> = {
  inactive_or_stale: {
    priority: 'high',
    recommendation:
      'Deploy commissioner re-engagement prompts; review platform notification cadence for inactive segments; consider seasonal archival policy after extended inactivity.',
    expectedImpact: 'Reduced stale league accumulation; improved platform health score.',
  },
  high_churn_risk: {
    priority: 'high',
    recommendation:
      'Trigger commissioner-directed retention interventions; surface low-friction engagement actions (polls, recap posts); identify whether low transaction activity is the primary dropout signal.',
    expectedImpact: 'Lower seasonal dropout rate; improved retention safety score.',
  },
  low_engagement: {
    priority: 'medium',
    recommendation:
      'Expand feature discovery pathways for low-engagement segments; test onboarding improvements for recently-created leagues in this cohort.',
    expectedImpact: 'Migration of leagues from low_engagement to casual_social or higher within one season.',
  },
  commissioner_driven: {
    priority: 'medium',
    recommendation:
      'Provide commissioner efficiency tools; surface workload-reduction features; benchmark commissioner activity against peer leagues.',
    expectedImpact: 'Reduced commissioner workload burden; improved league health score for this cohort.',
  },
}

// ── Section assemblers ────────────────────────────────────────────────────────

function assembleRetentionDrivers(input: CompanyIntelligenceInput): RetentionDriverInsight[] {
  const drivers: RetentionDriverInsight[] = []
  const dist = input.archetypeDistribution
  const signals = input.leagueSignals
  const total = signals?.totalLeagues ?? dist?.totalClassified ?? 0

  // Driver 1: high-engagement format prevalence
  if (dist && dist.totalClassified > 0) {
    const n = countOf(dist.distribution, 'highly_engaged', 'competitive_balanced')
    const fraction = frac(n, dist.totalClassified)
    const strength = driverStrength(fraction)
    if (strength) {
      drivers.push({
        driverKey: 'high_engagement_format_prevalence',
        label: 'High-engagement league formats',
        strength,
        affectedLeagueFraction: fraction,
        derivation: [
          `highly_engaged + competitive_balanced archetypes: ${n} / ${dist.totalClassified} leagues`,
          `fraction=${fraction}, strength=${strength}`,
        ],
        actionableSignal:
          'Invest in features that support high-engagement league formats; these show the strongest seasonal completion and return-season patterns.',
        completeness: 80,
      })
    }
  }

  // Driver 2: active transaction culture (trade + waiver both moderate+)
  if (signals && signals.totalLeagues > 0) {
    const activeTrade = countOf(signals.tradeActivityTierCounts, 'moderate', 'high')
    const activeWaiver = countOf(signals.waiverActivityTierCounts, 'moderate', 'high')
    const combinedFraction = frac(
      Math.min(activeTrade, activeWaiver),
      signals.totalLeagues,
    )
    const strength = driverStrength(combinedFraction)
    if (strength) {
      drivers.push({
        driverKey: 'active_transaction_culture',
        label: 'Active trade and waiver culture',
        strength,
        affectedLeagueFraction: combinedFraction,
        derivation: [
          `active trade leagues: ${activeTrade}, active waiver leagues: ${activeWaiver}`,
          `combined floor fraction: ${combinedFraction} of ${signals.totalLeagues}`,
          `strength=${strength}`,
        ],
        actionableSignal:
          'Leagues where both trading and waiver claims are regularly used show reduced dormancy. Prioritize features that reduce friction for both transaction types.',
        completeness: 75,
      })
    }
  }

  // Driver 3: low retention risk prevalence
  if (signals && signals.totalLeagues > 0) {
    const lowRiskCount = countOf(signals.retentionRiskCounts, 'low')
    const fraction = frac(lowRiskCount, signals.totalLeagues)
    const strength = driverStrength(fraction)
    if (strength) {
      drivers.push({
        driverKey: 'low_retention_risk_prevalence',
        label: 'Low churn risk across leagues',
        strength,
        affectedLeagueFraction: fraction,
        derivation: [
          `leagues with low retention risk: ${lowRiskCount} / ${signals.totalLeagues}`,
          `fraction=${fraction}, strength=${strength}`,
        ],
        actionableSignal:
          'A healthy low-risk cohort provides a stable retention baseline. Sustaining these leagues through active commissioner support is the highest-leverage retention investment.',
        completeness: 75,
      })
    }
  }

  // Driver 4: balanced commissioner engagement (moderate workload = sweet spot)
  if (signals && signals.totalLeagues > 0) {
    const moderateCount = countOf(signals.commissionerWorkloadCounts, 'moderate')
    const fraction = frac(moderateCount, signals.totalLeagues)
    const strength = driverStrength(fraction)
    if (strength) {
      drivers.push({
        driverKey: 'commissioner_moderation_pattern',
        label: 'Balanced commissioner engagement',
        strength,
        affectedLeagueFraction: fraction,
        derivation: [
          `leagues with moderate commissioner workload: ${moderateCount} / ${signals.totalLeagues}`,
          `fraction=${fraction}, strength=${strength}`,
          'moderate workload = commissioner is engaged without being overloaded',
        ],
        actionableSignal:
          'Commissioners with balanced activity levels correlate with healthier leagues. Tools that reduce workload while maintaining engagement can expand this cohort.',
        completeness: 70,
      })
    }
  }

  // Sort: strength DESC
  return drivers.sort((a, b) => strengthOrder(b.strength) - strengthOrder(a.strength))
}

function assembleChurnRiskFactors(input: CompanyIntelligenceInput): ChurnRiskFactor[] {
  const factors: ChurnRiskFactor[] = []
  const signals = input.leagueSignals
  const dist = input.archetypeDistribution

  // Factor 1: passive/dormant league accumulation
  if (signals && signals.totalLeagues > 0) {
    const count = countOf(signals.engagementTierCounts, 'passive', 'dormant')
    const fraction = frac(count, signals.totalLeagues)
    const risk = churnRiskLevel(fraction)
    if (risk) {
      factors.push({
        factorKey: 'passive_dormant_accumulation',
        label: 'Passive and dormant league accumulation',
        riskLevel: risk,
        affectedLeagueFraction: fraction,
        derivation: [
          `passive + dormant leagues: ${count} / ${signals.totalLeagues}`,
          `fraction=${fraction}, riskLevel=${risk}`,
        ],
        mitigationSignal:
          'Re-engage through commissioner-directed events and automated reminder nudges. Target the passive tier first — dormant leagues have higher revival cost.',
        completeness: 80,
      })
    }
  }

  // Factor 2: high retention risk concentration
  if (signals && signals.totalLeagues > 0) {
    const count = countOf(signals.retentionRiskCounts, 'high', 'critical')
    const fraction = frac(count, signals.totalLeagues)
    const risk = churnRiskLevel(fraction)
    if (risk) {
      factors.push({
        factorKey: 'high_retention_risk_concentration',
        label: 'High-risk retention signal concentration',
        riskLevel: risk,
        affectedLeagueFraction: fraction,
        derivation: [
          `high + critical retention risk leagues: ${count} / ${signals.totalLeagues}`,
          `fraction=${fraction}, riskLevel=${risk}`,
        ],
        mitigationSignal:
          'Deploy commissioner retention intervention recommendations to all leagues in the high/critical tier. Prioritize critical-risk leagues within 2 weeks.',
        completeness: 80,
      })
    }
  }

  // Factor 3: inactive manager saturation
  if (signals && signals.inactiveManagerFractionAvg > 0) {
    const fraction = Math.round(signals.inactiveManagerFractionAvg * 100) / 100
    const risk = churnRiskLevel(fraction)
    if (risk) {
      factors.push({
        factorKey: 'inactive_manager_saturation',
        label: 'Platform-wide manager inactivity',
        riskLevel: risk,
        affectedLeagueFraction: fraction,
        derivation: [
          `average inactive manager fraction across leagues: ${fraction}`,
          `riskLevel=${risk}`,
          'inactive manager fraction = fraction of managers with no events in trailing 30-day window',
        ],
        mitigationSignal:
          'Target engagement features at managers in passive engagement tiers; commissioner-initiated personal outreach has highest re-activation rate.',
        completeness: 70,
      })
    }
  }

  // Factor 4: stale league archetype concentration
  if (dist && dist.totalClassified > 0) {
    const count = countOf(dist.distribution, 'inactive_or_stale', 'high_churn_risk')
    const fraction = frac(count, dist.totalClassified)
    const risk = churnRiskLevel(fraction)
    if (risk) {
      factors.push({
        factorKey: 'stale_league_concentration',
        label: 'Inactive and high-churn league concentration',
        riskLevel: risk,
        affectedLeagueFraction: fraction,
        derivation: [
          `inactive_or_stale + high_churn_risk leagues: ${count} / ${dist.totalClassified}`,
          `fraction=${fraction}, riskLevel=${risk}`,
        ],
        mitigationSignal:
          'Review archetype migration patterns season-over-season; set an archival threshold for inactive_or_stale leagues to keep metrics actionable.',
        completeness: 75,
      })
    }
  }

  // Sort: riskLevel DESC
  return factors.sort((a, b) => riskOrder(b.riskLevel) - riskOrder(a.riskLevel))
}

function assembleFeatureAdoptionOpportunities(
  input: CompanyIntelligenceInput,
): FeatureAdoptionOpportunity[] {
  const opps: FeatureAdoptionOpportunity[] = []
  const signals = input.leagueSignals
  const dist = input.archetypeDistribution

  // Opportunity 1: waiver wire engagement gap
  if (signals && signals.totalLeagues > 0) {
    const lowCount = countOf(signals.waiverActivityTierCounts, 'none', 'low')
    const fraction = frac(lowCount, signals.totalLeagues)
    const gap = adoptionGap(fraction)
    if (gap) {
      opps.push({
        opportunityKey: 'waiver_wire_engagement',
        label: 'Waiver wire feature adoption',
        adoptionGap: gap,
        targetArchetypeLabels: ['low_engagement', 'casual_social', 'inactive_or_stale'],
        potentialLeagueFraction: fraction,
        derivation: [
          `leagues with none/low waiver activity: ${lowCount} / ${signals.totalLeagues}`,
          `fraction=${fraction}, gap=${gap}`,
        ],
        completeness: 75,
      })
    }
  }

  // Opportunity 2: trade market activation gap
  if (signals && signals.totalLeagues > 0) {
    const lowCount = countOf(signals.tradeActivityTierCounts, 'none', 'low')
    const fraction = frac(lowCount, signals.totalLeagues)
    const gap = adoptionGap(fraction)
    if (gap) {
      opps.push({
        opportunityKey: 'trade_market_activation',
        label: 'Trade market feature adoption',
        adoptionGap: gap,
        targetArchetypeLabels: ['casual_social', 'waiver_active', 'inactive_or_stale'],
        potentialLeagueFraction: fraction,
        derivation: [
          `leagues with none/low trade activity: ${lowCount} / ${signals.totalLeagues}`,
          `fraction=${fraction}, gap=${gap}`,
        ],
        completeness: 75,
      })
    }
  }

  // Opportunity 3: commissioner efficiency tools gap
  if (signals && signals.totalLeagues > 0) {
    const overloadedCount = countOf(signals.commissionerWorkloadCounts, 'heavy', 'critical')
    const fraction = frac(overloadedCount, signals.totalLeagues)
    const gap = adoptionGap(fraction)
    if (gap) {
      opps.push({
        opportunityKey: 'commissioner_efficiency_tools',
        label: 'Commissioner efficiency tool adoption',
        adoptionGap: gap,
        targetArchetypeLabels: ['commissioner_driven', 'high_churn_risk'],
        potentialLeagueFraction: fraction,
        derivation: [
          `leagues with heavy/critical commissioner workload: ${overloadedCount} / ${signals.totalLeagues}`,
          `fraction=${fraction}, gap=${gap}`,
          'heavy/critical workload indicates unmet need for commissioner tooling',
        ],
        completeness: 70,
      })
    }
  }

  // Opportunity 4: engagement feature gap (passive + dormant leagues)
  if (signals && signals.totalLeagues > 0) {
    const lowEngageCount = countOf(signals.engagementTierCounts, 'passive', 'dormant')
    const fraction = frac(lowEngageCount, signals.totalLeagues)
    const gap = adoptionGap(fraction)
    if (gap) {
      opps.push({
        opportunityKey: 'engagement_feature_adoption',
        label: 'Engagement feature discovery',
        adoptionGap: gap,
        targetArchetypeLabels: ['low_engagement', 'passive', 'inactive_or_stale'],
        potentialLeagueFraction: fraction,
        derivation: [
          `leagues with passive/dormant engagement: ${lowEngageCount} / ${signals.totalLeagues}`,
          `fraction=${fraction}, gap=${gap}`,
        ],
        completeness: 70,
      })
    }
  }

  // Sort: gap DESC (large → moderate → small)
  return opps.sort((a, b) => gapOrder(b.adoptionGap) - gapOrder(a.adoptionGap))
}

function assembleCommissionerBehaviorInsights(
  input: CompanyIntelligenceInput,
): CommissionerBehaviorInsight[] {
  const insights: CommissionerBehaviorInsight[] = []
  const signals = input.leagueSignals
  const patterns = input.patternAggregate

  // Insight 1: overloaded commissioners (negative)
  if (signals && signals.totalLeagues > 0) {
    const count = countOf(signals.commissionerWorkloadCounts, 'heavy', 'critical')
    const fraction = frac(count, signals.totalLeagues)
    const prevalence = commissionerPrevalence(fraction)
    if (prevalence) {
      insights.push({
        behaviorKey: 'overloaded_commissioners',
        label: 'Overloaded commissioners',
        prevalence,
        healthCorrelation: 'negative',
        affectedLeagueFraction: fraction,
        derivation: [
          `leagues with heavy/critical commissioner workload: ${count} / ${signals.totalLeagues}`,
          `fraction=${fraction}, prevalence=${prevalence}`,
          'heavy/critical workload correlates with commissioner burnout and league instability',
        ],
        completeness: 75,
      })
    }
  }

  // Insight 2: disengaged commissioners (light workload — proxy for low involvement) (negative)
  if (signals && signals.totalLeagues > 0) {
    const count = countOf(signals.commissionerWorkloadCounts, 'light')
    const fraction = frac(count, signals.totalLeagues)
    const prevalence = commissionerPrevalence(fraction)
    if (prevalence) {
      insights.push({
        behaviorKey: 'disengaged_commissioners',
        label: 'Low-involvement commissioners',
        prevalence,
        healthCorrelation: 'negative',
        affectedLeagueFraction: fraction,
        derivation: [
          `leagues with light commissioner workload: ${count} / ${signals.totalLeagues}`,
          `fraction=${fraction}, prevalence=${prevalence}`,
          'light workload is a proxy for low commissioner engagement; correlation with passive league tiers',
        ],
        completeness: 60,
      })
    }
  }

  // Insight 3: rules instability pattern (negative)
  if (patterns && signals && signals.totalLeagues > 0) {
    const count = patterns.leaguePatternCounts['commissioner_rules_churn'] ?? 0
    if (count > 0) {
      const fraction = frac(count, signals.totalLeagues)
      const prevalence = commissionerPrevalence(fraction)
      if (prevalence) {
        insights.push({
          behaviorKey: 'rules_instability',
          label: 'Frequent rules changes',
          prevalence,
          healthCorrelation: 'negative',
          affectedLeagueFraction: fraction,
          derivation: [
            `leagues with rules instability pattern: ${count} (proxy: ${fraction} fraction of ${signals.totalLeagues})`,
            `prevalence=${prevalence}`,
            'repeated rules changes signal commissioner uncertainty and can reduce manager trust',
          ],
          completeness: 65,
        })
      }
    }
  }

  // Insight 4: effective commissioners (moderate workload) (positive)
  if (signals && signals.totalLeagues > 0) {
    const count = countOf(signals.commissionerWorkloadCounts, 'moderate')
    const fraction = frac(count, signals.totalLeagues)
    const prevalence = commissionerPrevalence(fraction)
    if (prevalence) {
      insights.push({
        behaviorKey: 'effective_commissioner_engagement',
        label: 'Balanced commissioner engagement',
        prevalence,
        healthCorrelation: 'positive',
        affectedLeagueFraction: fraction,
        derivation: [
          `leagues with moderate commissioner workload: ${count} / ${signals.totalLeagues}`,
          `fraction=${fraction}, prevalence=${prevalence}`,
          'moderate workload = commissioner is consistently active without signs of overload',
        ],
        completeness: 70,
      })
    }
  }

  return insights
}

function assembleLeagueFormatEffectiveness(
  input: CompanyIntelligenceInput,
): LeagueFormatEffectiveness[] {
  const dist = input.archetypeDistribution
  if (!dist || dist.totalClassified === 0) return []

  const results: LeagueFormatEffectiveness[] = []

  for (const [label, count] of Object.entries(dist.distribution)) {
    if (!count || count <= 0) continue
    const leagueFraction = frac(count, dist.totalClassified)
    results.push({
      archetypeLabel: label,
      leagueCount: count,
      leagueFraction,
      engagementSignal: archetypeEngagementSignal(label),
      retentionSignal: archetypeRetentionSignal(label),
      derivation: [
        `${label}: ${count} leagues (${(leagueFraction * 100).toFixed(1)}% of classified)`,
        `engagementSignal=${archetypeEngagementSignal(label)}, retentionSignal=${archetypeRetentionSignal(label)}`,
      ],
    })
  }

  // Sort: leagueCount DESC
  return results.sort((a, b) => b.leagueCount - a.leagueCount)
}

function assembleEngagementHealthSummary(
  input: CompanyIntelligenceInput,
): EngagementHealthSummary {
  const signals = input.leagueSignals
  const dist = input.archetypeDistribution
  const benchmark = input.benchmark
  const derivation: string[] = []
  let completeness = 0

  // passive/dormant fraction
  let passiveDormantFraction = 0
  if (signals && signals.totalLeagues > 0) {
    const pd = countOf(signals.engagementTierCounts, 'passive', 'dormant')
    passiveDormantFraction = frac(pd, signals.totalLeagues)
    derivation.push(`passive+dormant leagues: ${pd}/${signals.totalLeagues} = ${passiveDormantFraction}`)
    completeness += 30
  }

  // critical retention fraction (high + critical risk)
  let criticalRetentionFraction = 0
  if (signals && signals.totalLeagues > 0) {
    const cr = countOf(signals.retentionRiskCounts, 'high', 'critical')
    criticalRetentionFraction = frac(cr, signals.totalLeagues)
    derivation.push(`high+critical retention risk: ${cr}/${signals.totalLeagues} = ${criticalRetentionFraction}`)
    completeness += 30
  }

  // inactive archetype fraction
  let inactiveArchetypeFraction = 0
  if (dist && dist.totalClassified > 0) {
    const ia = countOf(dist.distribution, 'inactive_or_stale', 'high_churn_risk')
    inactiveArchetypeFraction = frac(ia, dist.totalClassified)
    derivation.push(`inactive+churn-risk archetypes: ${ia}/${dist.totalClassified} = ${inactiveArchetypeFraction}`)
    completeness += 25
  }

  const insufficientData = benchmark?.insufficientData ?? false
  if (insufficientData) {
    derivation.push('insufficient_data flag from benchmark: applying deduction')
  }
  if (benchmark) completeness += 15

  const platformHealthScore = completeness === 0
    ? 50
    : computeHealthScore(passiveDormantFraction, criticalRetentionFraction, inactiveArchetypeFraction, insufficientData)

  // active league fraction
  let activeLeagueFraction = 0
  if (signals && signals.totalLeagues > 0) {
    const active = countOf(signals.engagementTierCounts, 'elite', 'active', 'moderate')
    activeLeagueFraction = frac(active, signals.totalLeagues)
  }

  const score = completeness === 0 ? 50 : platformHealthScore
  derivation.push(`platformHealthScore=${score} (completeness=${completeness})`)

  return {
    platformHealthScore: score,
    healthTier: completeness === 0 ? 'moderate' : healthTier(score),
    activeLeagueFraction,
    passiveDormantFraction,
    criticalRetentionFraction,
    inactiveArchetypeFraction,
    derivation,
    completeness,
  }
}

function assembleCohortRecommendations(input: CompanyIntelligenceInput): CohortRecommendation[] {
  const dist = input.archetypeDistribution
  if (!dist || dist.totalClassified === 0) return []

  const recs: CohortRecommendation[] = []

  for (const [label, template] of Object.entries(COHORT_TEMPLATES)) {
    if (!template) continue
    const count = dist.distribution[label] ?? 0
    if (count <= 0) continue
    recs.push({
      targetArchetypeLabel: label,
      targetLeagueCount: count,
      recommendation: template.recommendation,
      priority: template.priority,
      expectedImpact: template.expectedImpact,
      derivation: [
        `${label}: ${count} leagues in this cohort`,
        `priority=${template.priority} (mapped from archetype risk level)`,
      ],
    })
  }

  // Sort: priority DESC → targetLeagueCount DESC
  return recs.sort((a, b) => {
    const pd = priorityOrder(b.priority) - priorityOrder(a.priority)
    if (pd !== 0) return pd
    return b.targetLeagueCount - a.targetLeagueCount
  })
}

function assembleMonetizationSignals(input: CompanyIntelligenceInput): MonetizationSignal[] {
  const signals: MonetizationSignal[] = []
  const dist = input.archetypeDistribution
  const leagueSignals = input.leagueSignals

  // For health score, we need the passiveDormantFraction
  let passiveDormantFraction = 0
  if (leagueSignals && leagueSignals.totalLeagues > 0) {
    passiveDormantFraction = frac(
      countOf(leagueSignals.engagementTierCounts, 'passive', 'dormant'),
      leagueSignals.totalLeagues,
    )
  }

  // Signal 1: premium tier opportunity — highly engaged leagues ready for premium features
  if (dist && dist.totalClassified > 0) {
    const n = countOf(dist.distribution, 'highly_engaged', 'competitive_balanced')
    const fraction = frac(n, dist.totalClassified)
    const potential = monetizationPotential(fraction, 0.40, 0.20)
    if (potential) {
      signals.push({
        signalKey: 'premium_tier_opportunity',
        label: 'Premium feature market opportunity',
        potential,
        targetSegmentLabel: 'Highly engaged and competitively active leagues',
        potentialLeagueFraction: fraction,
        derivation: [
          `highly_engaged + competitive_balanced: ${n} / ${dist.totalClassified}`,
          `fraction=${fraction}, potential=${potential}`,
          'threshold: high ≥ 0.40, moderate ≥ 0.20',
        ],
        completeness: 70,
      })
    }
  }

  // Signal 2: commissioner tools expansion — overloaded commissioners need tooling
  if (leagueSignals && leagueSignals.totalLeagues > 0) {
    const n = countOf(leagueSignals.commissionerWorkloadCounts, 'heavy', 'critical')
    const fraction = frac(n, leagueSignals.totalLeagues)
    const potential = monetizationPotential(fraction, 0.30, 0.15)
    if (potential) {
      signals.push({
        signalKey: 'commissioner_tools_expansion',
        label: 'Commissioner tooling expansion opportunity',
        potential,
        targetSegmentLabel: 'High-workload commissioner leagues',
        potentialLeagueFraction: fraction,
        derivation: [
          `heavy + critical workload leagues: ${n} / ${leagueSignals.totalLeagues}`,
          `fraction=${fraction}, potential=${potential}`,
          'threshold: high ≥ 0.30, moderate ≥ 0.15',
        ],
        completeness: 65,
      })
    }
  }

  // Signal 3: engagement feature market — passive/dormant leagues that are still present (not abandoned)
  // Only surface if passive/dormant fraction is meaningfully above zero AND platform is not in critical health
  if (leagueSignals && leagueSignals.totalLeagues > 0 && passiveDormantFraction >= 0.20) {
    const fraction = passiveDormantFraction
    // Only if there's still activity (not all leagues are ghost)
    const activeCount = countOf(leagueSignals.engagementTierCounts, 'elite', 'active', 'moderate')
    const activeFraction = frac(activeCount, leagueSignals.totalLeagues)
    if (activeFraction >= 0.20) {
      const potential: MonetizationPotential = fraction >= 0.40 ? 'high' : 'moderate'
      signals.push({
        signalKey: 'engagement_feature_market',
        label: 'Engagement feature market opportunity',
        potential,
        targetSegmentLabel: 'Passive and low-engagement leagues with recovery potential',
        potentialLeagueFraction: fraction,
        derivation: [
          `passive + dormant leagues: ${fraction} fraction`,
          `active leagues present (${activeFraction}) — platform has recovery base`,
          `potential=${potential}`,
          're-engagement tools in this segment have demonstrable conversion if platform is not in full churn',
        ],
        completeness: 60,
      })
    }
  }

  // Sort: potential DESC
  return signals.sort((a, b) => potentialOrder(b.potential) - potentialOrder(a.potential))
}

function assembleDataQualityReport(input: CompanyIntelligenceInput): DataQualityReport {
  const warnings: string[] = []
  const derivation: string[] = []

  const benchmarkScore = (() => {
    if (!input.benchmark) return 0
    if (input.benchmark.insufficientData) {
      warnings.push('benchmark: insufficient league count for full statistical validity')
      derivation.push('benchmark present but insufficientData=true → 15/25')
      return 15
    }
    derivation.push('benchmark present and sufficient → 25/25')
    return 25
  })()

  const archetypeScore = (() => {
    const d = input.archetypeDistribution
    if (!d) return 0
    if (d.totalClassified >= 5) {
      derivation.push(`archetypeDistribution: ${d.totalClassified} classified → 20/20`)
      return 20
    }
    if (d.totalClassified >= 2) {
      warnings.push(`archetypeDistribution: only ${d.totalClassified} classified leagues — limited cohort validity`)
      derivation.push(`archetypeDistribution: ${d.totalClassified} classified → 12/20`)
      return 12
    }
    if (d.totalClassified >= 1) {
      warnings.push(`archetypeDistribution: only ${d.totalClassified} classified league — single-league data`)
      derivation.push(`archetypeDistribution: ${d.totalClassified} classified → 6/20`)
      return 6
    }
    warnings.push('archetypeDistribution: present but totalClassified=0')
    return 0
  })()

  const recScore = (() => {
    const r = input.recommendationAggregate
    if (!r) return 0
    if (r.totalRecommendations > 0) {
      derivation.push(`recommendationAggregate: ${r.totalRecommendations} recommendations → 20/20`)
      return 20
    }
    derivation.push('recommendationAggregate: present but 0 recommendations → 10/20')
    return 10
  })()

  const signalScore = (() => {
    const s = input.leagueSignals
    if (!s) return 0
    if (s.totalLeagues >= 5) {
      derivation.push(`leagueSignals: ${s.totalLeagues} leagues → 20/20`)
      return 20
    }
    if (s.totalLeagues >= 2) {
      warnings.push(`leagueSignals: only ${s.totalLeagues} leagues — limited aggregate validity`)
      derivation.push(`leagueSignals: ${s.totalLeagues} leagues → 12/20`)
      return 12
    }
    if (s.totalLeagues >= 1) {
      warnings.push(`leagueSignals: only ${s.totalLeagues} league — single-league signal`)
      derivation.push(`leagueSignals: ${s.totalLeagues} league → 6/20`)
      return 6
    }
    return 0
  })()

  const patternScore = (() => {
    if (!input.patternAggregate) return 0
    derivation.push('patternAggregate: present → 15/15')
    return 15
  })()

  const overallCompleteness = Math.min(100, benchmarkScore + archetypeScore + recScore + signalScore + patternScore)

  if (overallCompleteness < 40) {
    warnings.push('overall: low completeness — company intelligence will be sparse; provide more input slices')
  }

  return {
    overallCompleteness,
    dimensionCompleteness: {
      benchmark: benchmarkScore,
      archetypeDistribution: archetypeScore,
      recommendationAggregate: recScore,
      leagueSignals: signalScore,
      patternAggregate: patternScore,
    },
    insufficientData: input.benchmark?.insufficientData ?? !input.benchmark,
    warnings,
    derivation,
  }
}

// ── Main assembler ────────────────────────────────────────────────────────────

export function assembleCompanyIntelligence(
  input: CompanyIntelligenceInput,
): CompanyIntelligenceResult {
  const warnings: string[] = []

  if (!input.leagueSignals && !input.archetypeDistribution && !input.benchmark) {
    warnings.push('no_signals: all input slices absent — result will be minimal')
  }

  const dataQualityReport = assembleDataQualityReport(input)
  const retentionDrivers = assembleRetentionDrivers(input)
  const churnRiskFactors = assembleChurnRiskFactors(input)
  const featureAdoptionOpportunities = assembleFeatureAdoptionOpportunities(input)
  const commissionerBehaviorInsights = assembleCommissionerBehaviorInsights(input)
  const leagueFormatEffectiveness = assembleLeagueFormatEffectiveness(input)
  const engagementHealthSummary = assembleEngagementHealthSummary(input)
  const cohortRecommendations = assembleCohortRecommendations(input)
  const monetizationSignals = assembleMonetizationSignals(input)

  return {
    platformId: input.platformId,
    platformLabel: input.platformLabel ?? null,
    retentionDrivers,
    churnRiskFactors,
    featureAdoptionOpportunities,
    commissionerBehaviorInsights,
    leagueFormatEffectiveness,
    engagementHealthSummary,
    cohortRecommendations,
    monetizationSignals,
    dataQualityReport,
    warnings,
    completeness: dataQualityReport.overallCompleteness,
    version: COMPANY_INTELLIGENCE_VERSION,
  }
}
