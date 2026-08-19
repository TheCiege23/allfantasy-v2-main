/**
 * Decision OS Replay Framework — deterministic trade backtest executor
 * coverage. Proves the backtest calls the REAL, unmodified trade-engine
 * functions (mocked here only to control their output deterministically),
 * versions its result correctly, and honestly withholds realOutcome for
 * still-pending trades.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockGetCalibratedWeights, mockCalibrateAcceptProbability, mockComputeTradeDrivers } = vi.hoisted(() => ({
  mockGetCalibratedWeights: vi.fn(),
  mockCalibrateAcceptProbability: vi.fn(),
  mockComputeTradeDrivers: vi.fn(),
}))

vi.mock('@/lib/trade-engine/accept-calibration', () => ({
  getCalibratedWeights: mockGetCalibratedWeights,
  calibrateAcceptProbability: mockCalibrateAcceptProbability,
}))

vi.mock('@/lib/trade-engine/trade-engine', () => ({
  computeTradeDrivers: mockComputeTradeDrivers,
}))

import { runTradeBacktest } from '@/lib/replay-framework/backtest/tradeBacktestExecutor'

const BASE_INPUT = {
  replayId: 'replay-1',
  season: 2025,
  payload: {
    assetsGiven: [{ name: 'Player A', value: 100, type: 'player' }],
    assetsReceived: [{ name: 'Player B', value: 120, type: 'player' }],
  },
  isSuperFlex: false,
  providerStatus: 'complete',
  resolvedAt: new Date('2025-09-02T00:00:00.000Z'),
}

describe('runTradeBacktest', () => {
  afterEach(() => vi.clearAllMocks())

  it('calls the real deterministic pipeline (getCalibratedWeights -> computeTradeDrivers -> calibrateAcceptProbability) and returns a versioned result', async () => {
    mockGetCalibratedWeights.mockResolvedValue({ b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    mockComputeTradeDrivers.mockReturnValue({
      acceptProbability: 0.4,
      verdict: 'LEAN_ACCEPT',
      confidenceScore: 80,
      lineupImpactScore: 1,
      vorpScore: 2,
      marketScore: 0.55,
      behaviorScore: 3,
    })
    mockCalibrateAcceptProbability.mockResolvedValue({ calibrated: 0.42, raw: 0.4, isotonicApplied: false })

    const result = await runTradeBacktest(BASE_INPUT)

    expect(mockGetCalibratedWeights).toHaveBeenCalledWith(2025, { isSuperFlex: false, scoringType: undefined })
    expect(mockComputeTradeDrivers).toHaveBeenCalled()
    expect(mockCalibrateAcceptProbability).toHaveBeenCalledWith(0.4, 2025)

    expect(result.decisionType).toBe('trade')
    expect(result.modelVersion).toBe('trade-engine-deterministic-v1')
    expect(result.deterministicConfigVersion).toBe('b0:-1.1000')
    expect((result.backtestedOutput as any).acceptProb).toBe(0.42)
    expect((result.backtestedOutput as any).verdict).toBe('LEAN_ACCEPT')
  })

  it('settles realOutcome for a completed trade', async () => {
    mockGetCalibratedWeights.mockResolvedValue({ b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    mockComputeTradeDrivers.mockReturnValue({ acceptProbability: 0.4, verdict: 'LEAN_ACCEPT', confidenceScore: 80, lineupImpactScore: 1, vorpScore: 2, marketScore: 0.55, behaviorScore: 3 })
    mockCalibrateAcceptProbability.mockResolvedValue({ calibrated: 0.42, raw: 0.4, isotonicApplied: false })

    const result = await runTradeBacktest({ ...BASE_INPUT, providerStatus: 'complete' })

    expect(result.realOutcome).toEqual({ outcome: 'ACCEPTED', providerStatus: 'complete' })
  })

  it('withholds realOutcome for a still-pending trade — no unearned assumption of resolution', async () => {
    mockGetCalibratedWeights.mockResolvedValue({ b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    mockComputeTradeDrivers.mockReturnValue({ acceptProbability: 0.4, verdict: 'LEAN_ACCEPT', confidenceScore: 80, lineupImpactScore: 1, vorpScore: 2, marketScore: 0.55, behaviorScore: 3 })
    mockCalibrateAcceptProbability.mockResolvedValue({ calibrated: 0.42, raw: 0.4, isotonicApplied: false })

    const result = await runTradeBacktest({ ...BASE_INPUT, providerStatus: 'pending' })

    expect(result.realOutcome).toBeNull()
  })

  it('a different calibratedB0 produces a different deterministicConfigVersion, so config changes are distinguishable in history', async () => {
    mockComputeTradeDrivers.mockReturnValue({ acceptProbability: 0.4, verdict: 'LEAN_ACCEPT', confidenceScore: 80, lineupImpactScore: 1, vorpScore: 2, marketScore: 0.55, behaviorScore: 3 })
    mockCalibrateAcceptProbability.mockResolvedValue({ calibrated: 0.42, raw: 0.4, isotonicApplied: false })

    mockGetCalibratedWeights.mockResolvedValueOnce({ b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    const first = await runTradeBacktest(BASE_INPUT)

    mockGetCalibratedWeights.mockResolvedValueOnce({ b0: -1.3, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    const second = await runTradeBacktest(BASE_INPUT)

    expect(first.deterministicConfigVersion).not.toBe(second.deterministicConfigVersion)
  })

  it('Phase 6: builds and passes a real rosterCtx to computeTradeDrivers() when roster context and rosterPositions are both present', async () => {
    mockGetCalibratedWeights.mockResolvedValue({ b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    mockComputeTradeDrivers.mockReturnValue({ acceptProbability: 0.4, verdict: 'Fair', confidenceScore: 60, lineupImpactScore: 1, vorpScore: 2, marketScore: 0.55, behaviorScore: 3 })
    mockCalibrateAcceptProbability.mockResolvedValue({ calibrated: 0.4, raw: 0.4, isotonicApplied: false })

    await runTradeBacktest({
      ...BASE_INPUT,
      payload: {
        ...BASE_INPUT.payload,
        proposerRoster: [{ name: 'Bench Player', value: 200, type: 'player', pos: 'QB' }],
        counterpartyRoster: [{ name: 'Their Bench Player', value: 150, type: 'player', pos: 'WR' }],
      },
      rosterPositions: ['QB', 'RB', 'WR', 'BN'],
    })

    const rosterCtxArg = mockComputeTradeDrivers.mock.calls[0][6]
    expect(rosterCtxArg).toBeDefined()
    expect(rosterCtxArg.yourRoster).toHaveLength(1)
    expect(rosterCtxArg.yourRoster[0].pos).toBe('QB')
    expect(rosterCtxArg.theirRoster).toHaveLength(1)
    expect(rosterCtxArg.rosterPositions).toEqual(['QB', 'RB', 'WR', 'BN'])
  })

  it('Phase 6: omits rosterCtx (passes undefined) when the payload has no roster context — backward-compatible with pre-Phase-6 replay rows', async () => {
    mockGetCalibratedWeights.mockResolvedValue({ b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    mockComputeTradeDrivers.mockReturnValue({ acceptProbability: 0.4, verdict: 'Fair', confidenceScore: 40, lineupImpactScore: 1, vorpScore: 2, marketScore: 0.55, behaviorScore: 3 })
    mockCalibrateAcceptProbability.mockResolvedValue({ calibrated: 0.4, raw: 0.4, isotonicApplied: false })

    await runTradeBacktest(BASE_INPUT) // no proposerRoster/counterpartyRoster/rosterPositions

    const rosterCtxArg = mockComputeTradeDrivers.mock.calls[0][6]
    expect(rosterCtxArg).toBeUndefined()
  })

  it('Phase 6: omits rosterCtx when roster context exists but rosterPositions is missing', async () => {
    mockGetCalibratedWeights.mockResolvedValue({ b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    mockComputeTradeDrivers.mockReturnValue({ acceptProbability: 0.4, verdict: 'Fair', confidenceScore: 40, lineupImpactScore: 1, vorpScore: 2, marketScore: 0.55, behaviorScore: 3 })
    mockCalibrateAcceptProbability.mockResolvedValue({ calibrated: 0.4, raw: 0.4, isotonicApplied: false })

    await runTradeBacktest({
      ...BASE_INPUT,
      payload: { ...BASE_INPUT.payload, proposerRoster: [{ name: 'X', value: 100, type: 'player', pos: 'QB' }] },
      // rosterPositions intentionally omitted
    })

    const rosterCtxArg = mockComputeTradeDrivers.mock.calls[0][6]
    expect(rosterCtxArg).toBeUndefined()
  })

  it('Phase 7: passes vorpValue through onto every give/receive and roster Asset object', async () => {
    mockGetCalibratedWeights.mockResolvedValue({ b0: -1.1, w1: 1.25, w2: 0.7, w3: 0.9, w4: 0.15, w5: 0.25, w6: 0.85, w7: 0.2 })
    mockComputeTradeDrivers.mockReturnValue({ acceptProbability: 0.4, verdict: 'Fair', confidenceScore: 60, lineupImpactScore: 1, vorpScore: 2, marketScore: 0.55, behaviorScore: 3 })
    mockCalibrateAcceptProbability.mockResolvedValue({ calibrated: 0.4, raw: 0.4, isotonicApplied: false })

    await runTradeBacktest({
      ...BASE_INPUT,
      payload: {
        assetsGiven: [{ name: 'Player A', value: 100, type: 'player', vorpValue: 12.5 }],
        assetsReceived: [{ name: 'Player B', value: 120, type: 'player', vorpValue: 8.2 }],
        proposerRoster: [{ name: 'Bench Player', value: 200, type: 'player', pos: 'QB', vorpValue: 5 }],
        counterpartyRoster: [{ name: 'Their Bench Player', value: 150, type: 'player', pos: 'WR', vorpValue: 3 }],
      },
      rosterPositions: ['QB', 'RB', 'WR', 'BN'],
    })

    const [give, receive, , , , , rosterCtxArg] = mockComputeTradeDrivers.mock.calls[0]
    expect(give[0].vorpValue).toBe(12.5)
    expect(receive[0].vorpValue).toBe(8.2)
    expect(rosterCtxArg.yourRoster[0].vorpValue).toBe(5)
    expect(rosterCtxArg.theirRoster[0].vorpValue).toBe(3)
  })
})
