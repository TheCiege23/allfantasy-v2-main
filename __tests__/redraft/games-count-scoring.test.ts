/**
 * "Which games count" (lib/redraft/gamesCount.ts) inside the matchup scorer and the stat sync.
 *
 * NBA 2026 opens Tuesday 20 Oct, so week 1 is 20–26 Oct. Each player's whole-week weekly row equals the
 * sum of his per-game rows, so `all` and the per-game modes are scored from the same data.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  adminAuditLog: { create: vi.fn() },
  league: { findFirst: vi.fn(), findUnique: vi.fn() },
  exileWeeklyEntry: { findMany: vi.fn() },
  playerGameLogCache: { findMany: vi.fn() },
  playerGameStat: { findMany: vi.fn() },
  playerIdentityMap: { findFirst: vi.fn(), findMany: vi.fn() },
  playerWeeklyScore: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => []) },
  playerDailyScore: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  playerWeekGameScore: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  redraftGamesCountChoice: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
  sportsDataCache: { findUnique: vi.fn(), findMany: vi.fn() },
  sportsGame: { findMany: vi.fn() },
  sportsPlayer: { findFirst: vi.fn() },
  $queryRaw: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { calculateScoreFromSportConfig, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { resetGamesCountTablesProbe } from '@/lib/redraft/gamesCountStore'

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const ALL = { sportConfig: {} }
const BEST2 = { sportConfig: { gamesCountMode: 'best_n', gamesCountBestN: 2 } }
const LOCK = { sportConfig: { gamesCountMode: 'lock_in' } }
const DAILY = { lineupLockType: 'daily', dailyLineupsEnabled: true }

/** playerId → [day, pts, gameId] */
const GAMES: Record<string, Array<[string, number, string]>> = {
  a: [['2026-10-20', 10, 'g1'], ['2026-10-22', 30, 'g2'], ['2026-10-24', 20, 'g3']],
  b: [['2026-10-21', 7, 'g4'], ['2026-10-23', 7, 'g5'], ['2026-10-25', 4, 'g6']],
  bench: [['2026-10-21', 50, 'g7']],
}
const ROSTER = [
  { playerId: 'a', position: 'PG', slotType: 'PG' },
  { playerId: 'b', position: 'SG', slotType: 'SG' },
  { playerId: 'bench', position: 'C', slotType: 'BN' },
]

function arrange(settings: Record<string, unknown>, choices: Array<{ playerId: string; pickedGameIds?: string[]; lockedGameId?: string | null }> = []) {
  db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings })
  db.redraftRosterPlayer.findMany.mockResolvedValue(
    ROSTER.map((p) => ({ ...p, rosterId: 'r1', sport: 'NBA', playerName: p.playerId, droppedAt: null, addedAt: new Date('2026-10-01T00:00:00Z') })),
  )
  db.roster.findMany.mockResolvedValue([])
  db.afRosterLineupAssignment.findMany.mockResolvedValue([])
  db.redraftDailyLineup.findMany.mockResolvedValue([])
  db.playerDailyScore.findMany.mockResolvedValue(
    Object.entries(GAMES).flatMap(([playerId, games]) => games.map(([d, pts]) => ({ playerId, scoringDay: day(d), stats: { pts }, isFinalized: true }))),
  )
  db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
    const id = where.playerId_week_season_sport.playerId
    const total = (GAMES[id] ?? []).reduce((s, [, p]) => s + p, 0)
    return { stats: { pts: total }, isFinalized: true }
  })
  db.playerWeekGameScore.findMany.mockImplementation(async ({ where }: { where: { playerId: { in: string[] } } }) =>
    where.playerId.in.flatMap((playerId) =>
      (GAMES[playerId] ?? []).map(([d, pts, gameId]) => ({ playerId, gameId, gameDay: day(d), startTime: null, stats: { pts } })),
    ),
  )
  db.redraftGamesCountChoice.findMany.mockResolvedValue(
    choices.map((c) => ({ playerId: c.playerId, pickedGameIds: c.pickedGameIds ?? [], lockedGameId: c.lockedGameId ?? null })),
  )
}

const pts = (n: number, position = 'PG') => calculateScoreFromSportConfig('L1', 'x', 1, { pts: n }, position)
const round = (n: number) => Math.round(n * 100) / 100
const score = () => scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })

beforeEach(() => {
  vi.clearAllMocks()
  resetGamesCountTablesProbe()
  db.$queryRaw.mockResolvedValue([{ ok: true }])
})

