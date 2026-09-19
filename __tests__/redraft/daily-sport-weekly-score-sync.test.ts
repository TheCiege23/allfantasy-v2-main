/**
 * NBA/NHL weekly score sync, end to end through the service.
 *
 * Guards the three things that were actually broken, all of which fail silently:
 *
 *  1. The daily sports must read `playerGameStat` — the table the SCHEDULED
 *     multi-sport ingest writes — and not `playerGameLogCache`, which has no
 *     scheduled writer and holds 15 NFL-only rows in production.
 *  2. They must be selected by DATE WINDOW. `weekOrRound` is 0 on every
 *     daily-sport row in production, so filtering on it matches nothing at all.
 *     An earlier version of this test asserted that broken filter as correct,
 *     because the mock returns rows regardless of the `where` clause.
 *  3. A week is several games and must be summed, not sampled.
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

/** A plausible NHL 2026-27 opener. Week 3 is therefore 21 Oct – 28 Oct. */
const SEASON_START = '2026-10-07T00:00:00.000Z'

function seasonFor(sport: string) {
  return { id: 'season-1', leagueId: 'league-1', sport, season: 2026, currentWeek: 3 }
}

async function runSync(opts: { seasonStartUtc?: string | null } = {}) {
  const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
  return syncPlayerWeeklyScoresForRedraftSeason({
    seasonId: 'season-1',
    week: 3,
    actorId: 'admin-1',
    ...opts,
  })
}

function rosterOf(sport: string) {
  return [{ playerId: 'p1', sport, position: sport === 'NBA' ? 'PG' : 'C', team: 'BOS' }]
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
    prismaMock.playerGameStat.findMany.mockResolvedValue([])
  })

  it('no longer refuses NBA outright', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NBA'))
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue([])

    // Previously: threw "Weekly stat sync is currently wired for NFL only".
    await expect(runSync({ seasonStartUtc: SEASON_START })).resolves.toBeTruthy()
  })

  it('still refuses a sport with no normalizer', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'SOCCER', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('SOCCER'))
    await expect(runSync({ seasonStartUtc: SEASON_START })).rejects.toThrow(/NFL, NBA and NHL/)
  })

  describe('week selection', () => {
    beforeEach(() => {
      prismaMock.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: {} })
      prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NBA'))
      prismaMock.redraftRosterPlayer.findMany.mockResolvedValue(rosterOf('NBA'))
    })

    it('reads the scheduled game-stat table, not the unscheduled cache', async () => {
      await runSync({ seasonStartUtc: SEASON_START })

      expect(prismaMock.playerGameStat.findMany).toHaveBeenCalledTimes(1)
      expect(prismaMock.playerGameLogCache.findMany).not.toHaveBeenCalled()
    })

    // The regression this whole file exists for: `weekOrRound` is 0 on every
    // daily-sport row in production, so selecting by it returns nothing.
    it('selects by date window and never by weekOrRound', async () => {
      await runSync({ seasonStartUtc: SEASON_START })

      const where = prismaMock.playerGameStat.findMany.mock.calls[0][0].where
      expect(where).not.toHaveProperty('weekOrRound')
      expect(where).not.toHaveProperty('season')
      expect(where.gameDate).toEqual({
        gte: new Date('2026-10-21T00:00:00.000Z'), // week 3 = start + 14d
        lt: new Date('2026-10-28T00:00:00.000Z'),
      })
    })

    // With no explicit anchor it falls back to the recorded NBA 2026 opener
    // (20 Oct), so week 3 is 3-10 Nov rather than a decline.
    it('falls back to the recorded regular-season opener', async () => {
      await runSync()

      const where = prismaMock.playerGameStat.findMany.mock.calls[0][0].where
      expect(where.gameDate).toEqual({
        gte: new Date('2026-11-03T00:00:00.000Z'),
        lt: new Date('2026-11-10T00:00:00.000Z'),
      })
    })

    it('declines loudly when no anchor is recorded for that season', async () => {
      prismaMock.redraftSeason.findFirst.mockResolvedValue({ ...seasonFor('NBA'), season: 2031 })

      const summary = await runSync()

      expect(prismaMock.playerGameStat.findMany).not.toHaveBeenCalled()
      expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
      expect(summary.warnings.join(' ')).toMatch(/regular-season start date/i)
      expect(summary.warnings.join(' ')).toContain('dailySportSeasonStarts')
    })
  })

  it('sums every game in the week into one score', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NBA', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NBA'))
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue(rosterOf('NBA'))
    prismaMock.playerGameStat.findMany.mockResolvedValue([
      { playerId: 'p1', normalizedStatMap: { stats: { points: 20, rebounds: 5, assists: 4 } } },
      { playerId: 'p1', normalizedStatMap: { stats: { points: 18, rebounds: 7, assists: 6 } } },
      { playerId: 'p1', normalizedStatMap: { stats: { points: 25, rebounds: 4, assists: 9 } } },
    ])

    const summary = await runSync({ seasonStartUtc: SEASON_START })

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
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue(rosterOf('NHL'))
    prismaMock.playerGameStat.findMany.mockResolvedValue([
      { playerId: 'p1', normalizedStatMap: { stats: { vendor_specific_tally: 4 } } },
    ])

    const summary = await runSync({ seasonStartUtc: SEASON_START })

    // Nothing mapped, so nothing is written — a wrong alias table cannot
    // persist a zero that looks like a real bad week.
    expect(summary.scoresUpserted).toBe(0)
    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
    expect(summary.warnings.join(' ')).toContain('vendor_specific_tally')
  })

  it('records a player with no games this week as missing, not as zero', async () => {
    prismaMock.league.findFirst.mockResolvedValue({ sport: 'NHL', settings: {} })
    prismaMock.redraftSeason.findFirst.mockResolvedValue(seasonFor('NHL'))
    prismaMock.redraftRosterPlayer.findMany.mockResolvedValue(rosterOf('NHL'))

    const summary = await runSync({ seasonStartUtc: SEASON_START })

    expect(summary.scoresUpserted).toBe(0)
    expect(summary.missingCachePlayerIds).toContain('p1')
    expect(prismaMock.playerWeeklyScore.upsert).not.toHaveBeenCalled()
  })
})
