/**
 * Decision OS — Phase 6.5 Platform Benchmarking assembler.
 *
 * Deterministic percentile ranks and cohort statistics for all leagues on the platform.
 * Consumes Phase 5.3 league signals and Phase 6.3 archetype results.
 *
 * Architecture constraints (PHASE_6_5_PLATFORM_BENCHMARKING_ADR.md):
 *   - Pure: no DB access, no AI calls, no IO, no side effects
 *   - Deterministic: same inputs → same output, always
 *   - No mutation of input arrays
 *   - 'null' archetype ranks when cohort < MIN_COHORT_SIZE (3)
 *   - 'insufficientData' flag when total leagues < MIN_COHORT_SIZE
 */

import type {
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
} from './types'

// ── Versioning ────────────────────────────────────────────────────────────────

export const BENCHMARK_VERSION = '6.5.0'

// ── Thresholds ────────────────────────────────────────────────────────────────

/** Minimum cohort size for archetype-relative percentiles. Below this → null. */
const MIN_COHORT_SIZE = 3

/** Number of top/bottom league entries to include in platform signals. */
const TOP_BOTTOM_COUNT = 3

// ── Ordinal inversion mappings ────────────────────────────────────────────────
// Both maps produce higher numbers for "better" league health, enabling
// consistent ascending-means-better sorting and percentile logic.

const RETENTION_SAFETY_SCORE: Record<BenchmarkRiskLevel, number> = {
  low:      3,
  medium:   2,
  high:     1,
  critical: 0,
}

const COMMISSIONER_EFFICIENCY_SCORE: Record<BenchmarkWorkloadLevel, number> = {
  light:    3,
  moderate: 2,
  heavy:    1,
  critical: 0,
}

// ── Math helpers ──────────────────────────────────────────────────────────────

/**
 * Compute rank and percentile for a single value within a set.
 *
 * rank:       count(values strictly above v) + 1  → 1 = best (highest)
 * percentile: round((n − rank) / (n − 1) × 100)  → 0–100, 100 = best
 * Edge case:  n ≤ 1 → percentile = 50, rank = 1
 */
function rankAndPercentile(
  value: number,
  all: number[],
): { rank: number; percentile: number } {
  const n = all.length
  if (n === 0) return { rank: 1, percentile: 50 }
  const above = all.filter((v) => v > value).length
  const rank = above + 1
  const percentile = n === 1 ? 50 : Math.round(((n - rank) / (n - 1)) * 100)
  return { rank, percentile }
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length)
}

function meanExact(values: number[]): number {
  if (values.length === 0) return 0
  const raw = values.reduce((s, v) => s + v, 0) / values.length
  return Math.round(raw * 100) / 100
}

function sortedAsc(values: number[]): number[] {
  return [...values].sort((a, b) => a - b)
}

function medianOf(values: number[]): number {
  const n = values.length
  if (n === 0) return 0
  const s = sortedAsc(values)
  const mid = Math.floor(n / 2)
  return n % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid]
}

function quantileOf(values: number[], q: number): number {
  const n = values.length
  if (n === 0) return 0
  const s = sortedAsc(values)
  const idx = Math.round(q * (n - 1))
  return s[idx]
}

// ── Internal per-dimension builder ────────────────────────────────────────────

function buildDimensionRank(
  value: number,
  allValues: number[],
  cohortValues: number[],
): DimensionPercentileRank {
  const { rank, percentile } = rankAndPercentile(value, allValues)
  const total = allValues.length

  let archetypePercentile: number | null = null
  let archetypeRank: number | null = null
  if (cohortValues.length >= MIN_COHORT_SIZE) {
    const cRank = rankAndPercentile(value, cohortValues)
    archetypePercentile = cRank.percentile
    archetypeRank       = cRank.rank
  }

  return {
    value,
    percentile,
    rank,
    total,
    archetypePercentile,
    archetypeRank,
    archetypeCohortSize: cohortValues.length,
  }
}

// ── Cohort maps ───────────────────────────────────────────────────────────────

/** Build a map from archetype label → array of signal rows that have that label. */
function buildCohortMap(
  signals: LeagueSignalInput[],
  archetypeById: Map<string, string>,
): Map<string, LeagueSignalInput[]> {
  const map = new Map<string, LeagueSignalInput[]>()
  for (const s of signals) {
    const label = archetypeById.get(s.leagueId) ?? 'unknown'
    if (label === 'unknown') continue // 'unknown' leagues have no cohort
    const arr = map.get(label) ?? []
    arr.push(s)
    map.set(label, arr)
  }
  return map
}

