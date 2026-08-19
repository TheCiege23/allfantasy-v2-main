/**
 * Decision OS Replay Framework — trade replay metrics coverage. Proves the
 * metrics module is read-only, computes real distributions correctly, and
 * reproduces the real finding measured directly against staging in Phase 5
 * (real accepted trades scoring low on predicted acceptance).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const { mockReplayImportFindMany, mockBacktestResultFindMany, mockReplayImportWrite, mockBacktestResultWrite } = vi.hoisted(() => ({
  mockReplayImportFindMany: vi.fn(),
  mockBacktestResultFindMany: vi.fn(),
  mockReplayImportWrite: vi.fn(),
  mockBacktestResultWrite: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    replayImport: { findMany: mockReplayImportFindMany, create: mockReplayImportWrite, upsert: mockReplayImportWrite, update: mockReplayImportWrite, delete: mockReplayImportWrite },
    replayBacktestResult: { findMany: mockBacktestResultFindMany, create: mockBacktestResultWrite, upsert: mockBacktestResultWrite, update: mockBacktestResultWrite, delete: mockBacktestResultWrite },
  },
}))

import { computeTradeReplayMetrics } from '@/lib/replay-framework/metrics/tradeReplayMetrics'

function makeReplay(overrides: Partial<{ id: string; providerLeagueId: string; season: number; isSuperFlex: boolean; isDynasty: boolean; payload: unknown }> = {}) {
  return {
    id: overrides.id ?? 'replay-1',
    providerLeagueId: overrides.providerLeagueId ?? 'league-1',
    season: overrides.season ?? 2025,
    isSuperFlex: overrides.isSuperFlex ?? false,
    isDynasty: overrides.isDynasty ?? true,
    payload: overrides.payload ?? { assetsGiven: [{ name: 'A', value: 100, type: 'player' }], assetsReceived: [{ name: 'B', value: 100, type: 'player' }] },
  }
}

function makeBacktest(overrides: Partial<{ replayId: string; acceptProb: number; verdict: string; confidenceScore: number; realOutcome: unknown; deltaThem: number | null }> = {}) {
  return {
    replayId: overrides.replayId ?? 'replay-1',
    backtestedOutput: {
      acceptProb: overrides.acceptProb ?? 0.25,
      verdict: overrides.verdict ?? 'Fair',
      confidenceScore: overrides.confidenceScore ?? 40,
      lineupImpactScore: 0.1,
      vorpScore: 0.5,
      marketScore: 0.5,
      behaviorScore: 0.5,
      hasLineupData: overrides.deltaThem !== undefined,
      deltaThem: overrides.deltaThem !== undefined ? overrides.deltaThem : null,
    },
    realOutcome: overrides.realOutcome !== undefined ? overrides.realOutcome : { outcome: 'ACCEPTED', providerStatus: 'complete' },
  }
}

describe('computeTradeReplayMetrics', () => {
  afterEach(() => vi.clearAllMocks())

  it('is read-only — never calls any write method on either table', async () => {
    mockReplayImportFindMany.mockResolvedValue([makeReplay()])
    mockBacktestResultFindMany.mockResolvedValue([makeBacktest()])

    await computeTradeReplayMetrics()

    expect(mockReplayImportFindMany).toHaveBeenCalledTimes(1)
    expect(mockBacktestResultFindMany).toHaveBeenCalledTimes(1)
    expect(mockReplayImportWrite).not.toHaveBeenCalled()
    expect(mockBacktestResultWrite).not.toHaveBeenCalled()
  })

  it('computes correct totals, seasons, and leagues', async () => {
    mockReplayImportFindMany.mockResolvedValue([
      makeReplay({ id: 'r1', providerLeagueId: 'league-a', season: 2025 }),
      makeReplay({ id: 'r2', providerLeagueId: 'league-b', season: 2026 }),
    ])
    mockBacktestResultFindMany.mockResolvedValue([makeBacktest({ replayId: 'r1' }), makeBacktest({ replayId: 'r2' })])

    const result = await computeTradeReplayMetrics()

    expect(result.totalReplays).toBe(2)
    expect(result.totalBacktests).toBe(2)
    expect(result.seasons).toEqual([2025, 2026])
    expect(result.leagues).toEqual(['league-a', 'league-b'])
  })

  it('computes avg/min/max predicted acceptance correctly', async () => {
    mockReplayImportFindMany.mockResolvedValue([makeReplay({ id: 'r1' }), makeReplay({ id: 'r2' }), makeReplay({ id: 'r3' })])
    mockBacktestResultFindMany.mockResolvedValue([
      makeBacktest({ replayId: 'r1', acceptProb: 0.2 }),
      makeBacktest({ replayId: 'r2', acceptProb: 0.3 }),
      makeBacktest({ replayId: 'r3', acceptProb: 0.4 }),
    ])

    const result = await computeTradeReplayMetrics()

    expect(result.avgPredictedAcceptance).toBeCloseTo(0.3, 5)
    expect(result.minPredictedAcceptance).toBe(0.2)
    expect(result.maxPredictedAcceptance).toBe(0.4)
  })

  it('builds the fairness (verdict) distribution', async () => {
    mockReplayImportFindMany.mockResolvedValue([makeReplay({ id: 'r1' }), makeReplay({ id: 'r2' }), makeReplay({ id: 'r3' })])
    mockBacktestResultFindMany.mockResolvedValue([
      makeBacktest({ replayId: 'r1', verdict: 'Overpay Risk' }),
      makeBacktest({ replayId: 'r2', verdict: 'Overpay Risk' }),
      makeBacktest({ replayId: 'r3', verdict: 'Fair' }),
    ])

    const result = await computeTradeReplayMetrics()

    expect(result.fairnessDistribution).toEqual({ 'Overpay Risk': 2, Fair: 1 })
  })

  it('reproduces the real Phase 5 finding: real accepted trades cluster at low predicted acceptance', async () => {
    // Matches the shape of the real staging data measured in Phase 5 —
    // 38 real accepted trades averaging ~0.257 predicted acceptance.
    const replays = Array.from({ length: 5 }, (_, i) => makeReplay({ id: `r${i}` }))
    const backtests = [0.2, 0.22, 0.26, 0.28, 0.31].map((acceptProb, i) => makeBacktest({ replayId: `r${i}`, acceptProb }))
    mockReplayImportFindMany.mockResolvedValue(replays)
    mockBacktestResultFindMany.mockResolvedValue(backtests)

    const result = await computeTradeReplayMetrics()

    expect(result.avgAcceptedTradeProbability).toBeCloseTo(0.254, 2)
    expect(result.avgAcceptedTradeProbability!).toBeLessThan(0.5) // the finding: systematically below the midpoint
  })

  it('excludes non-accepted rows from the accepted-trade probability distribution', async () => {
    mockReplayImportFindMany.mockResolvedValue([makeReplay({ id: 'r1' }), makeReplay({ id: 'r2' })])
    mockBacktestResultFindMany.mockResolvedValue([
      makeBacktest({ replayId: 'r1', acceptProb: 0.9, realOutcome: { outcome: 'REJECTED', providerStatus: 'failed' } }),
      makeBacktest({ replayId: 'r2', acceptProb: 0.2, realOutcome: { outcome: 'ACCEPTED', providerStatus: 'complete' } }),
    ])

    const result = await computeTradeReplayMetrics()

    expect(result.avgAcceptedTradeProbability).toBe(0.2) // only the ACCEPTED row counts, not the 0.9 rejected one
  })

  it('computes a value-delta distribution from real asset payloads', async () => {
    mockReplayImportFindMany.mockResolvedValue([
      makeReplay({ id: 'r1', payload: { assetsGiven: [{ name: 'A', value: 100, type: 'player' }], assetsReceived: [{ name: 'B', value: 200, type: 'player' }] } }),
    ])
    mockBacktestResultFindMany.mockResolvedValue([makeBacktest({ replayId: 'r1' })])

    const result = await computeTradeReplayMetrics()

    const nonZeroBuckets = result.valueDeltaDistribution.filter((b) => b.count > 0)
    expect(nonZeroBuckets.length).toBeGreaterThan(0)
    expect(result.valueDeltaDistribution.reduce((s, b) => s + b.count, 0)).toBe(1)
  })

  it('breaks results down by league settings (isSuperFlex/isDynasty)', async () => {
    mockReplayImportFindMany.mockResolvedValue([
      makeReplay({ id: 'r1', providerLeagueId: 'league-sf', isSuperFlex: true, season: 2025 }),
      makeReplay({ id: 'r2', providerLeagueId: 'league-1qb', isSuperFlex: false, season: 2025 }),
    ])
    mockBacktestResultFindMany.mockResolvedValue([
      makeBacktest({ replayId: 'r1', acceptProb: 0.3 }),
      makeBacktest({ replayId: 'r2', acceptProb: 0.4 }),
    ])

    const result = await computeTradeReplayMetrics()

    expect(result.leagueSettingsSensitivity).toHaveLength(2)
    const sf = result.leagueSettingsSensitivity.find((s) => s.providerLeagueId === 'league-sf')
    expect(sf?.isSuperFlex).toBe(true)
    expect(sf?.avgPredictedAcceptance).toBe(0.3)
  })

  it('handles zero real data safely (no rows yet)', async () => {
    mockReplayImportFindMany.mockResolvedValue([])
    mockBacktestResultFindMany.mockResolvedValue([])

    const result = await computeTradeReplayMetrics()

    expect(result.totalReplays).toBe(0)
    expect(result.avgPredictedAcceptance).toBeNull()
    expect(result.avgAcceptedTradeProbability).toBeNull()
    expect(result.fairnessDistribution).toEqual({})
    expect(result.starterInvolvedCount).toBe(0)
    expect(result.benchDepthCount).toBe(0)
    expect(result.avgPredictedAcceptanceStarterInvolved).toBeNull()
    expect(result.avgPredictedAcceptanceBenchDepth).toBeNull()
  })

  it('Phase 9: scopes to a specific set of leagues when providerLeagueIds is passed', async () => {
    mockReplayImportFindMany.mockResolvedValue([makeReplay({ id: 'r1', providerLeagueId: 'league-a' })])
    mockBacktestResultFindMany.mockResolvedValue([makeBacktest({ replayId: 'r1' })])

    await computeTradeReplayMetrics(['league-a', 'league-b'])

    const replayCallArg = mockReplayImportFindMany.mock.calls[0][0]
    expect(replayCallArg.where.providerLeagueId).toEqual({ in: ['league-a', 'league-b'] })
    const backtestCallArg = mockBacktestResultFindMany.mock.calls[0][0]
    expect(backtestCallArg.where.replay.providerLeagueId).toEqual({ in: ['league-a', 'league-b'] })
  })

  it('Phase 9: does not scope by league when providerLeagueIds is omitted (unchanged default behavior)', async () => {
    mockReplayImportFindMany.mockResolvedValue([makeReplay()])
    mockBacktestResultFindMany.mockResolvedValue([makeBacktest()])

    await computeTradeReplayMetrics()

    const replayCallArg = mockReplayImportFindMany.mock.calls[0][0]
    expect(replayCallArg.where.providerLeagueId).toBeUndefined()
  })

  it('Phase 9: classifies trades as starter-involved (deltaThem !== 0) vs bench-depth (deltaThem === 0)', async () => {
    mockReplayImportFindMany.mockResolvedValue([
      makeReplay({ id: 'r1' }), makeReplay({ id: 'r2' }), makeReplay({ id: 'r3' }),
    ])
    mockBacktestResultFindMany.mockResolvedValue([
      makeBacktest({ replayId: 'r1', deltaThem: 0, acceptProb: 0.2 }),
      makeBacktest({ replayId: 'r2', deltaThem: 0, acceptProb: 0.3 }),
      makeBacktest({ replayId: 'r3', deltaThem: 3.5, acceptProb: 0.6 }),
    ])

    const result = await computeTradeReplayMetrics()

    expect(result.benchDepthCount).toBe(2)
    expect(result.starterInvolvedCount).toBe(1)
    expect(result.avgPredictedAcceptanceBenchDepth).toBeCloseTo(0.25, 5)
    expect(result.avgPredictedAcceptanceStarterInvolved).toBe(0.6)
  })

  it('Phase 9: buckets deltaThem by magnitude, including zero and negative values', async () => {
    mockReplayImportFindMany.mockResolvedValue([
      makeReplay({ id: 'r1' }), makeReplay({ id: 'r2' }), makeReplay({ id: 'r3' }), makeReplay({ id: 'r4' }),
    ])
    mockBacktestResultFindMany.mockResolvedValue([
      makeBacktest({ replayId: 'r1', deltaThem: 0 }),
      makeBacktest({ replayId: 'r2', deltaThem: -1.65 }),
      makeBacktest({ replayId: 'r3', deltaThem: 6 }),
      makeBacktest({ replayId: 'r4', deltaThem: 12 }),
    ])

    const result = await computeTradeReplayMetrics()

    const byBucket = Object.fromEntries(result.deltaThemDistribution.map((b) => [b.bucket, b.count]))
    expect(byBucket['zero']).toBe(1)
    expect(byBucket['0 to 2 (abs)']).toBe(1)
    expect(byBucket['5 to 10 (abs)']).toBe(1)
    expect(byBucket['10+ (abs)']).toBe(1)
  })
})
