/**
 * Decision OS Replay Framework — ingestion orchestrator coverage. Proves
 * the manually-invokable pipeline wires reader -> normalizer -> writer ->
 * backtest executor -> writer correctly, without making any real Sleeper
 * API call or real database write (everything mocked).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const {
  mockGetLeagueInfo,
  mockGetLeagueRosters,
  mockGetLeagueUsers,
  mockGetAllPlayers,
  mockGetAllLeagueTrades,
  mockFetchFantasyCalcValues,
  mockUpsertReplayImport,
  mockUpsertBacktestResult,
  mockRunTradeBacktest,
} = vi.hoisted(() => ({
  mockGetLeagueInfo: vi.fn(),
  mockGetLeagueRosters: vi.fn(),
  mockGetLeagueUsers: vi.fn(),
  mockGetAllPlayers: vi.fn(),
  mockGetAllLeagueTrades: vi.fn(),
  mockFetchFantasyCalcValues: vi.fn(),
  mockUpsertReplayImport: vi.fn(),
  mockUpsertBacktestResult: vi.fn(),
  mockRunTradeBacktest: vi.fn(),
}))

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueInfo: mockGetLeagueInfo,
  getLeagueRosters: mockGetLeagueRosters,
  getLeagueUsers: mockGetLeagueUsers,
  getAllPlayers: mockGetAllPlayers,
  getAllLeagueTrades: mockGetAllLeagueTrades,
  getPlayerName: (players: any, id: string) => players?.[id]?.full_name ?? id,
}))

vi.mock('@/lib/fantasycalc', () => ({
  fetchFantasyCalcValues: mockFetchFantasyCalcValues,
  findPlayerBySleeperId: () => null,
  getPickValue: () => 100,
}))

vi.mock('@/lib/replay-framework/writer', () => ({
  upsertReplayImport: mockUpsertReplayImport,
  upsertBacktestResult: mockUpsertBacktestResult,
}))

vi.mock('@/lib/replay-framework/backtest/tradeBacktestExecutor', () => ({
  runTradeBacktest: mockRunTradeBacktest,
}))

import { ingestSleeperTradesForLeague } from '@/lib/replay-framework/ingest/ingestSleeperTradesForLeague'

const LEAGUE = {
  league_id: 'league-1',
  name: 'Test League',
  season: '2025',
  sport: 'nfl',
  status: 'in_season',
  total_rosters: 12,
  scoring_settings: {},
  roster_positions: ['QB', 'RB', 'WR'],
  settings: { type: 2 },
  draft_id: 'draft-1',
  previous_league_id: null,
}

const TRADE = {
  type: 'trade' as const,
  transaction_id: 'tx-1',
  status: 'complete',
  roster_ids: [1, 2],
  adds: { '1001': 1 },
  drops: { '1001': 2 },
  draft_picks: [],
  waiver_budget: [],
  leg: 1,
  created: 1735689600000,
  creator: 'user-a',
  consenter_ids: [1, 2],
  status_updated: 1735693200000,
}

function resetMocks() {
  vi.clearAllMocks()
  mockGetLeagueInfo.mockResolvedValue(LEAGUE)
  mockGetLeagueRosters.mockResolvedValue([
    { roster_id: 1, owner_id: 'user-a', players: [], starters: [], reserve: [], taxi: [], settings: {} },
    { roster_id: 2, owner_id: 'user-b', players: [], starters: [], reserve: [], taxi: [], settings: {} },
  ])
  mockGetLeagueUsers.mockResolvedValue([
    { user_id: 'user-a', username: 'alice', display_name: 'Alice', avatar: null },
    { user_id: 'user-b', username: 'bob', display_name: 'Bob', avatar: null },
  ])
  mockGetAllPlayers.mockResolvedValue({})
  mockFetchFantasyCalcValues.mockResolvedValue([])
  mockUpsertReplayImport.mockResolvedValue('replay-1')
  mockRunTradeBacktest.mockResolvedValue({
    replayId: 'replay-1',
    decisionType: 'trade',
    modelVersion: 'trade-engine-deterministic-v1',
    engineVersionHash: 'dev',
    deterministicConfigVersion: 'b0:-1.1000',
    backtestedOutput: { acceptProb: 0.5 },
    realOutcome: { outcome: 'ACCEPTED', providerStatus: 'complete' },
  })
  mockUpsertBacktestResult.mockResolvedValue('backtest-1')
}

describe('ingestSleeperTradesForLeague', () => {
  afterEach(() => vi.clearAllMocks())

  it('wires reader -> normalizer -> writer -> backtest -> writer for each real trade found', async () => {
    resetMocks()
    mockGetAllLeagueTrades.mockResolvedValue([TRADE])

    const result = await ingestSleeperTradesForLeague('league-1', 'ingest-user-1')

    expect(result.tradesFound).toBe(1)
    expect(result.replaysWritten).toBe(1)
    expect(result.backtestsWritten).toBe(1)
    expect(result.errors).toEqual([])
    expect(mockUpsertReplayImport).toHaveBeenCalledTimes(1)
    expect(mockRunTradeBacktest).toHaveBeenCalledTimes(1)
    expect(mockUpsertBacktestResult).toHaveBeenCalledTimes(1)
  })

  it('Phase 6: passes the league\'s real roster_positions through to the backtest executor', async () => {
    resetMocks()
    mockGetAllLeagueTrades.mockResolvedValue([TRADE])

    await ingestSleeperTradesForLeague('league-1', 'ingest-user-1')

    const backtestCallArg = mockRunTradeBacktest.mock.calls[0][0]
    expect(backtestCallArg.rosterPositions).toEqual(LEAGUE.roster_positions)
  })

  it('returns zero counts and an error when the league cannot be found — no partial writes', async () => {
    resetMocks()
    mockGetLeagueInfo.mockResolvedValue(null)

    const result = await ingestSleeperTradesForLeague('missing-league', 'ingest-user-1')

    expect(result.tradesFound).toBe(0)
    expect(result.replaysWritten).toBe(0)
    expect(mockUpsertReplayImport).not.toHaveBeenCalled()
  })

  it('isolates a per-transaction failure — one bad trade does not abort the rest of the batch', async () => {
    resetMocks()
    mockGetAllLeagueTrades.mockResolvedValue([TRADE, { ...TRADE, transaction_id: 'tx-2' }])
    mockUpsertReplayImport.mockResolvedValueOnce('replay-1').mockRejectedValueOnce(new Error('write failed'))

    const result = await ingestSleeperTradesForLeague('league-1', 'ingest-user-1')

    expect(result.tradesFound).toBe(2)
    expect(result.replaysWritten).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].transactionId).toBe('tx-2')
  })

  it('never invokes Sleeper reads beyond what getAllLeagueTrades/getLeagueRosters/getLeagueUsers/getAllPlayers already provide (no scheduler, no polling loop)', async () => {
    resetMocks()
    mockGetAllLeagueTrades.mockResolvedValue([TRADE])

    await ingestSleeperTradesForLeague('league-1', 'ingest-user-1')

    expect(mockGetLeagueInfo).toHaveBeenCalledTimes(1)
    expect(mockGetAllLeagueTrades).toHaveBeenCalledTimes(1)
  })
})
