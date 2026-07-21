import { describe, expect, it, vi } from 'vitest'

// Parser + adapter unit coverage for the player-game-stat ingestion pipeline. DB idempotency
// (unique (playerId, sportType, gameId) upsert) is proven against a real clone in the PR's
// verification run — these tests cover the pure translation layer.

vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/schedule-stats', () => ({ ingestSportStats: vi.fn() }))
vi.mock('@/lib/data-warehouse/HistoricalFactGenerator', () => ({ generateGameFactsFromExistingStats: vi.fn() }))

import {
  importPlayerGameStatsForWeek,
  parseSleeperWeekPayload,
  type WeeklyStatsFetcher,
} from '@/lib/player-game-stats/importPlayerGameStats'

describe('parseSleeperWeekPayload', () => {
  it('parses the object-keyed shape', () => {
    const rows = parseSleeperWeekPayload({
      '4046': { stats: { pass_yd: 305, pass_td: 3, pts_ppr: 24.9 } },
      SF: { stats: { pts_allow: 17, sack: 4 } }, // team DST rows are legitimate roster ids
    })
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.playerId === '4046')?.stats.pass_yd).toBe(305)
    expect(rows.find((r) => r.playerId === 'SF')?.stats.sack).toBe(4)
  })

  it('parses the array shape and keeps provider game ids', () => {
    const rows = parseSleeperWeekPayload([
      { player_id: '4046', game_id: '202501120', stats: { pass_yd: 305 } },
      { player_id: '6786', stats: { rec: 9, rec_yd: 132 } },
    ])
    expect(rows.find((r) => r.playerId === '4046')?.gameId).toBe('202501120')
    expect(rows.find((r) => r.playerId === '6786')?.gameId).toBeNull()
  })

  it('drops rows with no numeric stats instead of fabricating zeros', () => {
    const rows = parseSleeperWeekPayload({
      '1111': { stats: {} },
      '2222': { stats: { rush_yd: 'not-a-number' } },
      '3333': { stats: { rush_yd: 84 } },
    })
    expect(rows.map((r) => r.playerId)).toEqual(['3333'])
  })
})

describe('importPlayerGameStatsForWeek', () => {
  const fixtureFetcher: WeeklyStatsFetcher = {
    fetchWeek: async () => [
      { playerId: '4046', gameId: null, stats: { pass_yd: 305, pass_td: 3 } },
      { playerId: '9999', gameId: null, stats: { rush_yd: 55 } },
    ],
  }

  it('dry run counts matched/unresolved without writing', async () => {
    const { ingestSportStats } = await import('@/lib/schedule-stats')
    const report = await importPlayerGameStatsForWeek({
      season: 2025,
      week: 3,
      fetcher: fixtureFetcher,
      knownPlayerIds: new Set(['4046']),
      dryRun: true,
    })
    expect(report).toMatchObject({
      season: 2025,
      week: 3,
      fetched: 2,
      ingested: 0,
      matchedPlayers: 1,
      unresolvedPlayers: 1,
      dryRun: true,
    })
    expect(ingestSportStats).not.toHaveBeenCalled()
  })

  it('returns null on provider failure — no fabrication', async () => {
    const failing: WeeklyStatsFetcher = { fetchWeek: async () => null }
    const report = await importPlayerGameStatsForWeek({ season: 2025, week: 3, fetcher: failing, dryRun: true })
    expect(report).toBeNull()
  })

  it('filters TEAM_* whole-team aggregate rows before persistence, keeps DST codes', async () => {
    const { ingestSportStats } = await import('@/lib/schedule-stats')
    vi.mocked(ingestSportStats).mockClear()
    const withTeamRows: WeeklyStatsFetcher = {
      fetchWeek: async () => [
        { playerId: '4984', gameId: null, stats: { pass_yd: 394 } },
        { playerId: 'TEAM_BUF', gameId: null, stats: { tkl: 44, td: 5 } }, // team aggregate — must never persist
        { playerId: 'SF', gameId: null, stats: { sack: 4 } },              // DST — legitimate roster id, kept
        { playerId: 'TEAM_BAL', gameId: null, stats: { tkl: 67 } },
      ],
    }
    const report = await importPlayerGameStatsForWeek({
      season: 2025, week: 1, fetcher: withTeamRows, knownPlayerIds: new Set(['4984', 'SF']), dryRun: true,
    })
    expect(report).toMatchObject({ fetched: 4, teamRowsFiltered: 2, matchedPlayers: 2, unresolvedPlayers: 0 })
    // Non-dry-run persistence path receives ONLY the non-TEAM_ rows.
    vi.mocked(ingestSportStats).mockResolvedValue({ jobId: 'j', gameCount: 0, playerStatCount: 2, teamStatCount: 0 })
    const { generateGameFactsFromExistingStats } = await import('@/lib/data-warehouse/HistoricalFactGenerator')
    vi.mocked(generateGameFactsFromExistingStats).mockResolvedValue({
      status: 'COMPLETED', playerFacts: 2, teamFacts: 0, sourcePlayerGameStats: 2, sourceTeamGameStats: 0, warnings: [],
    })
    await importPlayerGameStatsForWeek({ season: 2025, week: 1, fetcher: withTeamRows })
    const persisted = vi.mocked(ingestSportStats).mock.calls.at(-1)![0]
    const persistedIds = (persisted.playerStats ?? []).map((row) => row.playerId)
    expect(persistedIds).toEqual(['4984', 'SF'])
    expect(persistedIds.some((id) => id.startsWith('TEAM_'))).toBe(false)
  })

  it('builds a deterministic per-week gameId when the provider omits one (idempotent key)', async () => {
    const { ingestSportStats } = await import('@/lib/schedule-stats')
    vi.mocked(ingestSportStats).mockClear()
    vi.mocked(ingestSportStats).mockResolvedValue({ jobId: 'j1', gameCount: 0, playerStatCount: 2, teamStatCount: 0 })
    const { generateGameFactsFromExistingStats } = await import('@/lib/data-warehouse/HistoricalFactGenerator')
    vi.mocked(generateGameFactsFromExistingStats).mockResolvedValue({
      status: 'COMPLETED', playerFacts: 2, teamFacts: 0, sourcePlayerGameStats: 2, sourceTeamGameStats: 0, warnings: [],
    })

    const report = await importPlayerGameStatsForWeek({ season: 2025, week: 3, fetcher: fixtureFetcher })
    expect(report?.ingested).toBe(2)
    expect(report?.playerFactsGenerated).toBe(2)
    const call = vi.mocked(ingestSportStats).mock.calls[0][0]
    expect(call.playerStats?.[0].gameId).toBe('NFL-2025-W03')
    // Same inputs → same gameId → PlayerGameStat's (playerId, sportType, gameId) unique key
    // makes the second run an update, not a duplicate.
    const rerun = await importPlayerGameStatsForWeek({ season: 2025, week: 3, fetcher: fixtureFetcher })
    const rerunCall = vi.mocked(ingestSportStats).mock.calls[1][0]
    expect(rerunCall.playerStats?.[0].gameId).toBe('NFL-2025-W03')
    expect(rerun?.ingested).toBe(2)
  })
})
