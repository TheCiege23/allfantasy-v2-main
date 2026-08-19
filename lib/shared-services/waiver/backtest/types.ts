/**
 * Waiver Shadow Backtest — types. Fantasy OS Migration Plan, Waiver OS
 * foundation, Phase 7. Mirrors lib/shared-services/trade/backtest/types.ts.
 */

import type { LegacyWaiverGraderId, WaiverEvaluation } from '@/lib/shared-services/waiver/types'

/** Real WaiverClaim.status / WaiverResult.resultType terminal outcomes, per lib/waiver-wire/process-engine.ts. */
export type HistoricalWaiverRealOutcome = 'awarded' | 'failed'

/** One real, backtestable historical waiver claim, normalized into evaluateWaiverShadow's input shape. */
export interface HistoricalWaiverSample {
  claimId: string
  leagueId: string
  rosterId: string
  /** League.platform — 'native' or a real ImportProvider value. Unlike Trade OS's backtest, native leagues ARE included here. */
  platform: string
  managerKey: string | null
  addPlayerId: string
  addPlayerName: string | null
  dropPlayerId: string | null
  faabBid: number | null
  priorityOrder: number
  realOutcome: HistoricalWaiverRealOutcome
  realFaabDelta: number | null
  processedAt: string
}

export interface SkippedWaiverSample {
  claimId: string
  reason: string
}

export interface HistoricalWaiverLoadResult {
  samples: HistoricalWaiverSample[]
  skipped: SkippedWaiverSample[]
  /** Total WaiverClaim rows considered (status in ['processed','failed']), before filtering. */
  totalCandidates: number
}

export interface BacktestSampleFailure {
  claimId: string
  error: string
}

export interface EvaluatedWaiverSample {
  sample: HistoricalWaiverSample
  evaluation: WaiverEvaluation
}

export interface WaiverBacktestRunSummary {
  totalSamples: number
  evaluatedCount: number
  failedCount: number
  failures: BacktestSampleFailure[]
  evaluations: WaiverEvaluation[]
  /** Each successful evaluation paired with the historical sample it came from — needed for real-outcome alignment, since WaiverEvaluation alone doesn't carry the originating claimId/realOutcome. */
  pairs: EvaluatedWaiverSample[]
}

export type WaiverDivergenceCategory = 'aligned' | 'diverged' | 'legacy_grader_failed'

export interface WaiverGraderParitySummary {
  graderId: LegacyWaiverGraderId
  /** Evaluations where the legacy grader call itself succeeded (comparable). */
  totalComparable: number
  sameTopAddCount: number
  sameTopAddRate: number | null
  legacyGraderFailedCount: number
  byCategory: Record<WaiverDivergenceCategory, number>
}

export interface GroupedWaiverCounts {
  totalEvaluations: number
  divergedCount: number
}

export interface WaiverRealOutcomeAlignment {
  /** Of samples where the real historical claim was AWARDED, how many did the shadow's own top pick agree was the same player added. */
  awardedAndShadowAgreed: number
  awardedTotal: number
  /** Of samples where the real claim FAILED, how many did the shadow also rank low/not-recommend (i.e. shadow's top pick was a DIFFERENT player, suggesting it wouldn't have made the same losing claim). */
  failedAndShadowDisagreed: number
  failedTotal: number
}

export interface WaiverBacktestDivergenceSummary {
  totalEvaluations: number
  byGrader: WaiverGraderParitySummary[]
  byLeague: Record<string, GroupedWaiverCounts>
  byProvider: Record<string, GroupedWaiverCounts>
  realOutcomeAlignment: WaiverRealOutcomeAlignment
  thresholdFindings: string[]
}
