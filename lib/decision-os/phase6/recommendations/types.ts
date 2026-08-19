/**
 * Phase 6.4 — Recommendation Engine types.
 *
 * All input types are 6.4-local structural definitions. They are structurally compatible
 * with upstream Phase 6.1/6.2/6.3/6.5 outputs but do NOT import from those files.
 * This preserves cross-sub-phase boundary independence.
 */

// ── Recommendation metadata types ────────────────────────────────────────────

export type RecommendationTier = 'manager' | 'commissioner' | 'platform'

export type RecommendationCategory =
  // Manager tier
  | 'engagement_boost'
  | 'lineup_discipline'
  | 'trade_coaching'
  | 'waiver_opportunity'
  | 'league_participation'
  | 'draft_preparation'
  // Commissioner tier
  | 'retention_intervention'
  | 'trade_activation'
  | 'waiver_activation'
  | 'league_event'
  | 'weekly_recap'
  | 'rivalry_engagement'
  // Platform tier
  | 'benchmark_intervention'
  | 'product_opportunity'
  | 'cohort_improvement'
  | 'feature_adoption'

export type RecommendationPriority = 'critical' | 'high' | 'medium' | 'low'
export type RecommendationSeverity = 'urgent' | 'elevated' | 'standard' | 'advisory'
export type RecommendationConfidence = 'high' | 'medium' | 'low'

export interface RecommendedAction {
  action: string
  rationale: string
}

// ── Core recommendation output ────────────────────────────────────────────────

export interface Recommendation {
  /** Deterministic: `rec_${tier}_${category}_${entityId}` */
  id: string
  tier: RecommendationTier
  category: RecommendationCategory
  /** managerId, leagueId, or platformId */
  entityId: string
  priority: RecommendationPriority
  severity: RecommendationSeverity
  confidence: RecommendationConfidence
  /** Intelligence dimensions this recommendation addresses */
  affectedDimensions: string[]
  /** Plain-language expected outcome */
  expectedImpact: string
  /** Full derivation chain: which signals, thresholds, and paths led here */
  derivation: string[]
  /** Specific evidence items supporting the recommendation */
  evidence: string[]
  /** Platform benchmark context, or null when not available */
  benchmarkComparison: string | null
  /** Conditions that must hold for this recommendation to be actionable */
  prerequisites: string[]
  /** Ordered, specific action items */
  recommendedActions: RecommendedAction[]
  /** When to dismiss or archive this recommendation */
  rollbackCriteria: string[]
  /** Input data quality 0–100 for this recommendation */
  completeness: number
  /** Caveats that reduce confidence in this recommendation */
  uncertainty: string[]
}

export interface RecommendationSet {
  entityId: string
  tier: RecommendationTier
  /** Sorted: priority DESC → severity DESC → category ASC → id ASC */
  recommendations: Recommendation[]
  totalRecommendations: number
  criticalCount: number
  warnings: string[]
  version: string
}

// ── Input: 6.4-local structural slices ────────────────────────────────────────

/** Structural slice of Phase 6.1 DetectedPattern */
export interface DetectedPatternSlice {
  patternType: string
  confidence: string   // 'high' | 'medium' | 'low'
  occurrenceCount: number
}

/** Structural slice of Phase 6.5 DimensionPercentileRank */
export interface BenchmarkDimensionSlice {
  value: number
  percentile: number
}

/** Structural slice of Phase 6.5 LeagueBenchmarkResult dimensions */
export interface LeagueBenchmarkSlice {
  engagement: BenchmarkDimensionSlice
  retentionSafety: BenchmarkDimensionSlice
  tradeActivity: BenchmarkDimensionSlice
  waiverActivity: BenchmarkDimensionSlice
  commissionerEfficiency: BenchmarkDimensionSlice
}

// ── Manager-tier input ────────────────────────────────────────────────────────

/** Structural slice of Phase 6.2 ManagerDnaProfile */
export interface ManagerIdentitySlice {
  primaryIdentity: string         // ghost_manager | set_and_forget | ...
  decisionStyle: string           // decisive | indecisive | reactive | methodical
  transactionStyle: string        // trade_dominant | waiver_dominant | balanced | passive
  riskTendency: string            // risk_taking | risk_averse | neutral
  engagementReliability: string   // reliable | inconsistent | unreliable
  traits: Array<{ trait: string; strength: string }>
  completeness: number            // 0-100
}

export interface ManagerRecommendationInput {
  managerId: string
  leagueId: string
  /** Phase 6.2 output slice. Optional — degrades to pattern-only derivation. */
  identity?: ManagerIdentitySlice
  /** Phase 6.1 output slice (this manager's patterns only). */
  patterns?: DetectedPatternSlice[]
  /** Phase 6.5 output slice for this manager's league. Optional context. */
  leagueBenchmark?: LeagueBenchmarkSlice
}

// ── Commissioner-tier input ───────────────────────────────────────────────────

/** Structural slice of Phase 6.3 LeagueArchetypeResult */
export interface LeagueArchetypeSlice {
  label: string     // highly_engaged | high_churn_risk | inactive_or_stale | ...
  confidence: number
}

/** Aggregate league signals (structurally compatible with Phase 5.3 output) */
export interface LeagueSignalsSlice {
  engagementTier: string           // elite | active | moderate | passive | dormant
  retentionRisk: string            // low | medium | high | critical
  inactiveManagerFraction: number  // 0-1
  tradeActivityTier: string        // high | moderate | low | none
  waiverActivityTier: string       // high | moderate | low | none
  commissionerWorkload: string     // light | moderate | heavy | critical
}

export interface CommissionerRecommendationInput {
  leagueId: string
  /** Phase 6.3 archetype slice. */
  archetype?: LeagueArchetypeSlice
  /** Phase 6.5 benchmark slice for this league. */
  benchmark?: LeagueBenchmarkSlice
  /** Phase 5.3 aggregate signals for this league. */
  leagueSignals?: LeagueSignalsSlice
  /** Phase 6.1 league-level patterns (league_activity_dropoff, surge, commissioner_rules_churn). */
  leaguePatterns?: DetectedPatternSlice[]
}

// ── Platform-tier input ───────────────────────────────────────────────────────

export interface PlatformRecommendationInput {
  platformId: string
  totalLeagues?: number
  insufficientData?: boolean
  /** Fraction of leagues below 30th percentile engagement. */
  lowEngagementLeagueFraction?: number
  /** Fraction of leagues with retentionRisk = 'high' or 'critical'. */
  highChurnRiskFraction?: number
  /** Fraction of leagues with inactive_or_stale or dormant archetype. */
  inactiveLeagueFraction?: number
  /** Archetype label → count. */
  archetypeDistribution?: Partial<Record<string, number>>
}

// ── Engine-level input / result ───────────────────────────────────────────────

export interface RecommendationEngineInput {
  managerInputs: ManagerRecommendationInput[]
  commissionerInputs: CommissionerRecommendationInput[]
  platformInputs: PlatformRecommendationInput[]
}

export interface RecommendationEngineResult {
  managerRecommendations: RecommendationSet[]
  commissionerRecommendations: RecommendationSet[]
  platformRecommendations: RecommendationSet[]
  totalRecommendations: number
  criticalRecommendations: number
  warnings: string[]
  version: string
}
