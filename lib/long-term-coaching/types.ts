/**
 * Long-term strategic coaching (dynasty / devy / C2C / keeper) — deterministic analysis + AI narrative.
 * All numeric signals are derived from DB-backed roster, projections, and dynasty values where available.
 */

import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import type { AiTeamContextPayload } from '@/lib/ai-payload/types'

export type LongTermCoachingHorizonYears = 2 | 3 | 4 | 5

export type LongTermStrategyMode = 'auto' | 'compete_now' | 'soft_rebuild' | 'full_rebuild'

export type LongTermStrategyClass =
  | 'elite_contender'
  | 'contender'
  | 'fringe_contender'
  | 'pretender'
  | 'competitive_retool'
  | 'soft_rebuild'
  | 'full_rebuild'
  | 'future_core_asset_build'
  | 'developmental_contender'
  | 'win_now_with_risk'
  | 'long_term_rise'

type LongTermPickSummary = {
  season: number
  round: number
  weightScore: number
}

export type LongTermPlayerSignal = {
  playerId: string
  name: string | null
  position: string | null
  bucket: 'starter' | 'bench' | 'reserve' | 'taxi'
  weeklyProjection: number | null
  dynastyValue: number | null
  projectionBasis: string | null
}

export type LongTermPositionalStrength = {
  position: string
  starterProjectionSum: number
  playerCount: number
}

export type LongTermYearOutlook = {
  /** Calendar label e.g. 2027 — informational */
  labelYear: number
  /** 0–100 aggregate index (transparent model — not a guaranteed outcome). */
  projectedTeamStrengthIndex: number
  /** Qualitative band for UI */
  contentionBand: 'low' | 'mid' | 'high'
  notes: string[]
  confidence: 'high' | 'medium' | 'low'
}

export type LongTermStructuredPlan = {
  horizonYears: LongTermCoachingHorizonYears
  strategyClass: LongTermStrategyClass
  recommendedDirection: 'compete_now' | 'soft_rebuild' | 'full_rebuild' | 'develop_pipeline'
  currentWindowAssessment: string
  topPriorities: string[]
  playersToSell: Array<{ playerId: string; name: string | null; rationale: string }>
  playersToHold: Array<{ playerId: string; name: string | null; rationale: string }>
  playersToBuildAround: Array<{ playerId: string; name: string | null; rationale: string }>
  pickStrategy: string[]
  rookieDevyStrategy: string[]
  rosterNeedsByPosition: Array<{ position: string; need: 'high' | 'medium' | 'low'; note: string }>
  yearByYearFocus: Array<{ year: number; focus: string }>
  keyRisks: string[]
  confidence: number
}

/**
 * Injected into `AllFantasyStandardAiPayload.strategicCoaching` when tools opt in.
 * Always reflects the signed-in user’s team in the league (not a trade partner).
 */
export type StrategicCoachingSnapshot = {
  schemaVersion: 1
  modelId: 'ltc_aggregate_v1'
  computedAt: string
  leagueId: string
  sport: string
  horizonYears: LongTermCoachingHorizonYears
  strategyMode: LongTermStrategyMode
  formatWarning: string | null
  strategyClass: LongTermStrategyClass
  recommendedDirection: LongTermStructuredPlan['recommendedDirection']
  titleWindowYears: number | null
  peakYear: number | null
  declineRisk: 'low' | 'medium' | 'high'
  shortTermStrengthIndex: number
  longTermAssetIndex: number
  prospectPipelineIndex: number
  pickCapitalScore: number
  ageCurveRisk: number
  pointsForPercentile: number | null
  confidence: number
  dynastyValueCoverageRatio: number
  /** Single line for prompts and tool headers */
  summaryLine: string
  flags: {
    isDynasty: boolean
    isDevy: boolean
    isC2C: boolean
    isKeeper: boolean
  }
}

export type LongTermCoachingAnalysis = {
  schemaVersion: 1
  computedAt: string
  modelId: 'ltc_aggregate_v1'
  /** Human-readable explanation of how multi-year indices are formed (no per-player fake arcs). */
  methodologyNotes: string[]
  leagueId: string
  sport: string
  horizonYears: LongTermCoachingHorizonYears
  strategyMode: LongTermStrategyMode
  formatWarning: string | null
  leagueContext: Pick<
    NormalizedLeagueContext,
    'leagueId' | 'sport' | 'leagueName' | 'flags' | 'leagueVariant' | 'leagueType' | 'scoring' | 'roster' | 'trade' | 'playoff'
  >
  teamContext: AiTeamContextPayload | null
  /** Points-for percentile among league teams (0–100). Null if unavailable. */
  pointsForPercentile: number | null
  /** League teams count */
  leagueTeamCount: number
  signals: {
    starterWeeklyProjectionSum: number
    rosterWeeklyProjectionSum: number
    dynastyValueSum: number
    dynastyValueCoverageRatio: number
    pickCapitalScore: number
    pickSummaries: LongTermPickSummary[]
    shortTermStrengthIndex: number
    longTermAssetIndex: number
    prospectPipelineIndex: number
    /** 0–100 heuristic */
    ageCurveRisk: number
    strategyClass: LongTermStrategyClass
    titleWindowYears: number | null
    peakYear: number | null
    declineRisk: 'low' | 'medium' | 'high'
    recommendedDirection: LongTermStructuredPlan['recommendedDirection']
    confidence: number
    positionalStrength: LongTermPositionalStrength[]
    playerSignals: LongTermPlayerSignal[]
  }
  futureStrengthByYear: Record<string, number>
  yearOutlooks: LongTermYearOutlook[]
  plan: LongTermStructuredPlan
}

export type LongTermCoachingResult = {
  ok: true
  analysis: LongTermCoachingAnalysis
  /** Grounded Chimmy narrative; null when skipAi or provider missing. */
  aiNarrative: string | null
  aiModel: string | null
}

