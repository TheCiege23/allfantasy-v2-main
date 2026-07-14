/**
 * Trade Shadow Backtest — types. Fantasy OS Migration Plan Milestone 4,
 * Phase 6: validates the Phase 5 shadow Trade Service against real
 * historical AllFantasy-native trades before any live consumer migration
 * is considered.
 *
 * SHADOW MODE ONLY, same as Phase 5: nothing here is called by any live
 * route. This module reads real historical rows but writes nothing back to
 * production tables — results go to the same in-memory ShadowResultStore
 * Phase 5 already defined.
 */

import type { ImportProvider } from '@/lib/league-import/types'
import type { LegacyGraderId, TradeShadowEvaluation } from '@/lib/shared-services/trade/types'

/** Real terminal AfLeagueTrade.status values, per tradeLearningCapture.ts's AF_STATUS_TO_OUTCOME mapping. */
export type HistoricalTradeRealOutcome = 'ACCEPTED' | 'REJECTED' | 'COUNTERED' | 'EXPIRED' | 'UNKNOWN'

/** One real, backtestable historical trade, normalized into evaluateTradeShadow's input shape. */
export interface HistoricalTradeSample {
  offerEventId: string
  afLeagueTradeId: string
  /** Internal League.id — kept for reporting/grouping, not passed to evaluateTradeShadow. */
  leagueId: string
  /** League.platformLeagueId — the provider's real source league id, what evaluateTradeShadow calls `leagueId`. */
  platformLeagueId: string
  platform: ImportProvider
  /** League.userId — for ESPN/Yahoo/MFL credential resolution. Sleeper/Fleaflicker don't need it. */
  afUserId: string | null
  sideARosterId: string
  sideBRosterId: string
  sideAAssetNames: string[]
  sideBAssetNames: string[]
  /** From TradeOutcomeEvent, when one was captured for this trade. Reporting only — never fed into the shadow evaluation. */
  realOutcome: HistoricalTradeRealOutcome | null
  capturedAt: string
}

/** A candidate historical trade that could not be turned into a backtestable sample, and why. */
export interface SkippedTradeSample {
  offerEventId: string
  afLeagueTradeId: string | null
  reason: string
}

export interface HistoricalTradeLoadResult {
  samples: HistoricalTradeSample[]
  skipped: SkippedTradeSample[]
  /** Total TradeOfferEvent rows considered (mode=LIVE_PROPOSAL, afLeagueTradeId set), before filtering. */
  totalCandidates: number
}

export interface BacktestSampleFailure {
  afLeagueTradeId: string
  offerEventId: string
  error: string
}

export interface BacktestRunSummary {
  totalSamples: number
  evaluatedCount: number
  failedCount: number
  failures: BacktestSampleFailure[]
  evaluations: TradeShadowEvaluation[]
}

export interface BacktestThresholds {
  /** Minimum share of non-critical-divergence evaluations required, per grader, before a low-risk consumer migration is considered. */
  minNonCriticalParityRate: number
  /** Max tolerated count of critical divergences among high-confidence evaluations, per grader. */
  maxCriticalDivergencesInHighConfidence: number
  /** abs(fairnessScoreDelta) at or above this is a "critical" divergence. */
  criticalDivergenceAbsFairnessDelta: number
  /** evaluation.confidence at or above this counts as "high confidence." */
  highConfidenceMinScore: number
}

/** Suggested starting values from the Phase 6 brief — not a hardcoded law, callers may override. */
export const DEFAULT_BACKTEST_THRESHOLDS: BacktestThresholds = {
  minNonCriticalParityRate: 0.95,
  maxCriticalDivergencesInHighConfidence: 0,
  criticalDivergenceAbsFairnessDelta: 30,
  highConfidenceMinScore: 0.7,
}

export type DivergenceCategory = 'aligned' | 'minor_divergence' | 'critical_divergence' | 'legacy_grader_failed'

export interface GraderParitySummary {
  graderId: LegacyGraderId
  /** Evaluations where the legacy grader call itself succeeded (comparable). */
  totalComparable: number
  gradeMatchCount: number
  gradeMatchRate: number | null
  meanAbsFairnessScoreDelta: number | null
  nonCriticalParityRate: number | null
  criticalDivergenceCount: number
  criticalDivergenceInHighConfidenceCount: number
  legacyGraderFailedCount: number
  byCategory: Record<DivergenceCategory, number>
}

export interface GroupedDivergenceCounts {
  totalEvaluations: number
  criticalDivergenceCount: number
}

export interface BacktestDivergenceSummary {
  totalEvaluations: number
  byGrader: GraderParitySummary[]
  byLeague: Record<string, GroupedDivergenceCounts>
  byProvider: Record<string, GroupedDivergenceCounts>
  byConfidenceBucket: Record<'low' | 'medium' | 'high', GroupedDivergenceCounts>
  thresholds: BacktestThresholds
  /** True only when every grader clears both threshold checks below. */
  passesMigrationThreshold: boolean
  thresholdFindings: string[]
}
