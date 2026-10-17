/**
 * The scheduled home of the trade-engine's calibration cycle.
 *
 * Until 2026-09-30 these three steps ran only from `runBackgroundTradeAnalysis` in
 * lib/trade-learning.ts, behind a manual POST to /api/internal/analyze-trades that no
 * scheduler ever called (docs/TRADE_LEARNING_ACTIVATION_BLOCKERS.md). That pipeline was
 * retired; this pass keeps its calibration half alive on the hourly reap-sync-runs cron,
 * after the comprehensive trade-learning writer, which is what now marks trades valued.
 *
 * Steps, in the order the retired pipeline ran them, each isolated so one failing never
 * costs the others:
 *   1. `runFullCalibration`      — feedback-weight calibration + cache invalidation
 *                                  (intercept calibration is retired inside it; b0 is owned
 *                                  by promoteShadowB0 in auto-recalibration.ts).
 *   2. `runDriftDetection`       — writes the season's driftReport to TradeLearningStats.
 *   3. `logAcceptedTradesAsOutcomes` — one TradeOutcomeEvent per newly valued trade; read by
 *                                  auto-recalibration, the isotonic calibrator and
 *                                  calibration-metrics, so it belongs to calibration.
 *
 * ⚠ BUDGETED BY ADMISSION, NOT BY INTERRUPTION. A step that has started runs to completion;
 * the budget only decides whether the NEXT step is admitted. Every step is a bounded read of
 * the season's valued trades plus 90 days of feedback, so the exposure is seconds, and the
 * route that hosts this keeps 60s clear of the platform's 300s kill.
 */

import { resolveCurrentTradeLearningSeason } from './season-resolver'

export type TradeCalibrationPassResult = {
  ran: true
  season: number
  /** Whether feedback calibration adjusted a weight; null when the step did not complete. */
  feedbackAdjusted: boolean | null
  /** The drift report's overall severity; null when the step did not complete. */
  driftSeverity: string | null
  /** TradeOutcomeEvent rows written; null when the step did not complete. */
  outcomesLogged: number | null
  /** One entry per step that failed or was skipped for budget, in step order. */
  errors: string[]
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160)
}

export async function runTradeCalibrationPass(options: {
  budgetMs: number
  season?: number
}): Promise<TradeCalibrationPassResult> {
  const startedAt = Date.now()
  const season = options.season ?? (await resolveCurrentTradeLearningSeason())
  const result: TradeCalibrationPassResult = {
    ran: true,
    season,
    feedbackAdjusted: null,
    driftSeverity: null,
    outcomesLogged: null,
    errors: [],
  }
  const exhausted = () => Date.now() - startedAt >= options.budgetMs

  if (exhausted()) {
    result.errors.push('calibration skipped: no budget')
  } else {
    try {
      const { runFullCalibration } = await import('./accept-calibration')
      const calibration = await runFullCalibration(season)
      result.feedbackAdjusted = calibration.feedback.adjusted
    } catch (error) {
      result.errors.push(`calibration: ${describe(error)}`)
    }
  }

  if (exhausted()) {
    result.errors.push('drift skipped: no budget')
  } else {
    try {
      const { runDriftDetection } = await import('./drift-detection')
      const drift = await runDriftDetection(season)
      result.driftSeverity = drift.overallSeverity
    } catch (error) {
      result.errors.push(`drift: ${describe(error)}`)
    }
  }

  if (exhausted()) {
    result.errors.push('outcomes skipped: no budget')
  } else {
    try {
      const { logAcceptedTradesAsOutcomes } = await import('./trade-event-logger')
      result.outcomesLogged = await logAcceptedTradesAsOutcomes(season)
    } catch (error) {
      result.errors.push(`outcomes: ${describe(error)}`)
    }
  }

  return result
}
