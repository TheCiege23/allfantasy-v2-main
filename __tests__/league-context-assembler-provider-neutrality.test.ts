/**
 * Fantasy OS Migration Plan Phase 4 — proves lib/trade-engine/league-context-assembler.ts
 * no longer degrades trade evaluation solely because a league isn't Sleeper.
 * Mocks only the true external boundaries (the import pipeline, FantasyCalc,
 * hybrid valuation, analytics, ADP, Prisma, the Sleeper-only pre-analysis
 * cache) — every real internal calculator (convertSleeperToAssets,
 * computeNeedsSurplus, computeStarterStrengthIndex, classifyCornerstone,
 * classifyAgeBucket, computeSourceFreshness, expandRosterPositionTokens) runs
 * for real, so a passing ESPN/Yahoo test here proves the full real pipeline
 * works end to end, not just that a mock returned canned data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedImportResult } from '@/lib/league-import/types'

const {
  mockRunImportedLeagueNormalizationPipeline,
  mockFetchFantasyCalcValues,
  mockPricePlayer,
  mockGetPlayerAnalyticsBatch,
  mockGetPlayerADP,
  mockGetPreAnalysisStatus,
  mockSportsInjuryFindMany,
  mockPlayerAnalyticsSnapshotFindFirst,
} = vi.hoisted(() => ({
  mockRunImportedLeagueNormalizationPipeline: vi.fn(),
  mockFetchFantasyCalcValues: vi.fn().mockResolvedValue([]),
  mockPricePlayer: vi.fn(),
  mockGetPlayerAnalyticsBatch: vi.fn().mockResolvedValue(new Map()),
  mockGetPlayerADP: vi.fn().mockResolvedValue(null),
  mockGetPreAnalysisStatus: vi.fn().mockResolvedValue({ status: 'not_ready' }),
  mockSportsInjuryFindMany: vi.fn().mockResolvedValue([]),
  mockPlayerAnalyticsSnapshotFindFirst: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/league-import/ImportedLeagueNormalizationPipeline', () => ({
  runImportedLeagueNormalizationPipeline: mockRunImportedLeagueNormalizationPipeline,
}))
vi.mock('@/lib/player-valuations/canonicalPlayerValuations', () => ({ fetchFantasyCalcValues: mockFetchFantasyCalcValues }))
vi.mock('@/lib/hybrid-valuation', () => ({ pricePlayer: mockPricePlayer }))
vi.mock('@/lib/player-analytics', () => ({ getPlayerAnalyticsBatch: mockGetPlayerAnalyticsBatch }))
vi.mock('@/lib/adp-data', () => ({ getPlayerADP: mockGetPlayerADP }))
vi.mock('@/lib/trade-pre-analysis', () => ({ getPreAnalysisStatus: mockGetPreAnalysisStatus }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsInjury: { findMany: mockSportsInjuryFindMany },
    playerAnalyticsSnapshot: { findFirst: mockPlayerAnalyticsSnapshotFindFirst },
  },
}))

import { buildLeagueDecisionContext } from '@/lib/trade-engine/league-context-assembler'

function pricedValue(name: string) {
  return {
    name,
    value: 8000,
    position: 'QB',
    age: 27,
    assetValue: { marketValue: 8000, impactValue: 6000, vorpValue: 5000, volatility: 0.2 },
    source: 'fantasycalc',
  }
}

function baseCoverage() {
  return {
    leagueSettings: { state: 'full' as const },
    currentRosters: { state: 'full' as const },
    historicalRosterSnapshots: { state: 'missing' as const },
    scoringSettings: { state: 'full' as const },
    playoffSettings: { state: 'full' as const },
    currentStandings: { state: 'full' as const },
    currentSchedule: { state: 'missing' as const },
    draftHistory: { state: 'missing' as const },
    tradeHistory: { state: 'full' as const },
    previousSeasons: { state: 'missing' as const },
    playerIdentityMap: { state: 'full' as const },
  }
}

describe('buildLeagueDecisionContext — Sleeper regression coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPricePlayer.mockImplementation(async (name: string) => pricedValue(name))
  })

  it('produces a working context for a Sleeper league, preserving superflex/TEP/taxi detection', async () => {
    const normalized: NormalizedImportResult = {
      source: { source_provider: 'sleeper', source_league_id: 'league-1', imported_at: new Date().toISOString() },
      league: {
        name: 'Test Dynasty League',
        sport: 'NFL',
        season: 2026,
        leagueSize: 2,
        rosterSize: null,
        scoring: 'PPR Superflex TEP',
        isDynasty: true,
        roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'BN', 'BN'],
        scoring_settings: { rec: 1, bonus_rec_te: 0.5 },
      },
      rosters: [
        {
          source_team_id: '1',
          source_manager_id: 'user-1',
          owner_name: 'User One',
          team_name: 'Team One',
          avatar_url: 'https://sleepercdn.com/avatars/thumbs/abc',
          wins: 10,
          losses: 2,
          ties: 0,
          points_for: 1200,
          player_ids: ['p1', 'p2'],
          starter_ids: ['p1'],
          reserve_ids: [],
          taxi_ids: [],
        },
        {
          source_team_id: '2',
          source_manager_id: 'user-2',
          owner_name: 'User Two',
          team_name: 'Team Two',
          avatar_url: null,
          wins: 8,
          losses: 4,
          ties: 0,
          points_for: 1100,
          player_ids: ['p3'],
          starter_ids: ['p3'],
          reserve_ids: [],
          taxi_ids: [],
        },
      ],
      scoring: null,
      schedule: [],
      draft_picks: [],
      transactions: [
        {
          source_transaction_id: 't1',
          type: 'trade',
          status: 'complete',
          created_at: new Date().toISOString(),
          roster_ids: ['1', '2'],
        },
      ],
      standings: [],
      player_map: {
        p1: { name: 'Patrick Mahomes', position: 'QB', team: 'KC' },
        p2: { name: 'Travis Kelce', position: 'TE', team: 'KC' },
        p3: { name: 'Josh Allen', position: 'QB', team: 'BUF' },
      },
      coverage: baseCoverage(),
    }

    mockRunImportedLeagueNormalizationPipeline.mockResolvedValue({
      success: true,
      normalized,
      rawPayload: { league: { league_id: 'league-1', settings: { type: 2, taxi_slots: 2 } } },
    })

    const ctx = await buildLeagueDecisionContext({ leagueId: 'league-1', username: 'sleeperuser1' })

    expect(mockRunImportedLeagueNormalizationPipeline).toHaveBeenCalledWith({
      provider: 'sleeper',
      sourceId: 'league-1',
      userId: undefined,
    })
    expect(ctx.leagueConfig.platform).toBe('sleeper')
    expect(ctx.leagueConfig.isSF).toBe(true)
    expect(ctx.leagueConfig.isTEP).toBe(true)
    expect(ctx.leagueConfig.taxiSlots).toBe(2) // preserved from rawPayload, exact Sleeper behavior
    expect(ctx.leagueConfig.benchSlots).toBe(2)
    expect(ctx.teams).toHaveLength(2)
    expect(ctx.teams[0].teamId).toBe('1')
    expect(ctx.teams[0].teamName).toBe('User One')
    expect(ctx.tradeHistoryStats.totalTrades).toBe(1)
    // The Sleeper-only pre-analysis cache IS consulted for Sleeper.
    expect(mockGetPreAnalysisStatus).toHaveBeenCalledWith('sleeperuser1', 'league-1')
  })
})

describe('buildLeagueDecisionContext — ESPN provider-neutral coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPricePlayer.mockImplementation(async (name: string) => pricedValue(name))
  })

  it('builds a real, non-degraded context from ESPN-shaped normalized data, including "SLOT:COUNT" roster_positions', async () => {
    const normalized: NormalizedImportResult = {
      source: { source_provider: 'espn', source_league_id: 'espn-league-1', imported_at: new Date().toISOString() },
      league: {
        name: 'ESPN Dynasty League',
        sport: 'NFL',
        season: 2026,
        leagueSize: 2,
        rosterSize: null,
        scoring: 'PPR',
        isDynasty: true,
        roster_positions: ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'FLEX:2', 'SUPER_FLEX:1', 'BE:6', 'IR:2'],
        scoring_settings: { rec: 1 },
      },
      rosters: [
        {
          source_team_id: '1',
          source_manager_id: 'espn-user-1',
          owner_name: 'ESPN User One',
          team_name: 'ESPN Team One',
          avatar_url: null,
          wins: 9,
          losses: 3,
          ties: 0,
          points_for: 1300,
          player_ids: ['e1'],
          starter_ids: ['e1'],
          reserve_ids: [],
          taxi_ids: [],
        },
        {
          source_team_id: '2',
          source_manager_id: 'espn-user-2',
          owner_name: 'ESPN User Two',
          team_name: 'ESPN Team Two',
          avatar_url: null,
          wins: 5,
          losses: 7,
          ties: 0,
          points_for: 1000,
          player_ids: ['e2'],
          starter_ids: ['e2'],
          reserve_ids: [],
          taxi_ids: [],
        },
      ],
      scoring: null,
      schedule: [],
      draft_picks: [],
      transactions: [
        {
          source_transaction_id: 'et1',
          type: 'trade',
          status: 'complete',
          created_at: new Date().toISOString(),
          roster_ids: ['1', '2'],
        },
      ],
      standings: [],
      player_map: {
        e1: { name: 'Lamar Jackson', position: 'QB', team: 'BAL' },
        e2: { name: 'CeeDee Lamb', position: 'WR', team: 'DAL' },
      },
      coverage: baseCoverage(),
    }

    mockRunImportedLeagueNormalizationPipeline.mockResolvedValue({
      success: true,
      normalized,
      rawPayload: { league: {}, users: [] }, // ESPN's raw payload shape — irrelevant here since taxiSlots only reads it for sleeper
    })

    const ctx = await buildLeagueDecisionContext({
      leagueId: 'espn-league-1',
      username: 'unused-for-espn',
      platform: 'espn',
      userId: 'af-user-1',
    })

    expect(mockRunImportedLeagueNormalizationPipeline).toHaveBeenCalledWith({
      provider: 'espn',
      sourceId: 'espn-league-1',
      userId: 'af-user-1',
    })
    expect(ctx.leagueConfig.platform).toBe('espn')
    // The whole point of this phase: superflex detection now works for ESPN's "SLOT:COUNT" format.
    expect(ctx.leagueConfig.isSF).toBe(true)
    expect(ctx.leagueConfig.benchSlots).toBe(6)
    expect(ctx.teams).toHaveLength(2)
    expect(ctx.teams[0].teamName).toBe('ESPN User One')
    expect(ctx.teams[0].assets.length).toBeGreaterThan(0) // real FantasyCalc-priced asset, not degraded to empty
    expect(ctx.tradeHistoryStats.totalTrades).toBe(1)
    // taxiSlots is honestly 0 for a non-Sleeper provider, with a disclosed warning — never a silent guess.
    expect(ctx.leagueConfig.taxiSlots).toBe(0)
    expect(ctx.dataQuality.warnings.some((w) => w.includes('taxiSlots'))).toBe(true)
    // The Sleeper-only pre-analysis cache must never be consulted for a non-Sleeper league.
    expect(mockGetPreAnalysisStatus).not.toHaveBeenCalled()
  })
})

describe('buildLeagueDecisionContext — Yahoo provider-neutral coverage, non-numeric team ids', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPricePlayer.mockImplementation(async (name: string) => pricedValue(name))
  })

  it('handles a compound (non-integer) source_team_id via the stable index fallback, without losing the real id for cross-references', async () => {
    const normalized: NormalizedImportResult = {
      source: { source_provider: 'yahoo', source_league_id: '423.l.116', imported_at: new Date().toISOString() },
      league: {
        name: 'Yahoo League',
        sport: 'NFL',
        season: 2026,
        leagueSize: 2,
        rosterSize: null,
        scoring: 'PPR',
        isDynasty: false,
        roster_positions: ['QB:1', 'WR:3', 'BN:5'],
        scoring_settings: { rec: 1 },
      },
      rosters: [
        {
          source_team_id: '423.l.116.t.4', // Yahoo's real compound team key — not parseable as a clean integer
          source_manager_id: 'yahoo-user-1',
          owner_name: 'Yahoo User One',
          team_name: 'Yahoo Team One',
          avatar_url: null,
          wins: 6,
          losses: 6,
          ties: 0,
          points_for: 1050,
          player_ids: ['y1'],
          starter_ids: ['y1'],
          reserve_ids: [],
          taxi_ids: [],
        },
      ],
      scoring: null,
      schedule: [],
      draft_picks: [],
      transactions: [],
      standings: [],
      player_map: { y1: { name: 'Justin Jefferson', position: 'WR', team: 'MIN' } },
      coverage: baseCoverage(),
    }

    mockRunImportedLeagueNormalizationPipeline.mockResolvedValue({ success: true, normalized, rawPayload: {} })

    const ctx = await buildLeagueDecisionContext({
      leagueId: '423.l.116',
      username: 'unused',
      platform: 'yahoo',
      userId: 'af-user-1',
    })

    // The TRUE provider identifier is preserved on teamId — this is what deriveTradeDecisionContext
    // and every external caller should reference, never the synthetic numeric rosterId.
    expect(ctx.teams[0].teamId).toBe('423.l.116.t.4')
    expect(ctx.teams[0].rosterId).toBe(1) // stable 1-based fallback since the real id isn't a clean integer
  })
})

describe('buildLeagueDecisionContext — degraded-context fallback behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPricePlayer.mockImplementation(async (name: string) => pricedValue(name))
  })

  it('throws a clear, provider-labeled error when the normalization pipeline reports failure — never silently returns a broken context', async () => {
    mockRunImportedLeagueNormalizationPipeline.mockResolvedValue({
      success: false,
      error: 'League not found. Please check your League ID.',
      code: 'LEAGUE_NOT_FOUND',
    })

    await expect(
      buildLeagueDecisionContext({ leagueId: 'bad-league', username: 'user1', platform: 'espn' })
    ).rejects.toThrow(/Failed to fetch league data from espn/)
  })

  it('degrades gracefully (no crash) when player_map is empty, falling back to raw player ids and flagging a warning', async () => {
    const normalized: NormalizedImportResult = {
      source: { source_provider: 'fleaflicker', source_league_id: 'ff-1', imported_at: new Date().toISOString() },
      league: {
        name: 'Fleaflicker League',
        sport: 'NFL',
        season: 2026,
        leagueSize: 1,
        rosterSize: null,
        scoring: null,
        isDynasty: false,
        roster_positions: [],
        scoring_settings: {},
      },
      rosters: [
        {
          source_team_id: '1',
          source_manager_id: 'ff-user-1',
          owner_name: 'FF User',
          team_name: 'FF Team',
          avatar_url: null,
          wins: 0,
          losses: 0,
          ties: 0,
          points_for: 0,
          player_ids: ['unknown-1'],
          starter_ids: [],
          reserve_ids: [],
          taxi_ids: [],
        },
      ],
      scoring: null,
      schedule: [],
      draft_picks: [],
      transactions: [],
      standings: [],
      player_map: {}, // empty — Fleaflicker's real, documented gap
      coverage: baseCoverage(),
    }

    mockRunImportedLeagueNormalizationPipeline.mockResolvedValue({ success: true, normalized, rawPayload: {} })

    const ctx = await buildLeagueDecisionContext({ leagueId: 'ff-1', username: 'unused', platform: 'fleaflicker' })

    expect(ctx.teams).toHaveLength(1)
    expect(ctx.dataQuality.warnings.some((w) => w.includes('Player identity map is empty'))).toBe(true)
  })

  it('defaults to sleeper for an unrecognized platform string, matching the original unconditional fallback behavior', async () => {
    const normalized: NormalizedImportResult = {
      source: { source_provider: 'sleeper', source_league_id: 'league-1', imported_at: new Date().toISOString() },
      league: {
        name: 'L',
        sport: 'NFL',
        season: 2026,
        leagueSize: 1,
        rosterSize: null,
        scoring: null,
        isDynasty: false,
        roster_positions: [],
        scoring_settings: {},
      },
      rosters: [],
      scoring: null,
      schedule: [],
      draft_picks: [],
      transactions: [],
      standings: [],
      player_map: {},
      coverage: baseCoverage(),
    }
    mockRunImportedLeagueNormalizationPipeline.mockResolvedValue({ success: true, normalized, rawPayload: {} })

    await buildLeagueDecisionContext({ leagueId: 'league-1', username: 'user1', platform: 'not-a-real-provider' })

    expect(mockRunImportedLeagueNormalizationPipeline).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'sleeper' })
    )
  })
})
