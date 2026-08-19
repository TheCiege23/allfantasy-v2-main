/**
 * Decision OS Replay Framework Phase 15-16 — Decision Replay Correlation
 * coverage. Proves the module is read-only and correctly joins a real
 * trade's acquired players against their subsequent real lineup history on
 * the receiving roster, using `providerAssetId` as the join key (mirroring
 * Phase 9's ID-consistency lesson from Trade Replay). Phase 16 adds
 * targeted coverage for roster-churn classification (resolving Phase 15's
 * zero-appearance ambiguity) and the matched before/after window.
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

import { computeDecisionReplayCorrelation } from '@/lib/replay-framework/metrics/decisionReplayCorrelation'

const SEASON = 2025
const LEAGUE = 'league-1'

function makeTradeReplay(overrides: Partial<{ id: string; resolvedAt: Date; participantsInvolved: number[]; givenValue: number; acquiredId: string; acquiredName: string }> = {}) {
  return {
    id: overrides.id ?? 'trade-1',
    providerLeagueId: LEAGUE,
    season: SEASON,
    resolvedAt: overrides.resolvedAt ?? new Date(Date.UTC(2025, 8, 1)), // approx week 1
    participantsInvolved: overrides.participantsInvolved ?? [1, 2],
    payload: {
      assetsGiven: [{ name: 'Given Player', value: overrides.givenValue ?? 1000, type: 'player', providerAssetId: 'given-1' }],
      assetsReceived: [{ name: overrides.acquiredName ?? 'Acquired Player', value: 1000, type: 'player', providerAssetId: overrides.acquiredId ?? 'acquired-1' }],
    },
  }
}

function makeTradeBacktest(overrides: Partial<{ replayId: string; verdict: string; acceptProb: number; confidenceScore: number }> = {}) {
  return {
    replayId: overrides.replayId ?? 'trade-1',
    backtestedOutput: {
      acceptProb: overrides.acceptProb ?? 0.5,
      verdict: overrides.verdict ?? 'Fair',
      confidenceScore: overrides.confidenceScore ?? 60,
      lineupImpactScore: 0.5,
      vorpScore: 0.5,
      marketScore: 0.5,
      behaviorScore: 0.5,
    },
  }
}

function makeLineupReplay(overrides: Partial<{ id: string; week: number; rosterId: number; actualStarterIds: string[]; fullRoster: Array<{ providerAssetId: string; name: string; pos: string[]; actualPoints: number }> }> = {}) {
  return {
    id: overrides.id ?? `lineup-${overrides.week ?? 1}`,
    providerLeagueId: LEAGUE,
    season: SEASON,
    providerWeek: overrides.week ?? 1,
    participantsInvolved: [overrides.rosterId ?? 1],
    payload: {
      actualStarterIds: overrides.actualStarterIds ?? ['acquired-1'],
      fullRoster: overrides.fullRoster ?? [
        { providerAssetId: 'acquired-1', name: 'Acquired Player', pos: ['RB'], actualPoints: 20 },
      ],
      slotPositions: ['RB'],
    },
  }
}

function makeLineupBacktest(overrides: Partial<{
  replayId: string
  efficiencyPct: number
  missedOptimalStarters: Array<{ providerAssetId: string; name: string; actualPoints: number }>
  subOptimalActualStarters: Array<{ providerAssetId: string; name: string; actualPoints: number }>
}> = {}) {
  return {
    replayId: overrides.replayId ?? 'lineup-1',
    backtestedOutput: {
      actualPoints: 20,
      optimalPoints: 20,
      pointsLeftOnBench: 0,
      efficiencyPct: overrides.efficiencyPct ?? 1,
      benchValueLeft: 0,
      pointsFromSuboptimalStarters: 0,
      startSitMistakeCount: 0,
      missedOptimalStarters: overrides.missedOptimalStarters ?? [],
      subOptimalActualStarters: overrides.subOptimalActualStarters ?? [],
    },
  }
}

/** Routes findMany calls to the right fixture set based on decisionType, mirroring how the real Prisma queries are shaped. */
function wireMocks(fixtures: {
  tradeReplays?: unknown[]
  tradeBacktests?: unknown[]
  lineupReplays?: unknown[]
  lineupBacktests?: unknown[]
}) {
  mockReplayImportFindMany.mockImplementation(async (args: any) => {
    if (args.where.decisionType === 'trade') return fixtures.tradeReplays ?? []
    return fixtures.lineupReplays ?? []
  })
  mockBacktestResultFindMany.mockImplementation(async (args: any) => {
    if (args.where.decisionType === 'trade') return fixtures.tradeBacktests ?? []
    return fixtures.lineupBacktests ?? []
  })
}

