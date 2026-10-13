/**
 * 🛑 The NFL score sync read `playerGameLogCache` and Sleeper's week payload by RAW roster ids, and wrote
 * `player_weekly_scores` (unique on playerId + week + season + sport, shared by every league) under them.
 * An ESPN / Fleaflicker roster holds that platform's ids: Fleaflicker 13761 (Josh Allen, QB) is a Sleeper
 * DL, so a sync scored the stranger's week and wrote it OVER his own row. The cron is gated to native
 * leagues; POST /api/redraft/score-sync with a leagueId is not.
 *
 * The identity-map and cache fakes evaluate `playerId IN (...)`, so a read asked with the raw roster id
 * gets the stranger's row back — exactly as production would.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  platform: 'fleaflicker' as string | null,
  identity: [] as Row[],
  cache: [] as Row[],
}))

const prismaMock = vi.hoisted(() => {
  const inFilter = (rows: () => Record<string, unknown>[], key: string) =>
    async (args: { where?: Record<string, unknown> } = {}) => {
      const where = (args.where ?? {}) as Record<string, unknown>
      return rows().filter((r) =>
        Object.entries(where).every(([k, cond]) => {
          if (cond && typeof cond === 'object' && 'in' in (cond as object)) {
            return ((cond as { in: unknown[] }).in).includes(r[k])
          }
          // Only the id column is evaluated strictly; the rest of the fixture is one sport/season.
          return k !== key || r[k] === cond
        }),
      )
    }
  return {
    adminAuditLog: { create: vi.fn(async () => ({})) },
    league: { findUnique: vi.fn(async () => ({ platform: h.platform })) },
    playerIdentityMap: { findMany: vi.fn(inFilter(() => h.identity, 'espnId')) },
    playerGameLogCache: { findMany: vi.fn(inFilter(() => h.cache, 'playerId')) },
    playerWeeklyScore: { upsert: vi.fn(async () => ({})) },
    redraftRoster: { findMany: vi.fn(async () => [{ id: 'roster-1' }]) },
    redraftRosterPlayer: { findMany: vi.fn() },
    redraftSeason: { findFirst: vi.fn(async () => ({ id: 'season-1', leagueId: 'league-1', sport: 'NFL', season: 2026, currentWeek: 2 })) },
    sportsGame: { findMany: vi.fn(async () => [{ homeTeam: 'ARI', awayTeam: 'SEA', homeScore: 20, awayScore: 27, source: 'x', fetchedAt: new Date() }]) },
  }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/redraft/scoringEngine', () => ({ calculateScoreFromSportConfig: vi.fn(async () => 12) }))

const rosterPlayer = (playerId: string, position: string, team = 'BUF') => ({ playerId, position, sport: 'NFL', team })
const strangerWeek = (playerId: string, pass_yds: number) => ({ playerId, payload: { weeks: [{ week: 2, stats: { pass_yds } }] } })

async function runSync(fetchNflWeekStats: (args: { playerIds: readonly string[] }) => Promise<Map<string, Record<string, number>>>) {
  const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
  return syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 2, actorId: 'test', fetchNflWeekStats: fetchNflWeekStats as never })
}

const writtenIds = () =>
  prismaMock.playerWeeklyScore.upsert.mock.calls.map(([a]) => (a as { where: { playerId_week_season_sport: { playerId: string } } }).where.playerId_week_season_sport.playerId)

beforeEach(() => {
  vi.clearAllMocks()
  h.platform = 'fleaflicker'
  h.identity = []
  h.cache = []
})

describe('score sync — a foreign roster id is never read or written as a Sleeper id', () => {
  it('🛑 Fleaflicker 13761 (Josh Allen), unmapped: nothing read for, or written under, Sleeper 13761', async () => {
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([rosterPlayer('13761', 'QB')])
    h.cache = [strangerWeek('13761', 0)]
    const fetcher = vi.fn(async () => new Map([['13761', { def_tkl: 7 }]]))

    const summary = await runSync(fetcher)

    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
    expect(summary.scoresUpserted).toBe(0)
    expect(summary.rosteredPlayers).toBe(1)
    expect(summary.foreignIdsTranslated).toBe(0)
    expect(summary.untranslatedForeignPlayerIds).toEqual(['13761'])
    expect(summary.warnings.join(' ')).toMatch(/NOT scored/)
    expect(summary.warnings.join(' ')).not.toMatch(/No rostered players/)
  })

  it('Fleaflicker 13761 mapped to Sleeper 4984 scores ALLEN\'s week, under 4984', async () => {
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([rosterPlayer('13761', 'QB')])
    h.identity = [{ sport: 'NFL', fleaflickerId: '13761', espnId: null, mflId: null, sleeperId: '4984' }]
    h.cache = [strangerWeek('13761', 0)]
    const fetcher = vi.fn(async ({ playerIds }: { playerIds: readonly string[] }) =>
      new Map<string, Record<string, number>>([
        ['13761', { def_tkl: 7 }],
        ['4984', { pass_yds: 310 }],
      ].filter(([id]) => playerIds.includes(id as string)) as Array<[string, Record<string, number>]>),
    )

    const summary = await runSync(fetcher)

    expect(fetcher).toHaveBeenCalledWith(expect.objectContaining({ playerIds: ['4984'] }))
    expect(writtenIds()).toEqual(['4984'])
    const written = prismaMock.playerWeeklyScore.upsert.mock.calls[0]![0] as { create: { stats: unknown } }
    expect(written.create.stats).toEqual({ pass_yds: 310 })
    expect(summary.foreignIdsTranslated).toBe(1)
    expect(summary.untranslatedForeignPlayerIds).toEqual([])
  })

  it('🛑 an ESPN team defense whose row contradicts its id (-16001 is ATL, the row says ARI) is not written at all', async () => {
    h.platform = 'espn'
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([rosterPlayer('-16001', 'DEF', 'ARI')])
    const fetcher = vi.fn(async () => new Map())

    const summary = await runSync(fetcher)

    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(summary.untranslatedForeignPlayerIds).toEqual(['-16001'])
  })

  /*
   * Owner decision 2026-10-13: score foreign team defences. Sleeper's id for one is the club code, and the
   * sync scores it through the team-defence branch — points allowed from the finished game (ARI 20, SEA 27).
   */
  it('ESPN -16022 (ARI D/ST) is scored as Sleeper\'s ARI defence, from the game it played, under ARI', async () => {
    h.platform = 'espn'
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { ...rosterPlayer('-16022', 'D/ST', 'ARI'), playerName: 'Cardinals D/ST' },
    ])
    const fetcher = vi.fn(async () => new Map())

    const summary = await runSync(fetcher)

    expect(writtenIds()).toEqual(['ARI'])
    const written = prismaMock.playerWeeklyScore.upsert.mock.calls[0]![0] as { create: { stats: unknown } }
    expect(written.create.stats).toEqual({ def_points_allowed: 27 })
    // A defence is never asked of the offensive week feed, where its sacks would read as a QB's.
    expect(fetcher).not.toHaveBeenCalled()
    expect(summary.foreignIdsTranslated).toBe(1)
    expect(summary.untranslatedForeignPlayerIds).toEqual([])
  })

  it('an ESPN D/ST the importer could not label (position UNK, name = its id) is still named by its id', async () => {
    h.platform = 'espn'
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: '-16026', playerName: '-16026', position: 'UNK', sport: 'NFL', team: null },
    ])

    const summary = await runSync(vi.fn(async () => new Map()))

    expect(writtenIds()).toEqual(['SEA'])
    const written = prismaMock.playerWeeklyScore.upsert.mock.calls[0]![0] as { create: { stats: unknown } }
    expect(written.create.stats).toEqual({ def_points_allowed: 20 })
    expect(summary.untranslatedForeignPlayerIds).toEqual([])
  })

  it('Fleaflicker 2357 ("Seattle Seahawks", team "Seahawks"; the id says nothing) is scored under SEA, matched to its game by club code', async () => {
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { ...rosterPlayer('2357', 'D/ST', 'Seahawks'), playerName: 'Seattle Seahawks' },
    ])

    const summary = await runSync(vi.fn(async () => new Map()))

    expect(writtenIds()).toEqual(['SEA'])
    const written = prismaMock.playerWeeklyScore.upsert.mock.calls[0]![0] as { create: { stats: unknown } }
    expect(written.create.stats).toEqual({ def_points_allowed: 20 })
    expect(summary.untranslatedForeignPlayerIds).toEqual([])
  })

  it('🛑 a Fleaflicker "D/ST" row whose name is a person is not a defence — skipped, never written', async () => {
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { ...rosterPlayer('2357', 'D/ST', 'Seahawks'), playerName: 'Josh Allen' },
    ])

    const summary = await runSync(vi.fn(async () => new Map()))

    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(summary.untranslatedForeignPlayerIds).toEqual(['2357'])
  })

  it('a native league reads no crosswalk and scores its own ids as before', async () => {
    h.platform = 'sleeper'
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([rosterPlayer('4984', 'QB')])
    const fetcher = vi.fn(async () => new Map([['4984', { pass_yds: 250 }]]))

    const summary = await runSync(fetcher)

    expect(prismaMock.playerIdentityMap.findMany).not.toHaveBeenCalled()
    expect(writtenIds()).toEqual(['4984'])
    expect(summary.untranslatedForeignPlayerIds).toBeUndefined()
  })
})
