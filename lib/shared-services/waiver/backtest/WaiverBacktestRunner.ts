/**
 * Waiver Shadow Backtest Runner — Phase 7. Mirrors Trade OS's
 * TradeShadowBacktestRunner.ts. Runs evaluateWaiverShadow() against each real
 * historical waiver sample from HistoricalWaiverLoader.ts, isolating
 * per-sample failures so one bad historical claim can never abort the rest
 * of the backtest run.
 */

import { evaluateWaiverShadow } from '@/lib/shared-services/waiver/WaiverShadowService'
import { defaultWaiverShadowResultStore, type WaiverShadowResultStore } from '@/lib/shared-services/waiver/WaiverShadowResultStore'
import type { HistoricalWaiverSample, WaiverBacktestRunSummary } from './types'

export interface WaiverBacktestRunOptions {
  /** Injectable for tests; defaults to the process-wide shadow log (same default as evaluateWaiverShadow). */
  resultStore?: WaiverShadowResultStore
  onSampleError?: (sample: HistoricalWaiverSample, error: unknown) => void
}

export async function runWaiverShadowBacktest(
  samples: HistoricalWaiverSample[],
  options: WaiverBacktestRunOptions = {}
): Promise<WaiverBacktestRunSummary> {
  const resultStore = options.resultStore ?? defaultWaiverShadowResultStore
  const evaluations: WaiverBacktestRunSummary['evaluations'] = []
  const failures: WaiverBacktestRunSummary['failures'] = []
  const pairs: WaiverBacktestRunSummary['pairs'] = []

  for (const sample of samples) {
    try {
      const evaluation = await evaluateWaiverShadow({
        leagueId: sample.leagueId,
        rosterId: sample.rosterId,
        resultStore,
      })
      evaluations.push(evaluation)
      pairs.push({ sample, evaluation })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ claimId: sample.claimId, error: message })
      options.onSampleError?.(sample, err)
    }
  }

  return {
    totalSamples: samples.length,
    evaluatedCount: evaluations.length,
    failedCount: failures.length,
    failures,
    evaluations,
    pairs,
  }
}
