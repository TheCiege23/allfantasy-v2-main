import { beforeEach, describe, expect, it, vi } from 'vitest'

// Parser + adapter + ledger unit coverage for the player-game-stat ingestion pipeline. DB
// idempotency and pagination/resume are proven against a real clone in the rollout evidence.

const statIngestionJobCreate = vi.fn()
const statIngestionJobUpdate = vi.fn()
const playerGameStatCount = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    statIngestionJob: {
      create: (...a: unknown[]) => statIngestionJobCreate(...a),
      update: (...a: unknown[]) => statIngestionJobUpdate(...a),
    },
    playerGameStat: { count: (...a: unknown[]) => playerGameStatCount(...a) },
  },
}))
vi.mock('@/lib/schedule-stats', () => ({ ingestSportStats: vi.fn() }))
vi.mock('@/lib/data-warehouse/HistoricalFactGenerator', () => ({ generateGameFactsFromExistingStats: vi.fn() }))

import {
  importPlayerGameStatsForWeek,
  parseSleeperWeekPayload,
  SleeperWeeklyStatsFetcher,
  type ImportWeekReport,
  type WeeklyStatsFetcher,
} from '@/lib/player-game-stats/importPlayerGameStats'

beforeEach(() => {
  vi.clearAllMocks()
  statIngestionJobCreate.mockResolvedValue({ id: 'ledger-1' })
  statIngestionJobUpdate.mockResolvedValue({})
  playerGameStatCount.mockResolvedValue(2)
})

const okFetcher = (rows: Parameters<typeof Object.freeze>[0]): WeeklyStatsFetcher => ({
  fetchWeek: async () => ({ ok: true, rows: rows as never }),
})

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

describe('SleeperWeeklyStatsFetcher — bounded provider requests', () => {
  const args = { sport: 'NFL' as const, season: 2025, week: 1, seasonType: 'regular' as const }

  it('successful request returns tagged rows', async () => {
    const fetcher = new SleeperWeeklyStatsFetcher(50, async () => ({
      ok: true, status: 200, json: async () => ({ '4046': { stats: { pass_yd: 305 } } }),
    }))
    const outcome = await fetcher.fetchWeek(args)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.rows).toHaveLength(1)
  })

  it('a hung socket is aborted within the configured window and tagged timeout', async () => {
    const fetcher = new SleeperWeeklyStatsFetcher(30, (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted'); err.name = 'AbortError'; reject(err)
        })
      })
    )
    const started = Date.now()
    const outcome = await fetcher.fetchWeek(args)
    expect(Date.now() - started).toBeLessThan(2_000) // fired at ~30ms, nowhere near a function budget
    expect(outcome).toEqual({ ok: false, failure: 'timeout' })
  })

  it('HTTP failure is distinguished from timeout and carries the status', async () => {
    const fetcher = new SleeperWeeklyStatsFetcher(50, async () => ({ ok: false, status: 503, json: async () => ({}) }))
    expect(await fetcher.fetchWeek(args)).toEqual({ ok: false, failure: 'http', status: 503 })
  })

  it('network errors are tagged network, and one call means one attempt — no retry loop', async () => {
    const impl = vi.fn(async () => { throw new Error('ECONNRESET') })
    const fetcher = new SleeperWeeklyStatsFetcher(50, impl)
    expect(await fetcher.fetchWeek(args)).toEqual({ ok: false, failure: 'network' })
    expect(impl).toHaveBeenCalledTimes(1)
  })
})

