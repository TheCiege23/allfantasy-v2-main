/**
 * Games limits inside daily-lineup matchup scoring (lib/redraft/scoringEngine.ts → applyDailyGamesLimits).
 *
 * NBA 2026 opens Tuesday 20 Oct: week 1 is 20–26 Oct, week 2 is 27 Oct – 2 Nov. One PG starts every day
 * he plays; his games are 20, 22, 24 Oct (week 1) and 27, 29 Oct (week 2), 10 points each. Season-to-date
 * cap usage is recomputed from the stored per-day rows — nothing is persisted for it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  playerDailyScore: { findMany: vi.fn() },
  redraftDailyLineup: { findMany: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
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

const DAILY_ON = { sportConfig: { lineupLockType: 'daily', dailyLineupsEnabled: true } }
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const GAMES = ['2026-10-20', '2026-10-22', '2026-10-24', '2026-10-27', '2026-10-29']

type Range = { gte?: Date; lt?: Date }
const inRange = (d: Date, r: Range | undefined) =>
  (!r?.gte || d.getTime() >= r.gte.getTime()) && (!r?.lt || d.getTime() < r.lt.getTime())

function arrange(settings: unknown) {
  db.league.findFirst.mockResolvedValue({ sport: 'NBA', settings })
  db.redraftRosterPlayer.findMany.mockResolvedValue([
    { playerId: 'p1', rosterId: 'r1', sport: 'NBA', position: 'PG', slotType: 'PG', playerName: 'p1', droppedAt: null, addedAt: day('2026-10-01') },
    { playerId: 'c1', rosterId: 'r1', sport: 'NBA', position: 'C', slotType: 'C', playerName: 'c1', droppedAt: null, addedAt: day('2026-10-01') },
  ])
  db.roster.findMany.mockResolvedValue([])
  db.afRosterLineupAssignment.findMany.mockResolvedValue([])
  db.redraftDailyLineup.findMany.mockResolvedValue([])
  const rows = [
    ...GAMES.map((d) => ({ playerId: 'p1', scoringDay: day(d), stats: { pts: 10 }, gamesPlayed: 1, isFinalized: true })),
    { playerId: 'c1', scoringDay: day('2026-10-28'), stats: { pts: 7 }, gamesPlayed: 1, isFinalized: true },
  ]
  db.playerDailyScore.findMany.mockImplementation(async ({ where }: { where: { playerId: { in: string[] }; scoringDay: Range } }) =>
    rows.filter((r) => where.playerId.in.includes(r.playerId) && inRange(r.scoringDay, where.scoringDay)),
  )
  db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: {}, isFinalized: true })
}

const pts = (n: number, position = 'PG') => calculateScoreFromSportConfig('L1', 'x', 2, { pts: n }, position)
const round = (n: number) => Math.round(n * 100) / 100

beforeEach(() => vi.clearAllMocks())

describe('the default leaves scoring byte-identical', () => {
  it('no games_limits key, and games_limits: null, score exactly the same summary with no limits field', async () => {
    arrange(DAILY_ON)
    const before = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    arrange({ ...DAILY_ON, games_limits: null })
    const withNull = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    expect(withNull).toEqual(before)
    expect(JSON.stringify(withNull)).toBe(JSON.stringify(before))
    expect(before).not.toHaveProperty('gamesLimits')
    expect(await pts(10)).toBeGreaterThan(0)
    expect(before.points).toBe(round((await pts(10)) + (await pts(7, 'C')) + (await pts(10))))
  })

  it('a cap that does not bite leaves the points identical and only adds the usage summary', async () => {
    arrange(DAILY_ON)
    const before = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    arrange({ ...DAILY_ON, games_limits: { gamesPlayedCaps: { PG: 82 } } })
    const after = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    const { gamesLimits, ...rest } = after
    expect(rest).toEqual(before)
    expect(gamesLimits).toEqual({ caps: [{ slot: 'PG', used: 5, cap: 82 }] })
  })
})

describe('a games-played cap counts the season so far from stored rows', () => {
  it('cap 3: three week-1 games use it up, so both week-2 PG games score 0 (the C is untouched)', async () => {
    arrange({ ...DAILY_ON, games_limits: { gamesPlayedCaps: { PG: 3 } } })
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    expect(r.points).toBe(round(await pts(7, 'C')))
    expect(r.gamesLimits).toEqual({ caps: [{ slot: 'PG', used: 3, cap: 3 }] })
  })

  it('only starting-lineup games use the cap: two week-1 games on the bench add nothing (owner, 2026-10-25)', async () => {
    arrange({ ...DAILY_ON, games_limits: { gamesPlayedCaps: { PG: 3 } } })
    db.redraftDailyLineup.findMany.mockResolvedValue([
      { rosterId: 'r1', playerId: 'p1', scoringDay: day('2026-10-20'), slotType: 'BN' },
      { rosterId: 'r1', playerId: 'p1', scoringDay: day('2026-10-22'), slotType: 'BN' },
      { rosterId: 'r1', playerId: 'p1', scoringDay: day('2026-10-24'), slotType: 'PG' },
    ])
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    // Week 1 used 1 (24 Oct); 27 and 29 Oct both count and reach the cap of 3.
    expect(r.points).toBe(round((await pts(10)) + (await pts(7, 'C')) + (await pts(10))))
    expect(r.gamesLimits?.caps).toEqual([{ slot: 'PG', used: 3, cap: 3 }])
  })

  it('cap 4: 27 Oct is the day that reaches it and counts; 29 Oct does not', async () => {
    arrange({ ...DAILY_ON, games_limits: { gamesPlayedCaps: { PG: 4 } } })
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    expect(r.points).toBe(round((await pts(10)) + (await pts(7, 'C'))))
    expect(r.gamesLimits?.caps).toEqual([{ slot: 'PG', used: 4, cap: 4 }])
  })

  it('a league not on daily lineups ignores a stored games_limits and never reads the daily tables', async () => {
    arrange({ sportConfig: { lineupLockType: 'daily' }, games_limits: { gamesPlayedCaps: { PG: 1 } } })
    db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: { pts: 20 }, isFinalized: true })
    const r = await scoreRosterForWeek({ leagueId: 'L1', rosterId: 'r1', week: 2, seasonYear: 2026 })
    expect(r).not.toHaveProperty('gamesLimits')
    expect(r.points).toBe(round((await pts(20)) + (await pts(20, 'C'))))
    expect(db.playerDailyScore.findMany).not.toHaveBeenCalled()
  })
})
