import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoricalWaiverSample } from '@/lib/shared-services/waiver/backtest/types'

const { mockEvaluateWaiverShadow } = vi.hoisted(() => ({ mockEvaluateWaiverShadow: vi.fn() }))

vi.mock('@/lib/shared-services/waiver/WaiverShadowService', () => ({
  evaluateWaiverShadow: mockEvaluateWaiverShadow,
}))

import { runWaiverShadowBacktest } from '@/lib/shared-services/waiver/backtest/WaiverBacktestRunner'
import { InMemoryWaiverShadowResultStore } from '@/lib/shared-services/waiver/WaiverShadowResultStore'

function makeSample(overrides: Partial<HistoricalWaiverSample> = {}): HistoricalWaiverSample {
  return {
    claimId: 'claim-1',
    leagueId: 'league-1',
    rosterId: 'roster-1',
    platform: 'sleeper',
    managerKey: 'manager-1',
    addPlayerId: 'p1',
    addPlayerName: null,
    dropPlayerId: null,
    faabBid: 10,
    priorityOrder: 1,
    realOutcome: 'awarded',
    realFaabDelta: -10,
    processedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('runWaiverShadowBacktest', () => {
  let resultStore: InMemoryWaiverShadowResultStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryWaiverShadowResultStore()
  })

  it('evaluates every sample with the normalized leagueId/rosterId', async () => {
    mockEvaluateWaiverShadow.mockResolvedValue({ evaluationId: 'eval-1' })
    await runWaiverShadowBacktest([makeSample()], { resultStore })
    expect(mockEvaluateWaiverShadow).toHaveBeenCalledWith({ leagueId: 'league-1', rosterId: 'roster-1', resultStore })
  })

  it('returns paired sample+evaluation results for successful samples', async () => {
    const evaluation = { evaluationId: 'eval-1' }
    mockEvaluateWaiverShadow.mockResolvedValue(evaluation)
    const sample = makeSample()

    const summary = await runWaiverShadowBacktest([sample], { resultStore })

    expect(summary.totalSamples).toBe(1)
    expect(summary.evaluatedCount).toBe(1)
    expect(summary.pairs).toEqual([{ sample, evaluation }])
  })

  it('isolates a single sample failure — the rest of the batch still evaluates', async () => {
    mockEvaluateWaiverShadow.mockRejectedValueOnce(new Error('League not found')).mockResolvedValueOnce({ evaluationId: 'eval-2' })
    const onSampleError = vi.fn()

    const summary = await runWaiverShadowBacktest(
      [makeSample({ claimId: 'claim-1' }), makeSample({ claimId: 'claim-2' })],
      { resultStore, onSampleError }
    )

    expect(summary.evaluatedCount).toBe(1)
    expect(summary.failedCount).toBe(1)
    expect(summary.failures).toEqual([{ claimId: 'claim-1', error: 'League not found' }])
    expect(onSampleError).toHaveBeenCalledTimes(1)
  })

  it('handles an empty sample corpus cleanly', async () => {
    const summary = await runWaiverShadowBacktest([], { resultStore })
    expect(summary).toEqual({ totalSamples: 0, evaluatedCount: 0, failedCount: 0, failures: [], evaluations: [], pairs: [] })
    expect(mockEvaluateWaiverShadow).not.toHaveBeenCalled()
  })
})
