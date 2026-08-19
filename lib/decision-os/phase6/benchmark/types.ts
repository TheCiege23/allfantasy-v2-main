/**
 * Decision OS — Phase 6.5 Platform Benchmarking types.
 *
 * Pure types only — no runtime logic, no imports from Phase 5 or Phase 6.3 internals.
 * Input interfaces are structurally compatible with Phase 5.3/5.4/6.3 outputs but
 * defined independently so Phase 6.5 is testable without upstream internals.
 */

// ── Input types ───────────────────────────────────────────────────────────────

/** Ordinal risk levels — structural match for Phase 5.3 LeagueRetentionRisk. */
export type BenchmarkRiskLevel = 'low' | 'medium' | 'high' | 'critical'

/** Ordinal workload levels — structural match for Phase 5.3 CommissionerWorkloadLevel. */
export type BenchmarkWorkloadLevel = 'light' | 'moderate' | 'heavy' | 'critical'

/** Minimal activity signal needed from Phase 5.3 LeagueActivityDimension. */
export interface BenchmarkActivityInput {
  perManagerRate: number
}

/**
 * Per-league signal subset consumed by Phase 6.5.
 * Pass a `LeagueBehavioralIntelligence` directly — it satisfies this interface.
 * Phase 6.5 consumes only these fields; extra fields on Phase 5.3 are ignored.
 */
export interface LeagueSignalInput {
  leagueId:             string
  leagueEngagementScore: number
  retentionRisk:         BenchmarkRiskLevel
  tradeActivity:         BenchmarkActivityInput
  waiverActivity:        BenchmarkActivityInput
  commissionerWorkload:  BenchmarkWorkloadLevel
  /** Data quality score 0–100 inherited from Phase 5.3. */
  completeness:          number
}

/**
 * Phase 6.3 archetype result tagged with the league it describes.
 * Phase 6.3 `LeagueArchetypeResult` does not carry a leagueId, so callers provide it.
 */
export interface TaggedArchetypeResult {
  leagueId:  string
  archetype: string    // LeagueArchetypeLabel | 'unknown'
  confidence: number   // 0–1
}

// ── Per-dimension rank ─────────────────────────────────────────────────────────

/**
 * Percentile and rank for a single dimension in a single league.
 * Percentile 100 = best on the platform; 0 = worst.
 * Rank 1 = best on the platform.
 */
export interface DimensionPercentileRank {
  /** Raw numeric value used for ranking (e.g. engagement score, perManagerRate). */
  value: number
  /** Percentile within all benchmarked leagues (0–100). */
  percentile: number
  /** Rank among all leagues — 1 = best. */
  rank: number
  /** Total number of leagues in the comparison set. */
  total: number
  /**
   * Percentile within the archetype cohort.
   * Null when cohort size < MIN_COHORT_SIZE (3) or archetype = 'unknown'.
   */
  archetypePercentile: number | null
  /**
   * Rank within the archetype cohort — 1 = best in cohort.
   * Null when cohort size < MIN_COHORT_SIZE (3) or archetype = 'unknown'.
   */
  archetypeRank: number | null
  /** Number of leagues in this archetype cohort. 0 for 'unknown'. */
  archetypeCohortSize: number
}

// ── Per-league benchmark result ───────────────────────────────────────────────

/**
 * Complete benchmark profile for a single league.
 * All five dimensions are ranked; archetype cohort fields are null for small cohorts.
 */
export interface LeagueBenchmarkResult {
  leagueId:          string
  /** Phase 6.3 archetype label for this league. 'unknown' if unclassified. */
  archetype:         string
  /** Number of other leagues with the same archetype (0 if 'unknown' or no cohort). */
  archetypeCohortSize: number

  // ── Five benchmarked dimensions ──────────────────────────────────────────
  engagement:              DimensionPercentileRank
  /** Higher = safer (retentionRisk inverted: low→3, medium→2, high→1, critical→0). */
  retentionSafety:         DimensionPercentileRank
  /** By tradeActivity.perManagerRate. */
  tradeActivity:           DimensionPercentileRank
  /** By waiverActivity.perManagerRate. */
  waiverActivity:          DimensionPercentileRank
  /** Higher = lighter workload (commissionerWorkload inverted: light→3, …, critical→0). */
  commissionerEfficiency:  DimensionPercentileRank

  // ── Data quality ─────────────────────────────────────────────────────────
  /** Completeness score from the underlying LeagueBehavioralIntelligence (0–100). */
  benchmarkCompleteness: number
  /** True when the total platform has fewer than MIN_COHORT_SIZE (3) leagues. */
  insufficient:          boolean
  warnings:              string[]
}

// ── Archetype cohort statistics ───────────────────────────────────────────────

/** Aggregate statistics for all leagues sharing one archetype label. */
export interface ArchetypeCohortStats {
  archetype: string
  count:     number
  avgEngagementScore:    number
  medianEngagementScore: number
  avgTradeRate:          number
  avgWaiverRate:         number
  retentionRiskDistribution: {
    low:      number
    medium:   number
    high:     number
    critical: number
  }
  /** Present when count < 3: 'small_cohort_low_confidence'. */
  warnings: string[]
}

// ── Platform top/bottom signals ───────────────────────────────────────────────

/** A single entry in a top/bottom platform signal list. */
export interface PlatformRankSignal {
  leagueId:  string
  archetype: string
  value:     number
}

// ── Platform-wide statistics ──────────────────────────────────────────────────

export interface PlatformBenchmarkStats {
  totalLeagues:          number
  avgEngagementScore:    number
  medianEngagementScore: number
  /** 75th percentile engagement score (element at index round(0.75 × (n-1))). */
  p75EngagementScore:    number
  /** 25th percentile engagement score (element at index round(0.25 × (n-1))). */
  p25EngagementScore:    number
  /** Count of leagues per archetype label (includes 'unknown'). */
  archetypeDistribution: Record<string, number>
}

// ── Main benchmark result ─────────────────────────────────────────────────────

/**
 * Complete platform benchmark output from Phase 6.5.
 *
 * Pure: produced without IO, DB, or AI.
 * Deterministic: same inputs → same output.
 * Version-stamped: all outputs carry `version` for auditability.
 */
export interface PlatformBenchmarkResult {
  /** Per-league benchmark profiles (sorted by engagement score descending). */
  leagueBenchmarks: LeagueBenchmarkResult[]

  /** Per-archetype aggregate statistics (sorted by count descending, then alphabetically). */
  archetypeCohorts: ArchetypeCohortStats[]

  /** Top 3 leagues by engagement score (ties broken by leagueId ascending). */
  topLeagues: PlatformRankSignal[]
  /** Bottom 3 leagues by engagement score (ties broken by leagueId ascending). */
  bottomLeagues: PlatformRankSignal[]
  /** Top 3 leagues by trade perManagerRate (ties broken by leagueId ascending). */
  topTradeLeagues: PlatformRankSignal[]
  /** Top 3 leagues by waiver perManagerRate (ties broken by leagueId ascending). */
  topWaiverLeagues: PlatformRankSignal[]

  /** Platform-wide aggregate statistics. */
  platformStats: PlatformBenchmarkStats

  /** Total leagues included in this benchmark. */
  totalLeaguesBenchmarked: number
  /**
   * True when fewer than MIN_COHORT_SIZE (3) leagues are present.
   * Downstream callers should treat results as indicative only.
   */
  insufficientData: boolean
  warnings: string[]
  /** Benchmark logic version — '6.5.0'. Bump when weights or formulas change. */
  version: string
}
