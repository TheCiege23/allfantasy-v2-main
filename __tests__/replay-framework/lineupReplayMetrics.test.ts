/**
 * Decision OS Replay Framework Phase 13 — lineup replay metrics coverage.
 * Mirrors `tradeReplayMetrics.test.ts`'s exact discipline: proves the
 * metrics module is read-only and computes real distributions correctly.
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

import { computeLineupReplayMetrics } from '@/lib/replay-framework/metrics/lineupReplayMetrics'

function makeReplay(overrides: Partial<{ id: string; providerLeagueId: string; season: number; providerWeek: number; payload: unknown }> = {}) {
  return {
    id: overrides.id ?? 'replay-1',
    providerLeagueId: overrides.providerLeagueId ?? 'league-1',
    season: overrides.season ?? 2025,
    providerWeek: overrides.providerWeek ?? 1,
    payload: overrides.payload ?? {
      actualStarterIds: ['1001'],
      fullRoster: [
        { providerAssetId: '1001', name: 'Started QB', pos: ['QB'], actualPoints: 20 },
        { providerAssetId: '1002', name: 'Benched RB', pos: ['RB'], actualPoints: 15 },
      ],
      slotPositions: ['QB', 'RB'],
    },
  }
}

function makeBacktest(overrides: Partial<{
  replayId: string
  actualPoints: number
  optimalPoints: number
  pointsLeftOnBench: number
  efficiencyPct: number
  benchValueLeft: number
  startSitMistakeCount: number
  missedOptimalStarters: Array<{ providerAssetId: string; name: string; actualPoints: number }>
}> = {}) {
  return {
    replayId: overrides.replayId ?? 'replay-1',
    backtestedOutput: {
      actualPoints: overrides.actualPoints ?? 20,
      optimalPoints: overrides.optimalPoints ?? 35,
      pointsLeftOnBench: overrides.pointsLeftOnBench ?? 15,
      efficiencyPct: overrides.efficiencyPct ?? 0.57,
      benchValueLeft: overrides.benchValueLeft ?? 15,
      pointsFromSuboptimalStarters: 0,
      startSitMistakeCount: overrides.startSitMistakeCount ?? 1,
      missedOptimalStarters: overrides.missedOptimalStarters ?? [{ providerAssetId: '1002', name: 'Benched RB', actualPoints: 15 }],
      subOptimalActualStarters: [],
    },
  }
}

describe('computeLineupReplayMetrics', () => {
  afterEach(() => vi.clearAllMocks())

  it('is read-only — never calls any write method on either table', async () => {
    mockReplayImportFindMany.mockResolvedValue([makeReplay()])
    mockBacktestResultFindMany.mockResolvedValue([makeBacktest()])

    await computeLineupReplayMetrics()

    expect(mockReplayImportFindMany).toHaveBeenCalledTimes(1)
    expect(mockBacktestResultFindMany).toHaveBeenCalledTimes(1)
    expect(mockReplayImportWrite).not.toHaveBeenCalled()
    expect(mockBacktestResultWrite).not.toHaveBeenCalled()
  })

  it('computes correct totals, averages, and the efficiency/pointsLeftOnBench distributions', async () => {
    mockReplayImportFindMany.mockResolvedValue([makeReplay()])
    mockBacktestResultFindMany.mockResolvedValue([makeBacktest()])

    const result = await computeLineupReplayMetrics()

    expect(result.totalReplays).toBe(1)
    expect(result.avgActualPoints).toBe(20)
    expect(result.avgOptimalPoints).toBe(35)
    expect(result.avgPointsLeftOnBench).toBe(15)
    expect(result.avgBenchValueLeft).toBe(15)
    expect(result.avgEfficiencyPct).toBeCloseTo(0.57, 5)
    expect(result.avgStartSitMistakeCount).toBe(1)
  })

  it('groups position mistakes by the real position of the missed-optimal-starter', async () => {
    mockReplayImportFindMany.mockResolvedValue([
      makeReplay({ id: 'replay-1' }),
      makeReplay({
        id: 'replay-2',
        payload: {
          actualStarterIds: ['2001'],
          fullRoster: [
            { providerAssetId: '2001', name: 'Started WR', pos: ['WR'], actualPoints: 10 },
            { providerAssetId: '2002', name: 'Benched TE', pos: ['TE'], actualPoints: 12 },
          ],
          slotPositions: ['WR', 'TE'],
        },
      }),
    ])
    mockBacktestResultFindMany.mockResolvedValue([
      makeBacktest({ replayId: 'replay-1' }), // missed RB
      makeBacktest({
        replayId: 'replay-2',
        missedOptimalStarters: [{ providerAssetId: '2002', name: 'Benched TE', actualPoints: 12 }],
      }),
    ])

    const result = await computeLineupReplayMetrics()

    expect(result.positionMistakeCounts).toEqual({ RB: 1, TE: 1 })
  })

  it('groups weekly efficiency by providerWeek for a "weekly improvement" trend', async () => {
    mockReplayImportFindMany.mockResolvedValue([
      makeReplay({ id: 'replay-1', providerWeek: 1 }),
      makeReplay({ id: 'replay-2', providerWeek: 2 }),
    ])
    mockBacktestResultFindMany.mockResolvedValue([
      makeBacktest({ replayId: 'replay-1', efficiencyPct: 0.5 }),
      makeBacktest({ replayId: 'replay-2', efficiencyPct: 0.9 }),
    ])

    const result = await computeLineupReplayMetrics()

    expect(result.weeklyEfficiency).toEqual([
      { week: 1, avgEfficiencyPct: 0.5, count: 1 },
      { week: 2, avgEfficiencyPct: 0.9, count: 1 },
    ])
  })

  it('filters to a specific providerLeagueIds subset when given one', async () => {
    mockReplayImportFindMany.mockResolvedValue([])
    mockBacktestResultFindMany.mockResolvedValue([])

    await computeLineupReplayMetrics(['league-a', 'league-b'])

    expect(mockReplayImportFindMany.mock.calls[0][0].where).toMatchObject({
      decisionType: 'lineup',
      providerLeagueId: { in: ['league-a', 'league-b'] },
    })
  })

  it('handles zero real data safely — no NaN, no throw', async () => {
    mockReplayImportFindMany.mockResolvedValue([])
    mockBacktestResultFindMany.mockResolvedValue([])

    const result = await computeLineupReplayMetrics()

    expect(result.totalReplays).toBe(0)
    expect(result.avgEfficiencyPct).toBeNull()
    expect(result.weeklyEfficiency).toEqual([])
    expect(result.positionMistakeCounts).toEqual({})
  })
})
