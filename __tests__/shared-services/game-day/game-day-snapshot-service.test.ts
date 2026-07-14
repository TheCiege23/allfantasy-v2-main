/**
 * Integration test for GameDaySnapshotService.ts — mocks the true external
 * boundaries (prisma, buildLeagueGameDayContext, computeUserPlayerExposure,
 * computeLineupAttention, computeGameWindows, analyzeGameDayDivergence,
 * getManagerBehaviorProfile), same pattern as Trade/Waiver/Draft OS's
 * shadow-service integration tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockUserProfileFindUnique,
  mockRosterFindMany,
  mockBuildLeagueGameDayContext,
  mockComputeUserPlayerExposure,
  mockComputeLineupAttention,
  mockComputeGameWindows,
  mockAnalyzeGameDayDivergence,
  mockGetManagerBehaviorProfile,
} = vi.hoisted(() => ({
  mockUserProfileFindUnique: vi.fn(),
  mockRosterFindMany: vi.fn(),
  mockBuildLeagueGameDayContext: vi.fn(),
  mockComputeUserPlayerExposure: vi.fn(),
  mockComputeLineupAttention: vi.fn(),
  mockComputeGameWindows: vi.fn(),
  mockAnalyzeGameDayDivergence: vi.fn(),
  mockGetManagerBehaviorProfile: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { userProfile: { findUnique: mockUserProfileFindUnique }, roster: { findMany: mockRosterFindMany } },
}))
vi.mock('@/lib/shared-services/game-day/GameDayContextAssembler', () => ({ buildLeagueGameDayContext: mockBuildLeagueGameDayContext }))
vi.mock('@/lib/shared-services/game-day/UserPlayerExposureService', () => ({ computeUserPlayerExposure: mockComputeUserPlayerExposure }))
vi.mock('@/lib/shared-services/game-day/LineupAttentionService', () => ({ computeLineupAttention: mockComputeLineupAttention }))
vi.mock('@/lib/shared-services/game-day/GameWindowService', () => ({ computeGameWindows: mockComputeGameWindows }))
vi.mock('@/lib/shared-services/game-day/GameDayDivergenceAnalyzer', () => ({ analyzeGameDayDivergence: mockAnalyzeGameDayDivergence }))
vi.mock('@/lib/shared-services/knowledge-graph/QueryService', () => ({ getManagerBehaviorProfile: mockGetManagerBehaviorProfile }))

import { buildGameDaySnapshot } from '@/lib/shared-services/game-day/GameDaySnapshotService'
import { InMemoryGameDaySnapshotStore } from '@/lib/shared-services/game-day/GameDaySnapshotStore'

function makeLeagueContext(overrides: Record<string, unknown> = {}) {
  return {
    leagueId: 'league-1',
    season: 2026,
    week: 5,
    sport: 'NFL',
    platform: 'sleeper',
    weekResolution: { source: 'redraftSeason', isPlayoffWeek: false, playoffStartWeek: null },
    matchup: {
      leagueId: 'league-1',
      season: 2026,
      week: 5,
      sport: 'NFL',
      matchupStatus: 'upcoming',
      conceptOverlay: null,
      left: { rosterId: 'roster-1', teamName: 'My Team', avatarUrl: null, record: { wins: 3, losses: 2, ties: 0 }, winPct: 0.6, totalPoints: 0, projectedTotal: 0, starters: [{ playerId: 'p1', name: 'Player One', position: 'RB', team: 'KC', opponent: null, headshotUrl: null, currentPoints: 0, projectedPoints: 10, injuryStatus: 'Questionable', newsBlurb: null, weatherSummary: null, gameStatus: 'upcoming', gameLabel: 'Scheduled', aiInsight: null }], remainingStarters: 1 },
      right: { rosterId: 'roster-2', teamName: 'Opp', avatarUrl: null, record: { wins: 2, losses: 3, ties: 0 }, winPct: 0.4, totalPoints: 0, projectedTotal: 0, starters: [], remainingStarters: 0 },
      winProbabilityLeft: 0.5,
      insights: { matchupEdge: '', startSit: '', weather: '', injuryNews: '', swingPlayers: [], riskLevel: 'low', floorVsCeiling: '' },
      partialData: false,
      refreshIntervalMs: 30000,
    },
    matchupState: { state: 'upcoming', attribution: { source: 'matchup-center-service', fetchedAt: '2026-01-01T00:00:00.000Z', providerTimestamp: null, freshness: 'fresh', confidence: 90, missingDataReason: null } },
    unavailableReason: null,
    ...overrides,
  }
}

describe('buildGameDaySnapshot', () => {
  let resultStore: InMemoryGameDaySnapshotStore

  beforeEach(() => {
    vi.clearAllMocks()
    resultStore = new InMemoryGameDaySnapshotStore()
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: null })
    mockRosterFindMany.mockResolvedValue([{ leagueId: 'league-1', platformUserId: 'user-1' }])
    mockBuildLeagueGameDayContext.mockResolvedValue(makeLeagueContext())
    mockComputeUserPlayerExposure.mockResolvedValue({
      exposures: [{ playerId: 'p1', playerName: 'Player One', position: 'RB', leagueCount: 1, rosterCount: 1, startingCount: 1, benchCount: 0, irTaxiCount: 0, exposurePercent: 1, leaguesRequiringAttention: [], injuryStatus: null, gameWindow: null }],
      connectedLeagueCount: 1,
    })
    mockComputeLineupAttention.mockResolvedValue({ items: [], legacyActions: [] })
    mockComputeGameWindows.mockResolvedValue([])
    mockAnalyzeGameDayDivergence.mockReturnValue([])
    mockGetManagerBehaviorProfile.mockResolvedValue({ status: 'gated', reason: 'insufficient cohort' })
  })

  it('assembles a real snapshot across the user\'s connected leagues (resolved via linked platformUserIds)', async () => {
    const snapshot = await buildGameDaySnapshot({ userId: 'user-1', resultStore })

    expect(mockRosterFindMany).toHaveBeenCalledWith({ where: { platformUserId: { in: ['user-1'] } }, select: { leagueId: true, platformUserId: true } })
    expect(mockBuildLeagueGameDayContext).toHaveBeenCalledWith({ leagueId: 'league-1', viewerUserId: 'user-1' })
    expect(snapshot.userId).toBe('user-1')
    expect(snapshot.includedLeagueIds).toEqual(['league-1'])
    expect(snapshot.leagues).toHaveLength(1)

    const logged = await resultStore.all()
    expect(logged).toHaveLength(1)
    expect(logged[0].snapshotId).toBe(snapshot.snapshotId)
  })

  it('enriches exposures with real injury status pulled from the assembled league context', async () => {
    const snapshot = await buildGameDaySnapshot({ userId: 'user-1', resultStore })
    expect(snapshot.exposures[0].injuryStatus).toBe('Questionable')
  })

  it('resolves duplicate-provider identity across native and Sleeper roster rows', async () => {
    mockUserProfileFindUnique.mockResolvedValue({ sleeperUserId: 'sleeper-abc' })
    mockRosterFindMany.mockResolvedValue([
      { leagueId: 'league-1', platformUserId: 'user-1' },
      { leagueId: 'league-2', platformUserId: 'sleeper-abc' },
    ])
    mockBuildLeagueGameDayContext.mockImplementation(({ leagueId }: { leagueId: string }) => Promise.resolve(makeLeagueContext({ leagueId })))

    const snapshot = await buildGameDaySnapshot({ userId: 'user-1', resultStore })

    expect(mockRosterFindMany).toHaveBeenCalledWith({ where: { platformUserId: { in: ['user-1', 'sleeper-abc'] } }, select: { leagueId: true, platformUserId: true } })
    expect(mockBuildLeagueGameDayContext).toHaveBeenCalledWith({ leagueId: 'league-1', viewerUserId: 'user-1' })
    expect(mockBuildLeagueGameDayContext).toHaveBeenCalledWith({ leagueId: 'league-2', viewerUserId: 'sleeper-abc' })
    expect(snapshot.includedLeagueIds.sort()).toEqual(['league-1', 'league-2'])
  })

  it('handles a user with no connected leagues cleanly', async () => {
    mockRosterFindMany.mockResolvedValue([])
    const snapshot = await buildGameDaySnapshot({ userId: 'user-1', resultStore })
    expect(snapshot.includedLeagueIds).toEqual([])
    expect(snapshot.leagues).toEqual([])
    expect(mockBuildLeagueGameDayContext).not.toHaveBeenCalled()
  })

  it('reports dataQuality counts honestly (unavailable + stale leagues)', async () => {
    mockBuildLeagueGameDayContext.mockResolvedValue(makeLeagueContext({ matchup: null, unavailableReason: 'League not found.', matchupState: { state: 'unavailable', attribution: { source: 'x', fetchedAt: '2026-01-01T00:00:00.000Z', providerTimestamp: null, freshness: 'unknown', confidence: 0, missingDataReason: 'League not found.' } } }))

    const snapshot = await buildGameDaySnapshot({ userId: 'user-1', resultStore })
    expect(snapshot.dataQuality.unavailableLeagueCount).toBe(1)
  })

  it('never lets a Knowledge Graph failure crash the whole snapshot — reports "unavailable" instead', async () => {
    mockGetManagerBehaviorProfile.mockRejectedValue(new Error('KG store unreachable'))
    const snapshot = await buildGameDaySnapshot({ userId: 'user-1', resultStore })
    expect(snapshot.managerTendency.status).toBe('unavailable')
    expect(snapshot.managerTendency.reason).toContain('KG store unreachable')
    expect(snapshot.leagues).toHaveLength(1) // rest of the snapshot unaffected
  })

  it('reflects a gated manager tendency honestly, never fabricating data', async () => {
    const snapshot = await buildGameDaySnapshot({ userId: 'user-1', resultStore })
    expect(snapshot.managerTendency.status).toBe('gated')
    expect(snapshot.managerTendency.profile).toBeNull()
  })
})