describe('computeDecisionReplayCorrelation', () => {
  afterEach(() => vi.clearAllMocks())

  it('is read-only — never calls any write method on either table', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay()],
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [makeLineupReplay()],
      lineupBacktests: [makeLineupBacktest()],
    })

    await computeDecisionReplayCorrelation([LEAGUE])

    expect(mockReplayImportWrite).not.toHaveBeenCalled()
    expect(mockBacktestResultWrite).not.toHaveBeenCalled()
  })

  it('joins an acquired player across post-trade real lineup weeks by providerAssetId, tracking starts and real points', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay({ givenValue: 500 })],
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [
        makeLineupReplay({ id: 'l1', week: 2, actualStarterIds: ['acquired-1'] }),
        makeLineupReplay({ id: 'l2', week: 3, actualStarterIds: [] }), // benched this week
      ],
      lineupBacktests: [
        makeLineupBacktest({ replayId: 'l1', efficiencyPct: 1 }),
        makeLineupBacktest({ replayId: 'l2', efficiencyPct: 0.5, missedOptimalStarters: [{ providerAssetId: 'acquired-1', name: 'Acquired Player', actualPoints: 20 }] }),
      ],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])

    expect(result.totalTradesConsidered).toBe(1)
    expect(result.totalTradesWithLineupData).toBe(1)
    const impact = result.perTradeImpacts[0]
    expect(impact.lineupAppearances).toBe(2)
    expect(impact.starterAppearances).toBe(1)
    expect(impact.totalPointsContributed).toBe(40) // 20 + 20
    expect(impact.totalPointsWhileStarted).toBe(20) // only week 2
    expect(impact.optimalAppearances).toBe(2) // started+optimal week 2, missed-optimal week 3
    expect(impact.wastedOptimalAppearances).toBe(1) // week 3 bench mistake
    expect(impact.starterConversionRate).toBeCloseTo(0.5, 5)
    expect(impact.benchConversionRate).toBeCloseTo(0.5, 5) // 1 wasted / 2 optimal
    expect(impact.tradeROI).toBeCloseTo(20 / 500, 5)
  })

  it('excludes lineup weeks before the approximate trade week -- only counts real post-trade history', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay({ resolvedAt: new Date(Date.UTC(2025, 8, 1 + 5 * 7)) })], // approx week 5
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [
        makeLineupReplay({ id: 'l1', week: 3 }), // before the trade -- should be excluded
        makeLineupReplay({ id: 'l2', week: 6 }), // after -- should be included
      ],
      lineupBacktests: [makeLineupBacktest({ replayId: 'l1' }), makeLineupBacktest({ replayId: 'l2' })],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])

    expect(result.perTradeImpacts[0].lineupAppearances).toBe(1)
  })

  it('reports zero trades with lineup data (not an error) when the acquired player never appears in the receiving roster\'s lineup history', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay()],
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [makeLineupReplay({ fullRoster: [{ providerAssetId: 'someone-else', name: 'Someone Else', pos: ['WR'], actualPoints: 10 }], actualStarterIds: ['someone-else'] })],
      lineupBacktests: [makeLineupBacktest()],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])

    expect(result.totalTradesConsidered).toBe(1)
    expect(result.totalTradesWithLineupData).toBe(0)
    expect(result.avgTradeROI).toBeNull()
  })

  it('groups trades by verdict and by a median confidence-score split', async () => {
    wireMocks({
      tradeReplays: [
        makeTradeReplay({ id: 't1', acquiredId: 'p1' }),
        makeTradeReplay({ id: 't2', acquiredId: 'p2' }),
      ],
      tradeBacktests: [
        makeTradeBacktest({ replayId: 't1', verdict: 'Strong Win', confidenceScore: 90 }),
        makeTradeBacktest({ replayId: 't2', verdict: 'Overpay Risk', confidenceScore: 30 }),
      ],
      lineupReplays: [
        makeLineupReplay({ id: 'l1', week: 2, actualStarterIds: ['p1'], fullRoster: [{ providerAssetId: 'p1', name: 'P1', pos: ['RB'], actualPoints: 15 }] }),
        makeLineupReplay({ id: 'l2', week: 2, actualStarterIds: ['p2'], fullRoster: [{ providerAssetId: 'p2', name: 'P2', pos: ['WR'], actualPoints: 5 }] }),
      ],
      lineupBacktests: [makeLineupBacktest({ replayId: 'l1' }), makeLineupBacktest({ replayId: 'l2' })],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])

    const verdicts = result.byVerdict.map((v) => v.verdict).sort()
    expect(verdicts).toEqual(['Overpay Risk', 'Strong Win'])
    expect(result.byConfidenceTier).toHaveLength(2)
    expect(result.byConfidenceTier.find((t) => t.tier === 'high')?.count).toBeGreaterThan(0)
  })

  it('handles zero real data safely — no NaN, no throw', async () => {
    wireMocks({ tradeReplays: [], tradeBacktests: [], lineupReplays: [], lineupBacktests: [] })

    const result = await computeDecisionReplayCorrelation([LEAGUE])

    expect(result.totalTradesConsidered).toBe(0)
    expect(result.avgTradeROI).toBeNull()
    expect(result.lineupImprovementScore.avgEfficiencyBeforeTrade).toBeNull()
  })
})

