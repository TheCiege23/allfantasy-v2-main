/**
 * NBA/NHL weekly score sync, end to end through the service.
 *
 * Guards the two things that were actually broken, both of which fail silently:
 *
 *  1. The daily sports must read `playerGameStat` — the table the SCHEDULED
 *     multi-sport ingest writes — and not `playerGameLogCache`, which has no
 *     scheduled writer. Sourcing them from the cache produces a league that
 *     never scores and never says why.
 *  2. A week is several games and must be summed. Taking one row scores a
 *     fraction of the week and looks entirely correct.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  adminAuditLog: { create: vi.fn() },
  league: { findFirst: vi.fn() },
  playerGameLogCache: { findMany: vi.fn() },
  playerGameStat: { findMany: vi.fn() },
  playerIdentityMap: { findFirst: vi.fn() },
  playerWeeklyScore: { upsert: vi.fn(), findUnique: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  sportsGame: { findMany: vi.fn() },
  sportsPlayer: { findFirst: vi.fn() },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

function seasonFor(sport: string) {
  return { id: 'season-1', leagueId: 'league-1', sport, season: 2026, currentWeek: 3 }
}

async function runSync() {
  const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
  return syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 3, actorId: 'admin-1' })
}

describe('daily-sport weekly score sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' })
    prismaMock.playerIdentityMap.findFirst.mockResolvedValue(null)
    prismaMock.playerWeeklyScore.upsert.mockResolvedValue({})
    prismaMock.sportsPlayer.findFirst.mockResolvedValue(null)
    prismaMock.sportsGame.findMany.mockResolvedValue([])
    prismaMock.playerGameLogCache.findMany.mockResolvedValue([])
    prismaMock.redraftRoster.findMany.mockResolvedValue([{ id: 'roster-1' }])
  })

  it('no longer refuses NBA outright', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NBA'))
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([])
    prismaMock.playerGameStat.findMany.mockResolvedValue([])

    // Previously: threw "Weekly stat sync is currently wired for NFL only".
    await expect(runSync()).resolves.toBeTruthy()
  })

  it('still refuses a sport with no normalizer', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'SOCCER', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('SOCCER'))
    await expect(runSync()).rejects.toThrow(/NFL, NBA and NHL/)
  })

  it('reads the scheduled game-stat table, not the unscheduled cache', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NBA'))
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'p1', sport: 'NBA', position: 'PG', team: 'BOS' },
    ])
    prismaMock.playerGameStat.findMany.mockResolvedValue([])

    await runSync()

    expect(prismaMock.playerGameStat.findMany).toHaveBeenCalledTimes(1)
    expect(prismaMock.playerGameLogCache.findMany).not.toHaveBeenCalled()
    // The query must narrow to the week being scored, or it would sum a season.
    expect(prismaMock.playerGameStat.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ season: 2026, weekOrRound: 3 }) }),
    )
  })

  it('sums every game in the week into one score', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NBA'))
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'p1', sport: 'NBA', position: 'PG', team: 'BOS' },
    ])
    prismaMock.playerGameStat.findMany.mockResolvedValue([
      { playerId: 'p1', normalizedStatMap: { stats: { points: 20, rebounds: 5, assists: 4 } } },
      { playerId: 'p1', normalizedStatMap: { stats: { points: 18, rebounds: 7, assists: 6 } } },
      { playerId: 'p1', normalizedStatMap: { stats: { points: 25, rebounds: 4, assists: 9 } } },
    ])

    const summary = await runSync()

    expect(summary.scoresUpserted).toBe(1)
    const written = prismaMock.playerWeeklyScore.upsert.mock.calls[0][0]
    expect(written.create.stats).toMatchObject({ pts: 63, reb: 16, ast: 19 })
    expect(written.create.sport).toBe('NBA')
    expect(written.create.week).toBe(3)
    expect(typeof written.create.fantasyPts).toBe('number')
  })

  it('reports unrecognized provider keys instead of scoring a silent zero', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NHL', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NHL'))
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'p1', sport: 'NHL', position: 'C', team: 'BOS' },
    ])
    prismaMock.playerGameStat.findMany.mockResolvedValue([
      { playerId: 'p1', normalizedStatMap: { stats: { vendor_specific_tally: 4 } } },
    ])

    const summary = await runSync()

    // Nothing mapped, so nothing is written — a wrong alias table cannot
    // persist a zero that looks like a real bad week.
    expect(summary.scoresUpserted).toBe(0)
    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(summary.warnings.join(' ')).toContain('vendor_specific_tally')
  })

  it('records a player with no games this week as missing, not as zero', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NHL', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NHL'))
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'p1', sport: 'NHL', position: 'C', team: 'BOS' },
    ])
    prismaMock.playerGameStat.findMany.mockResolvedValue([])

    const summary = await runSync()

    expect(summary.scoresUpserted).toBe(0)
    expect(summary.missingCachePlayerIds).toContain('p1')
    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
  })
})
