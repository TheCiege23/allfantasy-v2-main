/**
 * Decision OS — Phase 6: Decision Intelligence Layer.
 *
 * Entry point for all Phase 6 exports. Sub-phases 6.1, 6.2, 6.4, 6.6
 * will add their exports here as they are built.
 */

// 6.3 — League Archetype Classifier
export { classifyLeagueArchetype, ARCHETYPE_VERSION } from './archetypes/league-archetypes'
export type {
  LeagueArchetypeInput,
  LeagueArchetypeLabel,
  LeagueArchetypeResult,
  ArchetypeDerivationStep,
  ArchetypeSignalCoverage,
  LeagueActivitySignalInput,
  LeagueParticipationInput,
  LeagueEngagementTierInput,
  ActivityTierInput,
  RetentionRiskInput,
  CommissionerWorkloadInput,
} from './archetypes/types'

// 6.1 — Behavioral Patterns
export { detectBehavioralPatterns, PATTERN_VERSION } from './patterns/patterns'
export type {
  BehavioralPatternLabel,
  PatternConfidence,
  EvidenceWindow,
  DetectedPattern,
  ManagerPatternGroup,
  BehavioralPatternInput,
  BehavioralPatternResult,
} from './patterns/types'

// 6.2 — Manager DNA / Identity Layer
export { assembleManagerDna, MANAGER_DNA_VERSION } from './dna/dna'
export type {
  ManagerDnaInput,
  ManagerDnaResult,
  ManagerDnaProfile,
  ManagerIdentityLabel,
  DecisionStyle,
  TransactionStyle,
  RiskTendency,
  EngagementReliability,
  ManagerTrait,
  ManagerEngagementTier,
  ManagerActivityRatesInput,
  ManagerSignalInput,
  ManagerLeagueContextInput,
  ManagerPatternGroupInput,
  DetectedPatternInput,
  EvidenceWindowInput,
  PatternConfidenceInput,
} from './dna/types'

// 6.5 — Platform Benchmarking
export { assemblePlatformBenchmark, BENCHMARK_VERSION } from './benchmark/benchmark'
export type {
  LeagueSignalInput,
  TaggedArchetypeResult,
  DimensionPercentileRank,
  LeagueBenchmarkResult,
  ArchetypeCohortStats,
  PlatformRankSignal,
  PlatformBenchmarkStats,
  PlatformBenchmarkResult,
  BenchmarkRiskLevel,
  BenchmarkWorkloadLevel,
  BenchmarkActivityInput,
} from './benchmark/types'

// 6.4 — Recommendation Engine
export {
  assembleManagerRecommendations,
  assembleCommissionerRecommendations,
  assemblePlatformRecommendations,
  assembleRecommendations,
  RECOMMENDATION_VERSION,
} from './recommendations/recommendations'
export type {
  RecommendationTier,
  RecommendationCategory,
  RecommendationPriority,
  RecommendationSeverity,
  RecommendationConfidence,
  RecommendedAction,
  Recommendation,
  RecommendationSet,
  DetectedPatternSlice,
  BenchmarkDimensionSlice,
  LeagueBenchmarkSlice,
  ManagerIdentitySlice,
  ManagerRecommendationInput,
  LeagueArchetypeSlice,
  LeagueSignalsSlice,
  CommissionerRecommendationInput,
  PlatformRecommendationInput,
  RecommendationEngineInput,
  RecommendationEngineResult,
} from './recommendations/types'

// 6.6 — Company Intelligence Foundation
export { assembleCompanyIntelligence, COMPANY_INTELLIGENCE_VERSION } from './company/company-intelligence'
export type {
  CompanyIntelligenceInput,
  CompanyIntelligenceResult,
  PlatformBenchmarkSummarySlice,
  ArchetypeDistributionSlice,
  RecommendationAggregateSlice,
  LeagueSignalAggregateSlice,
  PatternAggregateSlice,
  RetentionDriverInsight,
  ChurnRiskFactor,
  FeatureAdoptionOpportunity,
  CommissionerBehaviorInsight,
  LeagueFormatEffectiveness,
  EngagementHealthSummary,
  CohortRecommendation,
  MonetizationSignal,
  DataQualityReport,
  DataQualityDimensionCompleteness,
  DriverStrength,
  ChurnRiskLevel,
  AdoptionGap,
  CommissionerPrevalence,
  HealthCorrelation,
  EngagementSignal,
  RetentionSignal,
  CohortPriority,
  MonetizationPotential,
  HealthTier,
} from './company/types'
