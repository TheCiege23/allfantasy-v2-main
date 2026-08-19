/**
 * Phase 6.6 — Company Intelligence types.
 *
 * All input types are 6.6-local structural slices. They are structurally compatible with
 * upstream Phase 5/6 outputs but do NOT import from those files.
 * All output types are privacy-safe: no individual identifiers, aggregate only.
 */

// ── Input: 6.6-local structural slices ───────────────────────────────────────

/** Platform-wide benchmark dimension summary (from 6.5 PlatformBenchmarkResult). */
export interface PlatformBenchmarkSummarySlice {
  totalLeagues: number
  insufficientData: boolean
  dimensions: {
    engagement: { p25: number; median: number; p75: number }
    retentionSafety: { p25: number; median: number; p75: number }
    tradeActivity: { p25: number; median: number; p75: number }
    waiverActivity: { p25: number; median: number; p75: number }
    commissionerEfficiency: { p25: number; median: number; p75: number }
  }
}

/** Archetype label distribution across leagues (from 6.3 LeagueArchetypeResult). */
export interface ArchetypeDistributionSlice {
  totalClassified: number
  /** archetype label → count of leagues */
  distribution: Partial<Record<string, number>>
}

/**
 * Recommendation counts aggregated across all entities — no IDs.
 * Derived from 6.4 RecommendationEngineResult.
 */
export interface RecommendationAggregateSlice {
  totalRecommendations: number
  criticalCount: number
  /** category name → count of recommendations in that category */
  byCategory: Partial<Record<string, number>>
  byTier: { manager: number; commissioner: number; platform: number }
  byPriority: { critical: number; high: number; medium: number; low: number }
}

/**
 * Aggregate league-level signal tier counts (no individual league IDs).
 * Structurally compatible with Phase 5.3 outputs, aggregated.
 */
export interface LeagueSignalAggregateSlice {
  totalLeagues: number
  /** engagementTier → count: elite | active | moderate | passive | dormant */
  engagementTierCounts: Partial<Record<string, number>>
  /** retentionRisk → count: low | medium | high | critical */
  retentionRiskCounts: Partial<Record<string, number>>
  /** tradeActivityTier → count: high | moderate | low | none */
  tradeActivityTierCounts: Partial<Record<string, number>>
  /** waiverActivityTier → count: high | moderate | low | none */
  waiverActivityTierCounts: Partial<Record<string, number>>
  /** commissionerWorkload → count: light | moderate | heavy | critical */
  commissionerWorkloadCounts: Partial<Record<string, number>>
  /** Platform-wide average fraction of inactive managers per league (0–1). */
  inactiveManagerFractionAvg: number
}

/**
 * Behavioral pattern occurrence counts across all leagues/managers (no IDs).
 * Structurally compatible with aggregated Phase 6.1 outputs.
 */
export interface PatternAggregateSlice {
  /** Manager-level patternType → total occurrence count across all managers */
  patternCounts: Partial<Record<string, number>>
  /** League-level patternType → total occurrence count across all leagues */
  leaguePatternCounts: Partial<Record<string, number>>
  /** Total managers who had at least one detected pattern */
  totalManagersWithPatterns: number
}

export interface CompanyIntelligenceInput {
  /** Licensee-level platform identifier (not a user ID). */
  platformId: string
  /** Optional display label for the platform/licensee. */
  platformLabel?: string
  benchmark?: PlatformBenchmarkSummarySlice
  archetypeDistribution?: ArchetypeDistributionSlice
  recommendationAggregate?: RecommendationAggregateSlice
  leagueSignals?: LeagueSignalAggregateSlice
  patternAggregate?: PatternAggregateSlice
  /** Total aggregate manager count (no IDs). */
  totalManagers?: number
}

// ── Output types ──────────────────────────────────────────────────────────────

