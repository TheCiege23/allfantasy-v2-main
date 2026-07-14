/**
 * Trade Shadow Backtest Runner — Phase 6.
 *
 * Runs Phase 5's evaluateTradeShadow() against each real historical trade
 * sample from HistoricalTradeLoader.ts. Isolates per-sample failures: one
 * bad historical trade (e.g. a league whose provider fetch now fails) must
 * never abort the rest of the backtest run. This is a deliberate difference
 * from evaluateTradeShadow()'s own contract, where a primary-grader failure
 * is left uncaught (see TradeShadowService.ts's docstring) — that contract
 * is for a single live call; a backtest driving many samples needs its own
 * isolation layer on top, which is what this file adds.
 */

import { evaluateTradeShadow } from '@/lib/shared-services/trade/TradeShadowService'
import { defaultShadowResultStore, type ShadowResultStore } from '@/lib/shared-services/trade/ShadowResultStore'
import type { BacktestRunSummary, HistoricalTradeSample } from './types'

export interface BacktestRunOptions {
  /** Injectable for tests; defaults to the process-wide shadow log (same default as evaluateTradeShadow). */
  resultStore?: ShadowResultStore
  onSampleError?: (sample: HistoricalTradeSample, error: unknown) => void
}

export async function runTradeShadowBacktest(
  samples: HistoricalTradeSample[],
  options: BacktestRunOptions = {}
): Promise<BacktestRunSummary> {
  const resultStore = options.resultStore ?? defaultShadowResultStore
  const evaluations: BacktestRunSummary['evaluations'] = []
  const failures: BacktestRunSummary['failures'] = []

  for (const sample of samples) {
    try {
      const evaluation = await evaluateTradeShadow({
        leagueId: sample.platformLeagueId,
        // The Sleeper-only pre-analysis cache is the sole consumer of `username`
        // (see league-context-assembler.ts) — a backtest run has no real
        // end-user session, so an empty string is a harmless cache miss, not a
        // fabricated identity.
        username: '',
        platform: sample.platform,
        userId: sample.afUserId ?? undefined,
        sideARosterId: sample.sideARosterId,
        sideBRosterId: sample.sideBRosterId,
        sideAAssetNames: sample.sideAAssetNames,
        sideBAssetNames: sample.sideBAssetNames,
        resultStore,
      })
      evaluations.push(evaluation)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failures.push({ afLeagueTradeId: sample.afLeagueTradeId, offerEventId: sample.offerEventId, error: message })
      options.onSampleError?.(sample, err)
    }
  }

  return {
    totalSamples: samples.length,
    evaluatedCount: evaluations.length,
    failedCount: failures.length,
    failures,
    evaluations,
  }
}
