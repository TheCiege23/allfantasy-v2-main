import type { SupportedSport } from '@/lib/sport-scope'
import type { UpstreamSourceTag } from '@/lib/sports-data-normalization/constants'
import type { NormalizedPlayerInjuryNewsLayer } from '@/lib/news-injury-aggregation/types'

/**
 * Single normalized contract for player-level sports data consumed by AI tools.
 * All numeric projections must originate from configured providers or DB-synced provider fields — never fabricated players/stats.
 */

export type ProjectionBasis =
  /**
   * Computed by the AllFantasy projection engine (`lib/af-projections`) and read from
   * `AFProjectionSnapshot`. Highest precedence: it is the only basis scored under the
   * league's own rules — including IDP components, which no provider feed scores for us.
   * Carries its own confidence derived from real input coverage.
   */
  | 'af_engine'
  | 'weekly_provider_projection'
  | 'season_fppg_proxy'
  | 'season_avg_actual_proxy'
  | 'unknown'

export type ProjectionConfidenceBand = 'high' | 'medium' | 'low'

export type NormalizedPosition = {
  code: string | null
  /** Sport-specific grouping, e.g. offense / idp / sp / rp */
  bucket: string | null
}

export type NormalizedTeamRef = {
  externalId: string | null
  abbrev: string | null
  name: string | null
}

export type NormalizedGameRef = {
  id: string | null
  startTime: string | null
  homeTeamAbbrev: string | null
  awayTeamAbbrev: string | null
  seasonLabel: string | null
  weekOrPeriod: number | null
}

export type NormalizedInjuryStatus = {
  status: string | null
  detail: string | null
  updatedAt: string | null
  source: UpstreamSourceTag | 'sports_players_row' | 'news_injury_aggregation'
}

/** Slice attached to projections — sourced from DB + cached news pipeline only. */
export type NormalizedInjuryNewsProjectionSlice = {
  adjustedPoints: number | null
  baselinePoints: number | null
  multiplier: number | null
  material: boolean
  canonicalStatus: string
  conflict: boolean
  freshnessHours: number | null
  confidence: number | null
  summary: string | null
  sourcesTried: string[]
  /** League-scoring-adjusted baseline × injury multiplier when both exist. */
  scoringRuleAdjustedWithInjuryNews: number | null
}

export type NormalizedFantasyProjection = {
  schemaVersion: 1
  sport: SupportedSport | 'ALL'
  /** Best single-point estimate for the relevant fantasy period (often current week). */
  projectedFantasyPoints: number | null
  projectedFantasyPointsRange: { low: number | null; high: number | null }
  projectionConfidence: number | null
  projectionConfidenceBand: ProjectionConfidenceBand | null
  scoringRuleAdjustedProjection: number | null
  /** Real injury/news pipeline adjustment; prefer this over raw projection when `material` is true. */
  injuryNews: NormalizedInjuryNewsProjectionSlice | null
  weatherAdjustedProjection: number | null
  /** Outdoor / severe forecast risk for lineup decisions (sport-aware). */
  weatherRiskLevel: 'none' | 'low' | 'moderate' | 'high' | 'extreme' | null
  weatherSummary: string | null
  weatherConfidence: 'high' | 'medium' | 'low' | 'unavailable' | null
  weatherImpactReason: string | null
  scheduleAdjustedProjection: number | null
  recentTrendAdjustedProjection: number | null
  basis: ProjectionBasis
  /** When basis is proxy, describes limitation. */
  basisNotes: string[]
  /** Raw provider keys preserved for auditing (no invented values). */
  providerProjectionPayload: Record<string, unknown> | null
  scoringNotes: string[]
}

export type NormalizedActualPerformance = {
  fantasyPointsPerGame: number | null
  gamesPlayed: number | null
  seasonStats: Record<string, unknown> | null
  source: UpstreamSourceTag | 'unknown'
}

export type NormalizedTrendUsage = {
  rollingFppg: number | null
  trendHint: string | null
  source: UpstreamSourceTag | 'unknown'
}

export type NormalizedFantasyScoringSnapshot = {
  /** Echo of relevant league rules when a league context was supplied. */
  receptionFormat: string | null
  isSuperflex: boolean | null
  isTwoQB: boolean | null
  tePremiumExtra: number | null
}

export type NormalizedPlayerSportsProfile = {
  schemaVersion: 1
  pipelineId: string
  pipelineVersion: number
  sport: SupportedSport | 'ALL'
  player: {
    id: string | null
    name: string
    position: NormalizedPosition
    team: NormalizedTeamRef
  }
  injury: NormalizedInjuryStatus | null
  /** Shared injury + news aggregation (all AI tools). */
  injuryNewsLayer: NormalizedPlayerInjuryNewsLayer | null
  projection: NormalizedFantasyProjection
  actualPerformance: NormalizedActualPerformance | null
  trendUsage: NormalizedTrendUsage | null
  upcomingGame: NormalizedGameRef | null
  /** Tags indicating which upstream layers contributed (ordered). */
  sourcesTried: UpstreamSourceTag[]
  dataGaps: string[]
}

export type NormalizedSportsDataBatch = {
  schemaVersion: 1
  pipelineId: string
  pipelineVersion: number
  sport: SupportedSport | 'ALL'
  fetchedAt: string
  players: NormalizedPlayerSportsProfile[]
  batchDataGaps: string[]
}
