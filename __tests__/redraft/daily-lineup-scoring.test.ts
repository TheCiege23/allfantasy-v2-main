/**
 * Daily lineups, phases B and C (docs/DAILY_LINEUPS_DESIGN.md, lib/redraft/dailyLineups.ts).
 *
 * The owner's rules (2026-10-19): a daily-lineup league scores each Eastern day's starters on that
 * day's stats and sums the days; each player locks at his own game start; a player who has played
 * stays put for the rest of that day. These tests pin the scoring half — the lock half is
 * daily-lineup-lock.test.ts — and that every league NOT opted in scores exactly as before.
 *
 * NBA 2026 opens Tuesday 20 Oct, so week 1 is 20–26 Oct.
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
  redraftDailyLineup: { findMany: vi.fn() },
  redraftRoster: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
  sportsGame: { findMany: vi.fn() },
  sportsPlayer: { findFirst: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import {
  dailySlotFor,
  daysDecidedBySave,
  isDailyLineupScoringEnabled,
  writeDailyLineupForSave,
  type DailyLineups,
} from '@/lib/redraft/dailyLineups'
import { calculateScoreFromSportConfig, scoreRosterForWeek } from '@/lib/redraft/scoringEngine'

const DAILY_ON = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
const DAILY_REQUESTED_ONLY = { sportConfig: { lineupLockType: 'daily' } }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const WEEK1 = { start: day('2026-10-20'), end: day('2026-10-27') }

describe('the opt-in gate', () => {
  it('is on only for the real daily mode in a daily sport', () => {
    expect(isDailyLineupScoringEnabled(DAILY_ON, 'NBA')).toBe(true)
    expect(isDailyLineupScoringEnabled(DAILY_ON, 'MLB')).toBe(true)
    expect(isDailyLineupScoringEnabled(DAILY_REQUESTED_ONLY, 'NBA')).toBe(false)
    expect(isDailyLineupScoringEnabled(DAILY_ON, 'NFL')).toBe(false)
    expect(isDailyLineupScoringEnabled({}, 'NBA')).toBe(false)
    expect(isDailyLineupScoringEnabled(DAILY_ON, null)).toBe(false)
  })
})

describe('which days a save decides', () => {
  it('mid-week: today (Eastern) through the end of the week', () => {
    // 23:30 ET on Thu 22 Oct is already Fri 03:30 UTC — still Thursday's lineup.
    const days = daysDecidedBySave(WEEK1, new Date('2026-10-23T03:30:00.000Z'))
    expect(days.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
    ])
  })

  it('ahead of the week: every day of it', () => {
    expect(daysDecidedBySave(WEEK1, new Date('2026-10-15T12:00:00.000Z'))).toHaveLength(7)
  })

  it('a week already over: none', () => {
    expect(daysDecidedBySave(WEEK1, new Date('2026-10-28T12:00:00.000Z'))).toEqual([])
  })
})

describe('the slot a player held on a day', () => {
  const lineups: DailyLineups = new Map([
    ['r1', new Map([['p1', new Map([['2026-10-20', 'PG'], ['2026-10-22', 'BN']])]])],
  ])

  it('is that day\'s row, else the latest earlier row (carry-forward)', () => {
    expect(dailySlotFor(lineups, 'r1', 'p1', day('2026-10-20'))).toBe('PG')
    expect(dailySlotFor(lineups, 'r1', 'p1', day('2026-10-21'))).toBe('PG')
    expect(dailySlotFor(lineups, 'r1', 'p1', day('2026-10-22'))).toBe('BN')
    expect(dailySlotFor(lineups, 'r1', 'p1', day('2026-10-26'))).toBe('BN')
  })

  it('is unknown before the first row and for a player never saved', () => {
    expect(dailySlotFor(lineups, 'r1', 'p1', day('2026-10-19'))).toBeNull()
    expect(dailySlotFor(lineups, 'r1', 'nobody', day('2026-10-21'))).toBeNull()
  })
})

describe('writing a save', () => {
  function tx() {
    return {
      redraftRosterPlayer: {
        findMany: vi.fn(async () => [
          { playerId: 'p1', slotType: 'PG' },
          { playerId: 'p2', slotType: 'BN' },
        ]),
      },
      redraftDailyLineup: { deleteMany: vi.fn(async () => ({ count: 0 })), createMany: vi.fn(async () => ({ count: 0 })) },
    }
  }

  it('replaces the decided days with the roster\'s current slots', async () => {
    const t = tx()
    const r = await writeDailyLineupForSave(t as never, {
      leagueId: 'L1',
      redraftRosterId: 'r1',
      sport: 'NBA',
      season: 2026,
      week: 1,
      now: new Date('2026-10-24T16:00:00.000Z'), // Sat 24 Oct → 24, 25, 26
    })
    expect(r).toEqual({ days: 3, rows: 6 })
    expect(t.redraftDailyLineup.deleteMany).toHaveBeenCalledWith({
      where: { rosterId: 'r1', scoringDay: { gte: day('2026-10-24'), lte: day('2026-10-26') } },
    })
    const data = t.redraftDailyLineup.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>
    expect(data).toHaveLength(6)
    expect(data[0]).toMatchObject({ leagueId: 'L1', rosterId: 'r1', season: 2026, week: 1, playerId: 'p1', slotType: 'PG', source: 'user' })
  })

  it('refuses rather than leave an enabled league scored on the weekly lineup', async () => {
    const t = tx()
    await expect(
      writeDailyLineupForSave(t as never, { leagueId: 'L1', redraftRosterId: 'r1', sport: 'NBA', season: 1999, week: 1 }),
    ).rejects.toThrow(/no date window/)
    expect(t.redraftDailyLineup.createMany).not.toHaveBeenCalled()
  })
})

describe('scoring a daily-lineup week', () => {
  type Row = { playerId: string; position: string; slotType: string; addedAt: string }
  const ROSTER: Row[] = [
    // Started Tuesday, benched from Wednesday — when he scored 40.
    { playerId: 'benched', position: 'PG', slotType: 'BN', addedAt: '2026-10-01T00:00:00Z' },
    // Never named in a daily save: scored from his weekly slot.
    { playerId: 'weekly', position: 'SG', slotType: 'SG', addedAt: '2026-10-01T00:00:00Z' },
    // Picked up Thursday: his Wednesday game was for another team.
    { playerId: 'pickup', position: 'C', slotType: 'C', addedAt: '2026-10-22T15:00:00Z' },
  ]
  const DAILY_ROWS = [
    { rosterId: 'r1', playerId: 'benched', scoringDay: day('2026-10-20'), slotType: 'PG' },
    { rosterId: 'r1', playerId: 'benched', scoringDay: day('2026-10-21'), slotType: 'BN' },
  ]
  const STATS: Record<string, Array<[string, number]>> = {
    benched: [['2026-10-20', 10], ['2026-10-21', 40]],
    weekly: [['2026-10-23', 20]],
    pickup: [['2026-10-21', 30], ['2026-10-24', 5]],
  }

  function arrange(settings: unknown) {
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings })
    db.redraftRosterPlayer.findMany.mockResolvedValue(
      ROSTER.map((p) => ({ ...p, rosterId: 'r1', sport: 'NBA', playerName: p.playerId, droppedAt: null, addedAt: new Date(p.addedAt) })),
    )
    db.roster.findMany.mockResolvedValue([])
    db.afRosterLineupAssignment.findMany.mockResolvedValue([])
    db.redraftDailyLineup.findMany.mockResolvedValue(DAILY_ROWS)
    db.playerDailyScore.findMany.mockResolvedValue(
      Object.entries(STATS).flatMap(([playerId, days]) =>
        days.map(([d, pts]) => ({ playerId, scoringDay: day(d), stats: { pts }, isFinalized: false })),
      ),
    )
    db.playerWeeklyScore.findUnique.mockImplementation(async ({ where }: { where: { playerId_week_season_sport: { playerId: string } } }) => {
      const id = where.playerId_week_season_sport.playerId
      const total = (STATS[id] ?? []).reduce((s, [, p]) => s + p, 0)
      return { stats: { pts: total }, isFinalized: true }
    })
  }

  const pts = (n: number, position = 'PG') => calculateScoreFromSportConfig('L1', 'x', 1, { pts: n }, position)

  beforeEach(() => vi.clearAllMocks())

  it('counts each day only for the players who started THAT day', async () => {
    arrange(DAILY_ON)
    const expected = Math.round(((await pts(10)) + (await pts(20, 'SG')) + (await pts(5, 'C'))) * 100) / 100
    expect(expected).toBeGreaterThan(0)

    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })

    // Not the 40 he scored on the bench, and not the pickup's game from before he joined.
    expect(r.points).toBe(expected)
    expect(r.starterCount).toBe(3)
    expect(r.allFinal).toBe(true)
    expect(r.missingPlayerIds).toEqual([])
  })

  it('reports the bench days\' points separately when asked', async () => {
    arrange(DAILY_ON)
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026, includeBench: true })
    expect(r.benchPoints).toBe(Math.round((await pts(40)) * 100) / 100)
  })

  it('a starter the sync has not covered is missing, not zero', async () => {
    arrange(DAILY_ON)
    db.playerWeeklyScore.findUnique.mockResolvedValue(null)
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })
    expect(r.allFinal).toBe(false)
    expect(r.missingPlayerIds.sort()).toEqual(['benched', 'pickup', 'weekly'])
  })

  it('a league NOT opted in is scored on the weekly lineup and never reads the daily tables', async () => {
    arrange(DAILY_REQUESTED_ONLY)
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 1, seasonYear: 2026 })

    // Weekly rules: "benched" holds BN now, so he scores nothing; the other two score their whole week.
    const expected = Math.round(((await pts(20, 'SG')) + (await pts(35, 'C'))) * 100) / 100
    expect(r.points).toBe(expected)
    expect(db.redraftDailyLineup.findMany).not.toHaveBeenCalled()
    expect(db.playerDailyScore.findMany).not.toHaveBeenCalled()
  })
})

describe('the stat sync writes per-day rows for an opted-in league only', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.adminAuditLog.create.mockResolvedValue({ id: 'audit-1' })
    db.playerIdentityMap.findFirst.mockResolvedValue(null)
    db.playerIdentityMap.findMany.mockResolvedValue([])
    db.playerWeeklyScore.upsert.mockResolvedValue({})
    db.playerDailyScore.upsert.mockResolvedValue({})
    db.playerDailyScore.deleteMany.mockResolvedValue({ count: 0 })
    db.sportsPlayer.findFirst.mockResolvedValue(null)
    db.sportsGame.findMany.mockResolvedValue([])
    db.playerGameLogCache.findMany.mockResolvedValue([])
    db.exileWeeklyEntry.findMany.mockResolvedValue([])
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'roster-1' }])
    db.redraftSeason.findFirst.mockResolvedValue({ id: 'season-1', leagueId: 'league-1', sport: 'NBA', season: 2026, currentWeek: 1 })
    db.redraftRosterPlayer.findMany.mockResolvedValue([{ playerId: 'p1', sport: 'NBA', position: 'PG', team: 'BOS' }])
    db.playerGameStat.findMany.mockResolvedValue([
      { playerId: 'p1', gameDate: day('2026-10-20'), normalizedStatMap: { stats: { points: 20, rebounds: 5 } } },
      { playerId: 'p1', gameDate: day('2026-10-22'), normalizedStatMap: { stats: { points: 31, rebounds: 2 } } },
    ])
  })

  async function runSync(settings: unknown) {
    db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings })
    db.league.findUnique.mockResolvedValue({ platform: 'allfantasy', survivorMode: false, settings })
    const { syncPlayerWeeklyScoresForRedraftSeason } = await import('@/lib/redraft/playerWeeklyScoreService')
    return syncPlayerWeeklyScoresForRedraftSeason({ seasonId: 'season-1', week: 1, actorId: 'admin-1' })
  }

  it('one row per game day, beside the unchanged weekly roll-up', async () => {
    const summary = await runSync(DAILY_ON)

    expect(db.playerWeeklyScore.upsert.mock.calls[0][0].create.stats).toMatchObject({ pts: 51, reb: 7 })
    expect(summary.dailyScoresUpserted).toBe(2)
    const days = db.playerDailyScore.upsert.mock.calls.map((c) => ({
      day: c[0].create.scoringDay.toISOString().slice(0, 10),
      pts: c[0].create.stats.pts,
      gamesPlayed: c[0].create.gamesPlayed,
    }))
    expect(days).toEqual([
      { day: '2026-10-20', pts: 20, gamesPlayed: 1 },
      { day: '2026-10-22', pts: 31, gamesPlayed: 1 },
    ])
    // Days in the week with no game are cleared, so a re-dated game cannot keep scoring.
    expect(db.playerDailyScore.deleteMany.mock.calls[0][0].where.scoringDay.notIn).toHaveLength(2)
  })

  it('never touches the daily table for a league not opted in', async () => {
    const summary = await runSync(DAILY_REQUESTED_ONLY)
    expect(db.playerWeeklyScore.upsert).toHaveBeenCalledTimes(1)
    expect(db.playerDailyScore.upsert).not.toHaveBeenCalled()
    expect(db.playerDailyScore.deleteMany).not.toHaveBeenCalled()
    expect(summary.dailyScoresUpserted).toBeUndefined()
  })
})
