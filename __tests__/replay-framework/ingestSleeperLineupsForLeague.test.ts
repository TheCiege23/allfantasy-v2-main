/**
 * Decision OS Replay Framework Phase 13 — lineup ingestion orchestrator
 * coverage. Proves the manually-invokable pipeline wires reader ->
 * normalizer -> writer -> backtest executor -> writer correctly, without
 * making any real Sleeper API call or real database write (everything
 * mocked), mirroring `ingestSleeperTradesForLeague.test.ts`'s exact
 * discipline.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const {
  mockGetLeagueInfo,
  mockGetLeagueRosters,
  mockGetLeagueUsers,
  mockGetAllPlayers,
  mockGetLeagueMatchups,
  mockUpsertReplayImport,
  mockUpsertBacktestResult,
  mockRunLineupBacktest,
} = vi.hoisted(() => ({
  mockGetLeagueInfo: vi.fn(),
  mockGetLeagueRosters: vi.fn(),
  mockGetLeagueUsers: vi.fn(),
  mockGetAllPlayers: vi.fn(),
  mockGetLeagueMatchups: vi.fn(),
  mockUpsertReplayImport: vi.fn(),
  mockUpsertBacktestResult: vi.fn(),
  mockRunLineupBacktest: vi.fn(),
}))

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueInfo: mockGetLeagueInfo,
  getLeagueRosters: mockGetLeagueRosters,
  getLeagueUsers: mockGetLeagueUsers,
  getAllPlayers: mockGetAllPlayers,
  getLeagueMatchups: mockGetLeagueMatchups,
  getPlayerName: (players: any, id: string) => players?.[id]?.full_name ?? id,
}))

vi.mock('@/lib/replay-framework/writer', () => ({
  upsertReplayImport: mockUpsertReplayImport,
  upsertBacktestResult: mockUpsertBacktestResult,
}))

vi.mock('@/lib/replay-framework/backtest/lineupBacktestExecutor', () => ({
  runLineupBacktest: mockRunLineupBacktest,
}))

import { ingestSleeperLineupsForLeague } from '@/lib/replay-framework/ingest/ingestSleeperLineupsForLeague'

const LEAGUE = {
  league_id: 'league-1',
  name: 'Test League',
  season: '2025',
  sport: 'nfl',
  status: 'in_season',
  total_rosters: 12,
  scoring_settings: {},
  roster_positions: ['QB', 'RB', 'WR'],
  settings: { type: 0 },
  draft_id: 'draft-1',
  previous_league_id: null,
}

const SCORED_MATCHUP = {
  matchup_id: 1,
  roster_id: 1,
  points: 30,
  starters: ['1001'],
  starters_points: [20],
  players: ['1001', '1002'],
  players_points: { '1001': 20, '1002': 10 },
}

const UNSCORED_MATCHUP = {
  matchup_id: 1,
  roster_id: 2,
  points: 0,
  starters: ['2001'],
  starters_points: [0],
  players: ['2001'],
  players_points: {},
}

function resetMocks() {
  vi.clearAllMocks()
  mockGetLeagueInfo.mockResolvedValue(LEAGUE)
  mockGetLeagueRosters.mockResolvedValue([
    { roster_id: 1, owner_id: 'user-a', players: [], starters: [], reserve: [], taxi: [], settings: {} },
  ])
  mockGetLeagueUsers.mockResolvedValue([{ user_id: 'user-a', username: 'alice', display_name: 'Alice', avatar: null }])
  mockGetAllPlayers.mockResolvedValue({})
  mockUpsertReplayImport.mockResolvedValue('replay-1')
  mockRunLineupBacktest.mockResolvedValue({
    replayId: 'replay-1',
    decisionType: 'lineup',
    modelVersion: 'lineup-optimizer-deterministic-v1',
    engineVersionHash: 'dev',
    deterministicConfigVersion: 'none',
    backtestedOutput: { actualPoints: 20, optimalPoints: 20, pointsLeftOnBench: 0, efficiencyPct: 1, benchValueLeft: 0, pointsFromSuboptimalStarters: 0, startSitMistakeCount: 0, missedOptimalStarters: [], subOptimalActualStarters: [] },
    realOutcome: null,
  })
  mockUpsertBacktestResult.mockResolvedValue('backtest-1')
}

describe('ingestSleeperLineupsForLeague', () => {
  afterEach(() => vi.clearAllMocks())

  it('wires reader -> normalizer -> writer -> backtest -> writer for each real, scored matchup found', async () => {
    resetMocks()
    mockGetLeagueMatchups.mockImplementation(async (_leagueId: string, week: number) =>
      week === 1 ? [SCORED_MATCHUP] : [],
    )

    const result = await ingestSleeperLineupsForLeague('league-1', 'ingest-user-1', 2)

    expect(result.replaysWritten).toBe(1)
    expect(result.backtestsWritten).toBe(1)
    expect(result.errors).toEqual([])
    expect(mockUpsertReplayImport).toHaveBeenCalledTimes(1)
    expect(mockRunLineupBacktest).toHaveBeenCalledTimes(1)
    expect(mockUpsertBacktestResult).toHaveBeenCalledTimes(1)
  })

  it('skips a matchup row with no real recorded scoring yet -- never ingests a future/unplayed week as a real decision', async () => {
    resetMocks()
    mockGetLeagueMatchups.mockImplementation(async (_leagueId: string, week: number) =>
      week === 1 ? [SCORED_MATCHUP, UNSCORED_MATCHUP] : [],
    )

    const result = await ingestSleeperLineupsForLeague('league-1', 'ingest-user-1', 2)

    expect(result.replaysWritten).toBe(1)
    expect(result.weeksSkippedUnscored).toBe(1)
    expect(mockUpsertReplayImport).toHaveBeenCalledTimes(1)
  })

  it('returns zero counts and an error when the league cannot be found -- no partial writes', async () => {
    resetMocks()
    mockGetLeagueInfo.mockResolvedValue(null)

    const result = await ingestSleeperLineupsForLeague('missing-league', 'ingest-user-1')

    expect(result.replaysWritten).toBe(0)
    expect(mockUpsertReplayImport).not.toHaveBeenCalled()
  })

  it('isolates a per-matchup failure -- one bad row does not abort the rest of the batch', async () => {
    resetMocks()
    const secondScoredMatchup = { ...SCORED_MATCHUP, roster_id: 2 }
    mockGetLeagueMatchups.mockImplementation(async (_leagueId: string, week: number) =>
      week === 1 ? [SCORED_MATCHUP, secondScoredMatchup] : [],
    )
    mockUpsertReplayImport.mockResolvedValueOnce('replay-1').mockRejectedValueOnce(new Error('write failed'))

    const result = await ingestSleeperLineupsForLeague('league-1', 'ingest-user-1', 2)

    expect(result.replaysWritten).toBe(1)
    expect(result.errors).toHaveLength(1)
  })
})
