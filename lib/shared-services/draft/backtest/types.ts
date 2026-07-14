/**
 * Draft Shadow Backtest — types. Fantasy OS Migration Plan, Draft OS
 * foundation, Phase 8. Mirrors lib/shared-services/waiver/backtest/types.ts.
 */

import type { DraftEvaluation, LegacyDraftGraderId } from '@/lib/shared-services/draft/types'

/** One real, backtestable historical draft pick, reconstructed to the point in time it was actually made. */
export interface HistoricalDraftPickSample {
  sessionId: string
  leagueId: string
  /** League.platform — 'native' or a real ImportProvider value. Native leagues ARE included (no external re-fetch needed). */
  platform: string
  overall: number
  round: number
  rosterId: string
  realPlayerId: string | null
  realPlayerName: string
  realPosition: string
}

export interface SkippedDraftPickSample {
  sessionId: string
  overall: number | null
  reason: string
}

export interface HistoricalDraftLoadResult {
  samples: HistoricalDraftPickSample[]
  skipped: SkippedDraftPickSample[]
  /** Total candidate picks considered (round > 1, across all sampled completed sessions), before per-session sampling. */
  totalCandidates: number
}

export interface BacktestSampleFailure {
  sessionId: string
  overall: number
  error: string
}

export interface EvaluatedDraftPickSample {
  sample: HistoricalDraftPickSample
  evaluation: DraftEvaluation
}

export interface DraftBacktestRunSummary {
  totalSamples: number
  evaluatedCount: number
  failedCount: number
  failures: BacktestSampleFailure[]
  evaluations: DraftEvaluation[]
  /** Each successful evaluation paired with the historical sample it came from — needed for real-outcome alignment. */
  pairs: EvaluatedDraftPickSample[]
}

export type DraftDivergenceCategory = 'aligned' | 'diverged' | 'legacy_grader_failed'

export interface DraftGraderParitySummary {
  graderId: LegacyDraftGraderId
  totalComparable: number
  sameTopPlayerCount: number
  sameTopPlayerRate: number | null
  legacyGraderFailedCount: number
  byCategory: Record<DraftDivergenceCategory, number>
}

export interface GroupedDraftCounts {
  totalEvaluations: number
  divergedCount: number
}

export interface DraftRealOutcomeAlignment {
  /** Of all sampled historical picks, how many did the shadow's own top recommendation match (by resolved player id, falling back to name+position when no id was resolved on either side). */
  matchedCount: number
  totalSamples: number
}

export interface DraftBacktestDivergenceSummary {
  totalEvaluations: number
  byGrader: DraftGraderParitySummary[]
  byLeague: Record<string, GroupedDraftCounts>
  byProvider: Record<string, GroupedDraftCounts>
  byRound: Record<number, GroupedDraftCounts>
  realOutcomeAlignment: DraftRealOutcomeAlignment
  thresholdFindings: string[]
}