describe('Phase 16 — roster-churn classification', () => {
  afterEach(() => vi.clearAllMocks())

  it('classifies a draft pick acquisition as draft_pick, never counted toward churn rates', async () => {
    wireMocks({
      tradeReplays: [{
        id: 'trade-1', providerLeagueId: LEAGUE, season: SEASON,
        resolvedAt: new Date(Date.UTC(2025, 8, 1)),
        participantsInvolved: [1, 2],
        payload: {
          assetsGiven: [{ name: 'Given Player', value: 500, type: 'player', providerAssetId: 'given-1' }],
          assetsReceived: [{ name: '2026 Round 1 pick', value: 1000, type: 'pick', providerAssetId: 'pick-2026-r1-1' }],
        },
      }],
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [],
      lineupBacktests: [],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])
    const impact = result.perTradeImpacts[0]

    expect(impact.acquiredPlayers[0].status).toBe('draft_pick')
    expect(impact.draftPickCount).toBe(1)
    expect(impact.realAcquiredPlayerCount).toBe(0)
    expect(impact.zeroAppearanceRate).toBeNull() // no real players to compute a rate over
  })

  it('classifies a real player with zero appearances as insufficient_week_coverage when the roster has NO post-trade lineup data at all', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay({ resolvedAt: new Date(Date.UTC(2025, 8, 1 + 17 * 7)) })], // approx week 17 -- very late
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [], // no lineup data exists at all for this roster
      lineupBacktests: [],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])
    const impact = result.perTradeImpacts[0]

    expect(impact.acquiredPlayers[0].status).toBe('insufficient_week_coverage')
    expect(impact.insufficientCoverageCount).toBe(1)
    expect(impact.churnedAwayCount).toBe(0)
    expect(impact.zeroAppearanceRate).toBe(1)
  })

  it('classifies a real player with zero appearances as churned_away when the roster DOES have post-trade lineup data, just never including this player', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay()],
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [
        // real post-trade data exists for this roster, but never includes the acquired player -- real evidence of churn
        makeLineupReplay({ id: 'l1', week: 2, actualStarterIds: ['someone-else'], fullRoster: [{ providerAssetId: 'someone-else', name: 'Someone Else', pos: ['WR'], actualPoints: 8 }] }),
      ],
      lineupBacktests: [makeLineupBacktest({ replayId: 'l1' })],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])
    const impact = result.perTradeImpacts[0]

    expect(impact.acquiredPlayers[0].status).toBe('churned_away')
    expect(impact.churnedAwayCount).toBe(1)
    expect(impact.insufficientCoverageCount).toBe(0)
    expect(impact.zeroAppearanceRate).toBe(1)
  })

  it('classifies a player who appears on the roster but is never started as retained_but_unused', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay()],
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [
        makeLineupReplay({ id: 'l1', week: 2, actualStarterIds: [], fullRoster: [{ providerAssetId: 'acquired-1', name: 'Acquired Player', pos: ['RB'], actualPoints: 12 }] }),
      ],
      lineupBacktests: [makeLineupBacktest({ replayId: 'l1', missedOptimalStarters: [] })],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])
    const impact = result.perTradeImpacts[0]

    expect(impact.acquiredPlayers[0].status).toBe('retained_but_unused')
    expect(impact.retainedButUnusedCount).toBe(1)
    expect(impact.retainedButUnusedRate).toBe(1)
  })

  it('classifies a player who was started at least once as active', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay()],
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [makeLineupReplay({ id: 'l1', week: 2, actualStarterIds: ['acquired-1'] })],
      lineupBacktests: [makeLineupBacktest({ replayId: 'l1' })],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])
    const impact = result.perTradeImpacts[0]

    expect(impact.acquiredPlayers[0].status).toBe('active')
    expect(impact.activeCount).toBe(1)
  })
})