describe('importPlayerGameStatsForWeek', () => {
  it('dry run counts matched/unresolved without writing', async () => {
    const { ingestSportStats } = await import('@/lib/schedule-stats')
    const report = await importPlayerGameStatsForWeek({
      season: 2025,
      week: 3,
      fetcher: okFetcher([
        { playerId: '4046', gameId: null, stats: { pass_yd: 305, pass_td: 3 } },
        { playerId: '9999', gameId: null, stats: { rush_yd: 55 } },
      ]),
      knownPlayerIds: new Set(['4046']),
      dryRun: true,
    })
    expect(report).toMatchObject({
      season: 2025, week: 3, fetched: 2, ingested: 0, matchedPlayers: 1, unresolvedPlayers: 1, dryRun: true,
    })
    expect(ingestSportStats).not.toHaveBeenCalled()
    expect(statIngestionJobCreate).not.toHaveBeenCalled()
  })

  it('provider failure returns the tagged kind and records a failed ledger attempt', async () => {
    const failing: WeeklyStatsFetcher = { fetchWeek: async () => ({ ok: false, failure: 'timeout' }) }
    const result = await importPlayerGameStatsForWeek({ season: 2025, week: 3, fetcher: failing })
    expect(result).toMatchObject({ providerFailure: 'timeout' })
    expect(statIngestionJobUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('provider timeout'),
      }),
    }))
  })

  it('filters TEAM_* whole-team aggregate rows before persistence, keeps DST codes', async () => {
    const { ingestSportStats } = await import('@/lib/schedule-stats')
    const { generateGameFactsFromExistingStats } = await import('@/lib/data-warehouse/HistoricalFactGenerator')
    vi.mocked(ingestSportStats).mockResolvedValue({ jobId: 'j', gameCount: 0, playerStatCount: 2, teamStatCount: 0 })
    vi.mocked(generateGameFactsFromExistingStats).mockResolvedValue({
      status: 'COMPLETED', playerFacts: 2, teamFacts: 0, sourcePlayerGameStats: 2, sourceTeamGameStats: 0, warnings: [],
    })
    const withTeamRows = okFetcher([
      { playerId: '4984', gameId: null, stats: { pass_yd: 394 } },
      { playerId: 'TEAM_BUF', gameId: null, stats: { tkl: 44, td: 5 } },
      { playerId: 'SF', gameId: null, stats: { sack: 4 } },
      { playerId: 'TEAM_BAL', gameId: null, stats: { tkl: 67 } },
    ])
    const report = await importPlayerGameStatsForWeek({ season: 2025, week: 1, fetcher: withTeamRows }) as ImportWeekReport
    expect(report).toMatchObject({ fetched: 4, teamRowsFiltered: 2, ingested: 2 })
    const persisted = vi.mocked(ingestSportStats).mock.calls.at(-1)![0]
    const persistedIds = (persisted.playerStats ?? []).map((row) => row.playerId)
    expect(persistedIds).toEqual(['4984', 'SF'])
    expect(persistedIds.some((id) => id.startsWith('TEAM_'))).toBe(false)
  })

  it('completes the ledger only after validation reconciles facts against stats', async () => {
    const { ingestSportStats } = await import('@/lib/schedule-stats')
    const { generateGameFactsFromExistingStats } = await import('@/lib/data-warehouse/HistoricalFactGenerator')
    vi.mocked(ingestSportStats).mockResolvedValue({ jobId: 'j1', gameCount: 0, playerStatCount: 2, teamStatCount: 0 })
    vi.mocked(generateGameFactsFromExistingStats).mockResolvedValue({
      status: 'COMPLETED', playerFacts: 2, teamFacts: 0, sourcePlayerGameStats: 2, sourceTeamGameStats: 0, warnings: [],
    })
    playerGameStatCount.mockResolvedValue(2) // facts (2) reconcile with stats in DB (2)

    const report = await importPlayerGameStatsForWeek({
      season: 2025, week: 3,
      fetcher: okFetcher([
        { playerId: '4046', gameId: null, stats: { pass_yd: 305 } },
        { playerId: '6786', gameId: null, stats: { rec_yd: 132 } },
      ]),
    }) as ImportWeekReport
    expect(report.ingested).toBe(2)
    const call = vi.mocked(ingestSportStats).mock.calls[0][0]
    expect(call.playerStats?.[0].gameId).toBe('NFL-2025-W03')
    const statuses = statIngestionJobUpdate.mock.calls.map((c) => (c[0] as { data: { status: string } }).data.status)
    expect(statuses).toEqual(['stats_written', 'facts_generated', 'completed'])
  })

  it('a limit-bounded run that does not reconcile stays partial — never marked completed', async () => {
    const { ingestSportStats } = await import('@/lib/schedule-stats')
    const { generateGameFactsFromExistingStats } = await import('@/lib/data-warehouse/HistoricalFactGenerator')
    vi.mocked(ingestSportStats).mockResolvedValue({ jobId: 'j1', gameCount: 0, playerStatCount: 1, teamStatCount: 0 })
    vi.mocked(generateGameFactsFromExistingStats).mockResolvedValue({
      status: 'COMPLETED', playerFacts: 1, teamFacts: 0, sourcePlayerGameStats: 1, sourceTeamGameStats: 0, warnings: [],
    })
    playerGameStatCount.mockResolvedValue(2312) // fuller week already in DB — 1 fact ≠ 2312 stats

    await importPlayerGameStatsForWeek({
      season: 2025, week: 1, limit: 1,
      fetcher: okFetcher([
        { playerId: '4046', gameId: null, stats: { pass_yd: 305 } },
        { playerId: '6786', gameId: null, stats: { rec_yd: 132 } },
      ]),
    })
    const statuses = statIngestionJobUpdate.mock.calls.map((c) => (c[0] as { data: { status: string } }).data.status)
    expect(statuses.at(-1)).toBe('partial')
    expect(statuses).not.toContain('completed')
  })
})
