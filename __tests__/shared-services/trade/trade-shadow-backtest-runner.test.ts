/**
 * Tests for TradeShadowBacktestRunner.ts — Trade Shadow Backtest, Phase 6.
 * Mocks evaluateTradeShadow (Phase 5's own entry point, already covered by
 * trade-shadow-service.test.ts) to isolate the runner's own orchestration:
 * per-sample invocation, failure isolation, and empty-corpus handling.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoricalTradeSample } from '@/lib/shared-services/trade/backtest/types'

const { mockEvaluateTradeShadow } = vi.hoisted(() => ({ mockEvaluateTradeShadow: vi.fn() }))

vi.mock('@/lib/shared-services/trade/TradeShadowService', () => ({
  evaluateTradeShadow: mockEvaluateTradeShadow,
}))

import { runTradeShadowBacktest } from '@/lib/shared-services/trade/backtest/TradeShadowBacktestRunner'
import { InMemoryShadowResultStore } from '@/lib/shared-services/trade/ShadowResultStore'

function makeSample(overrides: Partial<HistoricalTradeSample> = {}): HistoricalTradeSample {
  return {
    offerEventId: 'offer-1',
    afLeagueTradeId: 'trade-1',
    leagueId: 'league-1',
    platformLeagueId: 'sleeper-league-1',
    platform: 'sleeper',
    afUserId: null,
    sideARosterId: '1',
    sideBRosterId: '2',
    sideAAssetNames: ['Patrick Mahomes'],
    sideBAssetNames: ['Josh Allen'],
    realOutcome: 'ACCEPTED',
    capturedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('runTradeShadowBacktest', () => {
  let resultStore: InMemoryShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryShadowResultStore()
  })

  it('evaluates every sample and passes the normalized fields through to evaluateTradeShadow', async () => {
    mockEvaluateTradeShadow.mockResolvedValue({ evaluationId: 'eval-1' })
    const sample = makeSample()

    await runTradeShadowBacktest([sample], { resultStore })

    expect(mockEvaluateTradeShadow).toHaveBeenCalledWith({
      leagueId: 'sleeper-league-1',
      username: '',
      platform: 'sleeper',
      userId: undefined,
      sideARosterId: '1',
      sideBRosterId: '2',
      sideAAssetNames: ['Patrick Mahomes'],
      sideBAssetNames: ['Josh Allen'],
      resultStore,
    })
  })

  it('returns a real summary with one evaluation per successful sample', async () => {
    mockEvaluateTradeShadow.mockResolvedValue({ evaluationId: 'eval-1' })

    const summary = await runTradeShadowBacktest([makeSample(), makeSample({ afLeagueTradeId: 'trade-2', offerEventId: 'offer-2' })], {
      resultStore,
    })

    expect(summary.totalSamples).toBe(2)
    expect(summary.evaluatedCount).toBe(2)
    expect(summary.failedCount).toBe(0)
    expect(summary.evaluations).toHaveLength(2)
  })

  it('isolates a single sample failure — the rest of the batch still evaluates', async () => {
    mockEvaluateTradeShadow
      .mockRejectedValueOnce(new Error('Teams not found in league context'))
      .mockResolvedValueOnce({ evaluationId: 'eval-2' })

    const onSampleError = vi.fn()
    const summary = await runTradeShadowBacktest(
      [makeSample({ afLeagueTradeId: 'trade-1' }), makeSample({ afLeagueTradeId: 'trade-2', offerEventId: 'offer-2' })],
      { resultStore, onSampleError }
    )

    expect(summary.evaluatedCount).toBe(1)
    expect(summary.failedCount).toBe(1)
    expect(summary.failures).toEqual([
      { afLeagueTradeId: 'trade-1', offerEventId: 'offer-1', error: 'Teams not found in league context' },
    ])
    expect(onSampleError).toHaveBeenCalledTimes(1)
  })

  it('handles an empty sample corpus cleanly', async () => {
    const summary = await runTradeShadowBacktest([], { resultStore })
    expect(summary).toEqual({ totalSamples: 0, evaluatedCount: 0, failedCount: 0, failures: [], evaluations: [] })
    expect(mockEvaluateTradeShadow).not.toHaveBeenCalled()
  })
})