describe('All games — the default', () => {
  it('scores exactly the whole-week rows and never queries the new tables', async () => {
    arrange(ALL)
    // The scorer must give points for this stat, or every comparison below is 0 === 0.
    expect(await pts(10)).toBeGreaterThan(await pts(4))
    const r = await score()
    expect(r.points).toBe(round((await pts(60)) + (await pts(18, 'SG'))))
    expect(r.starterCount).toBe(2)
    expect(db.playerWeekGameScore.findMany).not.toHaveBeenCalled()
    expect(db.redraftGamesCountChoice.findMany).not.toHaveBeenCalled()
  })

  it('an invalid stored mode (or a non-NBA/NHL/MLB sport) is the default too', async () => {
    arrange({ sportConfig: { gamesCountMode: 'best_n', gamesCountBestN: 7 } })
    const bad = await score()
    arrange(ALL)
    const base = await score()
    expect(JSON.stringify(bad)).toBe(JSON.stringify(base))
    expect(db.playerWeekGameScore.findMany).not.toHaveBeenCalled()
  })
})

describe('Best N', () => {
  it('with no picks counts each starter\'s best N games, bench untouched', async () => {
    arrange(BEST2)
    const r = await score()
    // a: 30 + 20. b: 7 + 7 (the tie at 4 is not reached).
    expect(r.points).toBe(round((await pts(50)) + (await pts(14, 'SG'))))
    expect(r.allFinal).toBe(true)
  })

  it('honours the manager\'s picks and fills the rest with his best', async () => {
    arrange(BEST2, [{ playerId: 'a', pickedGameIds: ['g1'] }])
    const r = await score()
    // a: picked g1 (10) + best remaining g2 (30).
    expect(r.points).toBe(round((await pts(40)) + (await pts(14, 'SG'))))
  })

  it('ignores a picked game that is not one of his', async () => {
    arrange(BEST2, [{ playerId: 'a', pickedGameIds: ['g7', 'nope'] }])
    const r = await score()
    expect(r.points).toBe(round((await pts(50)) + (await pts(14, 'SG'))))
  })

  it('a starter with a weekly row but no per-game rows is missing, never scored whole-week', async () => {
    arrange(BEST2)
    db.playerWeekGameScore.findMany.mockResolvedValue([])
    const r = await score()
    expect(r.points).toBe(0)
    expect(r.allFinal).toBe(false)
    expect(r.missingPlayerIds.sort()).toEqual(['a', 'b'])
  })
})

describe('Lock-In', () => {
  it('never locked: the LAST game of the week counts', async () => {
    arrange(LOCK)
    const r = await score()
    expect(r.points).toBe(round((await pts(20)) + (await pts(4, 'SG'))))
  })

  it('locked: that game counts and his later games do not', async () => {
    arrange(LOCK, [{ playerId: 'a', lockedGameId: 'g2' }])
    const r = await score()
    expect(r.points).toBe(round((await pts(30)) + (await pts(4, 'SG'))))
  })
})

describe('fail safe: a non-default mode without its tables scores as All games', () => {
  it('weekly and daily: whole-week score, no query against the missing tables, a warning, never a throw', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      arrange(ALL)
      const base = await score()
      for (const settings of [LOCK, BEST2]) {
        arrange(settings)
        db.$queryRaw.mockResolvedValue([{ ok: false }])
        // A query against the missing table would raise P2021.
        db.playerWeekGameScore.findMany.mockRejectedValue(new Error('P2021'))
        db.redraftGamesCountChoice.findMany.mockRejectedValue(new Error('P2021'))
        const r = await score()
        expect(JSON.stringify(r)).toBe(JSON.stringify(base))
      }
      arrange({ sportConfig: { ...DAILY, gamesCountMode: 'lock_in' } })
      db.$queryRaw.mockRejectedValue(new Error('probe failed'))
      db.playerWeekGameScore.findMany.mockRejectedValue(new Error('P2021'))
      const daily = await score()
      arrange({ sportConfig: DAILY })
      expect(JSON.stringify(daily)).toBe(JSON.stringify(await score()))
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[games-count] scoring'))
    } finally {
      warn.mockRestore()
    }
  })
})

describe('daily-lineup league: the rule applies across the days he STARTED', () => {
  it('best N picks only among started days', async () => {
    arrange({ sportConfig: { ...DAILY, gamesCountMode: 'best_n', gamesCountBestN: 2 } })
    // a is benched on the 22nd (his 30-point game) and started otherwise.
    db.redraftDailyLineup.findMany.mockResolvedValue([
      { rosterId: 'r1', playerId: 'a', scoringDay: day('2026-10-20'), slotType: 'PG' },
      { rosterId: 'r1', playerId: 'a', scoringDay: day('2026-10-22'), slotType: 'BN' },
      { rosterId: 'r1', playerId: 'a', scoringDay: day('2026-10-24'), slotType: 'PG' },
    ])
    const r = await score()
    // a: 10 + 20 (never the benched 30). b: weekly slot, best two of 7/7/4.
    expect(r.points).toBe(round((await pts(30)) + (await pts(14, 'SG'))))
  })

  it('lock-in with no lock takes the last STARTED game', async () => {
    arrange({ sportConfig: { ...DAILY, gamesCountMode: 'lock_in' } })
    db.redraftDailyLineup.findMany.mockResolvedValue([
      { rosterId: 'r1', playerId: 'a', scoringDay: day('2026-10-20'), slotType: 'PG' },
      { rosterId: 'r1', playerId: 'a', scoringDay: day('2026-10-23'), slotType: 'BN' },
    ])
    const r = await score()
    // a's last STARTED game is g2 (the 22nd); his later game on the 24th fell on a bench day.
    expect(r.points).toBe(round((await pts(30)) + (await pts(4, 'SG'))))
  })

  it('all games in a daily league still never reads the new tables', async () => {
    arrange({ sportConfig: DAILY })
    await score()
    expect(db.playerWeekGameScore.findMany).not.toHaveBeenCalled()
  })
})