describe('Phase 16 — matched before/after window', () => {
  afterEach(() => vi.clearAllMocks())

  it('computes avg efficiency/pointsLeftOnBench in the real weeks immediately before vs. after the trade, not the full season', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay({ resolvedAt: new Date(Date.UTC(2025, 8, 1 + 10 * 7)) })], // approx week 10
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [
        // 3 weeks before (7,8,9) -- lower efficiency
        makeLineupReplay({ id: 'b1', week: 7 }),
        makeLineupReplay({ id: 'b2', week: 8 }),
        makeLineupReplay({ id: 'b3', week: 9 }),
        // far outside the matched window (week 1) -- must NOT be counted in "before"
        makeLineupReplay({ id: 'far', week: 1 }),
        // 3 weeks after (10,11,12) -- higher efficiency
        makeLineupReplay({ id: 'a1', week: 10 }),
        makeLineupReplay({ id: 'a2', week: 11 }),
        makeLineupReplay({ id: 'a3', week: 12 }),
      ],
      lineupBacktests: [
        makeLineupBacktest({ replayId: 'b1', efficiencyPct: 0.6 }),
        makeLineupBacktest({ replayId: 'b2', efficiencyPct: 0.6 }),
        makeLineupBacktest({ replayId: 'b3', efficiencyPct: 0.6 }),
        makeLineupBacktest({ replayId: 'far', efficiencyPct: 0.1 }), // would badly skew "before" if wrongly included
        makeLineupBacktest({ replayId: 'a1', efficiencyPct: 0.9 }),
        makeLineupBacktest({ replayId: 'a2', efficiencyPct: 0.9 }),
        makeLineupBacktest({ replayId: 'a3', efficiencyPct: 0.9 }),
      ],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])
    const window = result.perTradeImpacts[0].matchedWindow!

    expect(window.weeksAvailableBefore).toBe(3)
    expect(window.weeksAvailableAfter).toBe(3)
    expect(window.avgEfficiencyBefore).toBeCloseTo(0.6, 5)
    expect(window.avgEfficiencyAfter).toBeCloseTo(0.9, 5)
    expect(window.deltaEfficiency).toBeCloseTo(0.3, 5)
  })

  it('reports null deltas (not a misleading number) when one side of the window has no real data', async () => {
    wireMocks({
      tradeReplays: [makeTradeReplay({ resolvedAt: new Date(Date.UTC(2025, 8, 1)) })], // approx week 1 -- nothing real exists before it
      tradeBacktests: [makeTradeBacktest()],
      lineupReplays: [makeLineupReplay({ id: 'a1', week: 1 })],
      lineupBacktests: [makeLineupBacktest({ replayId: 'a1', efficiencyPct: 0.8 })],
    })

    const result = await computeDecisionReplayCorrelation([LEAGUE])
    const window = result.perTradeImpacts[0].matchedWindow!

    expect(window.weeksAvailableBefore).toBe(0)
    expect(window.avgEfficiencyBefore).toBeNull()
    expect(window.deltaEfficiency).toBeNull()
  })
})