// ── Top/bottom signal lists ───────────────────────────────────────────────────

function topN(
  signals: LeagueSignalInput[],
  n: number,
  getValue: (s: LeagueSignalInput) => number,
  archetypeById: Map<string, string>,
): PlatformRankSignal[] {
  const sorted = [...signals].sort((a, b) => {
    const diff = getValue(b) - getValue(a)
    if (diff !== 0) return diff
    return a.leagueId.localeCompare(b.leagueId) // stable tie-break
  })
  return sorted.slice(0, n).map((s) => ({
    leagueId:  s.leagueId,
    archetype: archetypeById.get(s.leagueId) ?? 'unknown',
    value:     getValue(s),
  }))
}

function bottomN(
  signals: LeagueSignalInput[],
  n: number,
  getValue: (s: LeagueSignalInput) => number,
  archetypeById: Map<string, string>,
): PlatformRankSignal[] {
  const sorted = [...signals].sort((a, b) => {
    const diff = getValue(a) - getValue(b)
    if (diff !== 0) return diff
    return a.leagueId.localeCompare(b.leagueId)
  })
  return sorted.slice(0, n).map((s) => ({
    leagueId:  s.leagueId,
    archetype: archetypeById.get(s.leagueId) ?? 'unknown',
    value:     getValue(s),
  }))
}

// ── Archetype cohort stats ────────────────────────────────────────────────────

function buildCohortStats(
  archetype: string,
  members: LeagueSignalInput[],
): ArchetypeCohortStats {
  const engagementScores = members.map((m) => m.leagueEngagementScore)
  const tradeRates       = members.map((m) => m.tradeActivity.perManagerRate)
  const waiverRates      = members.map((m) => m.waiverActivity.perManagerRate)

  const rrd = { low: 0, medium: 0, high: 0, critical: 0 }
  for (const m of members) rrd[m.retentionRisk]++

  const warnings: string[] = []
  if (members.length < MIN_COHORT_SIZE) warnings.push('small_cohort_low_confidence')

  return {
    archetype,
    count:                 members.length,
    avgEngagementScore:    mean(engagementScores),
    medianEngagementScore: medianOf(engagementScores),
    avgTradeRate:          meanExact(tradeRates),
    avgWaiverRate:         meanExact(waiverRates),
    retentionRiskDistribution: rrd,
    warnings,
  }
}

// ── Main assembler ────────────────────────────────────────────────────────────

/**
 * Assemble deterministic platform benchmarks from Phase 5.3 league signals and
 * Phase 6.3 archetype classifications.
 *
 * Pure: no IO, no DB, no AI calls.
 * Deterministic: same inputs → same output.
 * Does NOT mutate the input arrays.
 *
 * @param leagueSignals     Phase 5.3 `LeagueBehavioralIntelligence` (or structural match).
 * @param leagueArchetypes  Phase 6.3 results tagged with leagueId. Unrecognised or missing
 *                          leagueIds default to archetype 'unknown'.
 */