describe('the stat sync writes per-game rows for an opted-in league only', () => {
  beforeEach(() => {
    db.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' })
    db.playerIdentityMap.findFirst.mockResolvedValue(null)
    db.playerIdentityMap.findMany.mockResolvedValue([])
    db.playerWeeklyScore.upsert.mockResolvedValue({})
    db.playerWeekGameScore.upsert.mockResolvedValue({})
    db.playerWeekGameScore.deleteMany.mockResolvedValue({ count: 0 })
    db.sportsDataCache.findUnique.mockResolvedValue({ data: {} })
    db.sportsDataCache.findMany.mockResolvedValue([
      { cacheKey: 'NBA:rischedule:2026:2026-10-20', data: { games: [{ gameId: 'G-A', day: '2026-10-20', startTime: '2026-10-20T23:30:00.000Z', status: 'final' }] } },
    ])
    db.sportsPlayer.findFirst.mockResolvedValue(null)
    db.sportsGame.findMany.mockResolvedValue([])
    db.playerGameLogCache.findMany.mockResolvedValue([])
    db.exileWeeklyEntry.findMany.mockResolvedValue([])
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'roster-1' }])
    db.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'league-1', sport: 'NBA', season: 2026, currentWeek: 1 })
    db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'p1', sport: 'NBA', position: 'PG', team: 'BOS' }])
    db.playerGameStat.findMany.mockResolvedValue([
      { playerId: 'p1', gameId: 'G-A', providerGameId: 'G-A', gameDate: day('2026-10-20'), normalizedStatMap: { stats: { points: 20 } } },
      { playerId: 'p1', gameId: 'G-B', providerGameId: 'G-B', gameDate: day('2026-10-22'), normalizedStatMap: { stats: { points: 31 } } },
    ])
  })

  async function runSync(settings: unknown) {
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings })
    db.league.findUnique.mockResolvedValue({ platform: 'allfantasy', survivorMode: false, settings })
    const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
    return syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 1, actorId: 'admin-1' })
  }

  it('one row per game, stamped with the schedule start, beside the unchanged weekly roll-up', async () => {
    const summary = await runSync(LOCK)
    expect(db.playerWeeklyScore.upsert.mock.calls[0][0].create.stats).toMatchObject({ pts: 51 })
    expect(summary.weekGameScoresUpserted).toBe(2)
    const rows = db.playerWeekGameScore.upsert.mock.calls.map((c) => c[0].create)
    expect(rows.map((r) => [r.gameId, r.stats.pts, r.startTime?.toISOString() ?? null])).toEqual([
      ['G-A', 20, '2026-10-20T23:30:00.000Z'],
      ['G-B', 31, null],
    ])
    expect(db.playerWeekGameScore.deleteMany.mock.calls[0][0].where.gameId.notIn).toEqual(['G-A', 'G-B'])
  })

  it('fail safe: an opted-in league without the tables syncs as All games, with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      db.$queryRaw.mockResolvedValue([{ ok: false }])
      const summary = await runSync(LOCK)
      expect(db.playerWeeklyScore.upsert).toHaveBeenCalledTimes(1)
      expect(db.playerWeekGameScore.upsert).not.toHaveBeenCalled()
      expect(db.playerWeekGameScore.deleteMany).not.toHaveBeenCalled()
      expect(summary.weekGameScoresUpserted).toBeUndefined()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[games-count] stat sync'))
    } finally {
      warn.mockRestore()
    }
  })

  it('never touches the per-game table, the schedule, or the extra columns for an all-games league', async () => {
    const summary = await runSync(ALL)
    expect(db.playerWeeklyScore.upsert).toHaveBeenCalledTimes(1)
    expect(db.playerWeekGameScore.upsert).not.toHaveBeenCalled()
    expect(db.playerWeekGameScore.deleteMany).not.toHaveBeenCalled()
    expect(db.sportsDataCache.findMany).not.toHaveBeenCalled()
    expect(summary.weekGameScoresUpserted).toBeUndefined()
    expect(db.playerGameStat.findMany.mock.calls[0][0].select).not.toHaveProperty('gameId')
  })
})