export type DriverStrength = 'strong' | 'moderate' | 'weak'
export type ChurnRiskLevel = 'critical' | 'high' | 'medium' | 'low'
export type AdoptionGap = 'large' | 'moderate' | 'small'
export type CommissionerPrevalence = 'widespread' | 'common' | 'occasional' | 'rare'
export type HealthCorrelation = 'positive' | 'negative' | 'neutral'
export type EngagementSignal = 'high' | 'moderate' | 'low' | 'unknown'
export type RetentionSignal = 'strong' | 'moderate' | 'at_risk' | 'unknown'
export type CohortPriority = 'high' | 'medium' | 'low'
export type MonetizationPotential = 'high' | 'moderate' | 'low'
export type HealthTier = 'excellent' | 'good' | 'moderate' | 'poor' | 'critical'

export interface RetentionDriverInsight {
  driverKey: string
  label: string
  strength: DriverStrength
  /** Fraction of leagues (0–1) exhibiting this driver signal. */
  affectedLeagueFraction: number
  derivation: string[]
  actionableSignal: string
  completeness: number
}

export interface ChurnRiskFactor {
  factorKey: string
  label: string
  riskLevel: ChurnRiskLevel
  /** Fraction of leagues (0–1) exhibiting this risk signal. */
  affectedLeagueFraction: number
  derivation: string[]
  mitigationSignal: string
  completeness: number
}

export interface FeatureAdoptionOpportunity {
  opportunityKey: string
  label: string
  adoptionGap: AdoptionGap
  /** Archetype labels that are primary target of this opportunity. */
  targetArchetypeLabels: string[]
  /** Fraction of leagues in the opportunity segment (0–1). */
  potentialLeagueFraction: number
  derivation: string[]
  completeness: number
}

export interface CommissionerBehaviorInsight {
  behaviorKey: string
  label: string
  prevalence: CommissionerPrevalence
  healthCorrelation: HealthCorrelation
  affectedLeagueFraction: number
  derivation: string[]
  completeness: number
}

export interface LeagueFormatEffectiveness {
  archetypeLabel: string
  leagueCount: number
  leagueFraction: number
  engagementSignal: EngagementSignal
  retentionSignal: RetentionSignal
  derivation: string[]
}

export interface EngagementHealthSummary {
  /** Weighted deduction score 0–100. */
  platformHealthScore: number
  healthTier: HealthTier
  activeLeagueFraction: number
  passiveDormantFraction: number
  criticalRetentionFraction: number
  inactiveArchetypeFraction: number
  derivation: string[]
  completeness: number
}

export interface CohortRecommendation {
  targetArchetypeLabel: string
  targetLeagueCount: number
  recommendation: string
  priority: CohortPriority
  expectedImpact: string
  derivation: string[]
}

export interface MonetizationSignal {
  signalKey: string
  label: string
  potential: MonetizationPotential
  targetSegmentLabel: string
  potentialLeagueFraction: number
  derivation: string[]
  completeness: number
}

export interface DataQualityDimensionCompleteness {
  benchmark: number          // 0–25
  archetypeDistribution: number  // 0–20
  recommendationAggregate: number  // 0–20
  leagueSignals: number      // 0–20
  patternAggregate: number   // 0–15
}

export interface DataQualityReport {
  overallCompleteness: number
  dimensionCompleteness: DataQualityDimensionCompleteness
  insufficientData: boolean
  warnings: string[]
  derivation: string[]
}

export interface CompanyIntelligenceResult {
  /** Licensee-level platform identifier. */
  platformId: string
  platformLabel: string | null
  retentionDrivers: RetentionDriverInsight[]
  churnRiskFactors: ChurnRiskFactor[]
  featureAdoptionOpportunities: FeatureAdoptionOpportunity[]
  commissionerBehaviorInsights: CommissionerBehaviorInsight[]
  leagueFormatEffectiveness: LeagueFormatEffectiveness[]
  engagementHealthSummary: EngagementHealthSummary
  cohortRecommendations: CohortRecommendation[]
  monetizationSignals: MonetizationSignal[]
  dataQualityReport: DataQualityReport
  warnings: string[]
  completeness: number
  version: string
}