export function assemblePlatformBenchmark(
  leagueSignals:    LeagueSignalInput[],
  leagueArchetypes: TaggedArchetypeResult[],
): PlatformBenchmarkResult {
  const n           = leagueSignals.length
  const insufficient = n < MIN_COHORT_SIZE

  // ── Build lookup maps ───────────────────────────────────────────────────────
  const archetypeById = new Map<string, string>()
  for (const a of leagueArchetypes) {
    archetypeById.set(a.leagueId, a.archetype)
  }

  // ── Extract platform-wide value arrays ────────────────────────────────────
  const allEngagement     = leagueSignals.map((s) => s.leagueEngagementScore)
  const allRetentionSafety = leagueSignals.map((s) => RETENTION_SAFETY_SCORE[s.retentionRisk])
  const allTradeRate       = leagueSignals.map((s) => s.tradeActivity.perManagerRate)
  const allWaiverRate      = leagueSignals.map((s) => s.waiverActivity.perManagerRate)
  const allCommEfficiency  = leagueSignals.map((s) => COMMISSIONER_EFFICIENCY_SCORE[s.commissionerWorkload])

  // ── Build cohort map (excludes 'unknown') ─────────────────────────────────
  const cohortMap = buildCohortMap(leagueSignals, archetypeById)

  // ── Per-league benchmarks ─────────────────────────────────────────────────
  const leagueBenchmarks: LeagueBenchmarkResult[] = leagueSignals.map((s) => {
    const archetype       = archetypeById.get(s.leagueId) ?? 'unknown'
    const cohortMembers   = cohortMap.get(archetype) ?? []
    const cohortSize      = cohortMembers.length

    const cohortEngagement    = cohortMembers.map((c) => c.leagueEngagementScore)
    const cohortRetSafety     = cohortMembers.map((c) => RETENTION_SAFETY_SCORE[c.retentionRisk])
    const cohortTradeRate     = cohortMembers.map((c) => c.tradeActivity.perManagerRate)
    const cohortWaiverRate    = cohortMembers.map((c) => c.waiverActivity.perManagerRate)
    const cohortCommEfficiency = cohortMembers.map((c) => COMMISSIONER_EFFICIENCY_SCORE[c.commissionerWorkload])

    const retSafetyVal  = RETENTION_SAFETY_SCORE[s.retentionRisk]
    const commEffVal    = COMMISSIONER_EFFICIENCY_SCORE[s.commissionerWorkload]

    const warnings: string[] = []
    if (insufficient)          warnings.push('insufficient_platform_sample')
    if (s.completeness < 30)   warnings.push('low_league_completeness')

    return {
      leagueId:            s.leagueId,
      archetype,
      archetypeCohortSize: cohortSize,

      engagement: buildDimensionRank(
        s.leagueEngagementScore, allEngagement, cohortEngagement,
      ),
      retentionSafety: buildDimensionRank(
        retSafetyVal, allRetentionSafety, cohortRetSafety,
      ),
      tradeActivity: buildDimensionRank(
        s.tradeActivity.perManagerRate, allTradeRate, cohortTradeRate,
      ),
      waiverActivity: buildDimensionRank(
        s.waiverActivity.perManagerRate, allWaiverRate, cohortWaiverRate,
      ),
      commissionerEfficiency: buildDimensionRank(
        commEffVal, allCommEfficiency, cohortCommEfficiency,
      ),

      benchmarkCompleteness: s.completeness,
      insufficient,
      warnings,
    }
  })

  // Sort leagueBenchmarks by engagement score descending, tie-break by leagueId
  leagueBenchmarks.sort((a, b) => {
    const diff = b.engagement.value - a.engagement.value
    return diff !== 0 ? diff : a.leagueId.localeCompare(b.leagueId)
  })

  // ── Archetype cohort stats ────────────────────────────────────────────────
  const archetypeCohorts: ArchetypeCohortStats[] = []
  for (const [archetype, members] of cohortMap.entries()) {
    archetypeCohorts.push(buildCohortStats(archetype, members))
  }
  // Sort by count descending, then alphabetically for stability
  archetypeCohorts.sort((a, b) => {
    const diff = b.count - a.count
    return diff !== 0 ? diff : a.archetype.localeCompare(b.archetype)
  })

  // ── Top/bottom signals ────────────────────────────────────────────────────
  const topLeagues    = topN(leagueSignals, TOP_BOTTOM_COUNT, (s) => s.leagueEngagementScore, archetypeById)
  const bottomLeagues = bottomN(leagueSignals, TOP_BOTTOM_COUNT, (s) => s.leagueEngagementScore, archetypeById)
  const topTradeLeagues  = topN(leagueSignals, TOP_BOTTOM_COUNT, (s) => s.tradeActivity.perManagerRate, archetypeById)
  const topWaiverLeagues = topN(leagueSignals, TOP_BOTTOM_COUNT, (s) => s.waiverActivity.perManagerRate, archetypeById)

  // ── Platform stats ────────────────────────────────────────────────────────
  const sortedEngagement = sortedAsc(allEngagement)
  const archetypeDistribution: Record<string, number> = {}
  for (const s of leagueSignals) {
    const label = archetypeById.get(s.leagueId) ?? 'unknown'
    archetypeDistribution[label] = (archetypeDistribution[label] ?? 0) + 1
  }

  const platformStats: PlatformBenchmarkStats = {
    totalLeagues:          n,
    avgEngagementScore:    mean(allEngagement),
    medianEngagementScore: medianOf(allEngagement),
    p75EngagementScore:    quantileOf(allEngagement, 0.75),
    p25EngagementScore:    quantileOf(allEngagement, 0.25),
    archetypeDistribution,
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings: string[] = []
  if (n === 0)   warnings.push('no_league_signals_provided')
  if (insufficient && n > 0) warnings.push('insufficient_sample_for_reliable_benchmarking')

  return {
    leagueBenchmarks,
    archetypeCohorts,
    topLeagues,
    bottomLeagues,
    topTradeLeagues,
    topWaiverLeagues,
    platformStats,
    totalLeaguesBenchmarked: n,
    insufficientData:        insufficient,
    warnings,
    version: BENCHMARK_VERSION,
  }
}
