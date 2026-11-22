/**
 * NBA C2C campus scoring (lib/c2c/campusScoring.ts `campusBasketballPointsForMatchup`): each team's
 * campus starters score from the college basketball games played inside the NBA week's dates, read
 * from the NCAAB `player_game_stats` rows through the identity bridge, and are added to the pro score.
 * Plus the basketball seat rules (G / F / C / FLEX) and the lineup view's dates.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/season-week/deriveDailySportSeasonStart', () => ({ ensureDailySportSeasonStart: vi.fn(async () => ({})) }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({
  getC2CConfig: vi.fn(async () => ({ collegeActiveLineupSlots: { G: 2, F: 2, C: 1, FLEX: 2 } })),
}))

import { campusBasketballPointsForMatchup } from '@/lib/c2c/campusScoring'
import { campusSport, campusToggles, isBasketballC2CLeague, seatCampusPlayers, validateCampusLineup } from '@/lib/c2c/campusLineup'
import { checkCampusSave } from '@/lib/c2c/campusLineupCheck'
import { loadCampusLineupView } from '@/lib/c2c/campusLineupView'
import { buildLeagueStatScorer } from '@/lib/redraft/scoringEngine'
import { aggregateWeeklyStats, getDailySportNormalizer } from '@/lib/scoring-runtime/dailySportStatNormalization'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { CAMPUS_COPY } from '@/lib/i18n/c2c-campus-copy'

// Week 6 is inside the 2026-27 college season; NBA week 2 ends before college basketball's opener,
// so its college games would all read as exhibitions.
const WEEK = resolveDailySportWeekWindow('NBA', 2026, 6)!
const inWeek = (days: number) => new Date(WEEK.start.getTime() + days * 86_400_000)
const line = (points: number, rebounds = 0, assists = 0) => ({ points, total_rebounds: rebounds, assists })

/** What the college basketball defaults give these box lines, summed as the weekly sync sums them. */
const expected = (rows: unknown[], position: string) =>
  Math.round(buildLeagueStatScorer({ sport: 'NCAAB', settings: null })!(aggregateWeeklyStats(rows, getDailySportNormalizer('NCAAB')!).stats, position) * 100) / 100

function fakeDb(opts: { campusHome?: string[]; campusAway?: string[] } = {}) {
  return {
    roster: {
      findMany: vi.fn(async () => [
        { redraftRosterId: 'H', playerData: { lineup_sections: { devy: [{ id: '501' }, { id: '502' }], campus: opts.campusHome ?? ['501', '502'] } } },
        { redraftRosterId: 'A', playerData: { lineup_sections: { devy: [{ id: '601' }], campus: opts.campusAway ?? ['601'] } } },
      ]),
    },
    redraftRosterPlayer: {
      findMany: vi.fn(async () => [
        { rosterId: 'H', playerId: '501', position: 'PG', playerName: 'Campus Guard' },
        { rosterId: 'H', playerId: '502', position: 'C', playerName: 'Campus Center' },
        { rosterId: 'A', playerId: '601', position: 'SF', playerName: 'Away Wing' },
      ]),
    },
    // Rolling Insights ids → identity ids, the bridge every daily sport uses.
    playerIdentityMap: {
      findMany: vi.fn(async ({ where }: { where: { rollingInsightsId?: unknown; sleeperId?: unknown } }) =>
        where.rollingInsightsId
          ? [
              { id: 'idn-501', rollingInsightsId: '501', sleeperId: null },
              { id: 'idn-502', rollingInsightsId: '502', sleeperId: null },
              { id: 'idn-601', rollingInsightsId: '601', sleeperId: null },
            ]
          : [],
      ),
    },
    playerGameStat: {
      findMany: vi.fn(async ({ where }: { where: { gameDate: { gte: Date; lt: Date } } }) =>
        [
          { playerId: 'idn-501', normalizedStatMap: line(20, 4, 6), sportType: 'NCAAB', season: 2026, gameDate: inWeek(0) },
          { playerId: 'idn-501', normalizedStatMap: line(12, 2, 3), sportType: 'NCAAB', season: 2026, gameDate: inWeek(4) },
          // an exhibition inside the week does not count
          { playerId: 'idn-502', normalizedStatMap: { ...line(30, 15), seasonType: 'pre' }, sportType: 'NCAAB', season: 2026, gameDate: inWeek(1) },
          { playerId: 'idn-601', normalizedStatMap: line(9, 7, 1), sportType: 'NCAAB', season: 2026, gameDate: inWeek(6) },
          // the day after the week ends: the query's own window must leave it out
          { playerId: 'idn-601', normalizedStatMap: line(40), sportType: 'NCAAB', season: 2026, gameDate: inWeek(7) },
        ].filter((r) => r.gameDate >= where.gameDate.gte && r.gameDate < where.gameDate.lt),
      ),
    },
    sportsGame: { findMany: vi.fn(async () => []) },
    sportsDataCache: { findUnique: vi.fn(async () => null) },
  }
}

beforeEach(() => vi.clearAllMocks())

describe('NBA C2C campus points', () => {
  it('scores each campus starter from his college games inside the NBA week', async () => {
    const db = fakeDb()
    const r = (await campusBasketballPointsForMatchup(db as never, { season: 2026, week: 6, homeRosterId: 'H', awayRosterId: 'A' }))!
    expect(r.window).toEqual({ start: WEEK.start.toISOString(), end: WEEK.end.toISOString() })
    const guard = expected([line(20, 4, 6), line(12, 2, 3)], 'PG')
    const wing = expected([line(9, 7, 1)], 'SF')
    expect(guard).toBeGreaterThan(32) // points alone are 32
    expect(r.home.players).toEqual([{ playerId: '501', points: guard }, { playerId: '502', points: 0 }])
    expect(r.home.points).toBe(guard)
    expect(r.away).toEqual({ points: wing, players: [{ playerId: '601', points: wing }] })

    const query = db.playerGameStat.findMany.mock.calls[0]![0] as { where: Record<string, unknown> }
    expect(query.where).toEqual({
      playerId: { in: ['501', '502', '601', 'idn-501', 'idn-502', 'idn-601'] },
      sportType: { in: ['NCAAB', 'ncaab'] },
      gameDate: { gte: WEEK.start, lt: WEEK.end },
    })
  })

  it('null when neither team starts a college player; a stale campus id does not count', async () => {
    expect(await campusBasketballPointsForMatchup(fakeDb({ campusHome: [], campusAway: [] }) as never, { season: 2026, week: 6, homeRosterId: 'H', awayRosterId: 'A' })).toBeNull()
    const r = (await campusBasketballPointsForMatchup(fakeDb({ campusHome: ['gone'], campusAway: [] }) as never, { season: 2026, week: 6, homeRosterId: 'H', awayRosterId: 'A' }))!
    expect(r.home).toEqual({ points: 0, players: [] })
  })

  it('a week with no recorded dates scores 0 without querying games', async () => {
    const db = fakeDb()
    const r = (await campusBasketballPointsForMatchup(db as never, { season: 1999, week: 2, homeRosterId: 'H', awayRosterId: 'A' }))!
    expect(r.window).toBeNull()
    expect(r.home.points).toBe(0)
    expect(db.playerGameStat.findMany).not.toHaveBeenCalled()
  })
})

describe('basketball campus seats', () => {
  const seats = ['G', 'G', 'F', 'F', 'C', 'FLEX', 'FLEX']

  it('NBA C2C is a basketball campus league', () => {
    expect(campusSport({ leagueVariant: 'c2c', sport: 'NBA' })).toBe('basketball')
    expect(isBasketballC2CLeague({ leagueVariant: 'merged_devy_c2c', sport: 'NBA' })).toBe(true)
    expect(campusSport({ leagueVariant: 'c2c', sport: 'NHL' })).toBeNull()
    expect(campusSport({ leagueVariant: 'devy_dynasty', sport: 'NBA' })).toBeNull()
  })

  it('guards in G, wings in F, centers in C, anyone in FLEX; a combined position fits either half', () => {
    expect(seatCampusPlayers(['G', 'C'], ['PG', 'C'], 'basketball')).toBe(true)
    expect(seatCampusPlayers(['G', 'C'], ['PG', 'PG'], 'basketball')).toBe(false)
    expect(seatCampusPlayers(['G', 'FLEX'], ['PG', 'PG'], 'basketball')).toBe(true)
    expect(seatCampusPlayers(['F', 'C'], ['F-C', 'SF'], 'basketball')).toBe(true)
    expect(seatCampusPlayers(['G'], ['G-F'], 'basketball')).toBe(true)
    expect(seatCampusPlayers(seats, ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F'], 'basketball')).toBe(true)
    // football rules still apply to football: there is no G seat there
    expect(seatCampusPlayers(['FLEX'], ['PG'])).toBe(false)
  })

  it('the save check and the panel buttons use the basketball rules', async () => {
    const before = { lineup_sections: { devy: [{ id: 'g1' }, { id: 'c1' }] } }
    const after = (campus: string[]) => ({ lineup_sections: { devy: [{ id: 'g1' }, { id: 'c1' }], campus } })
    const pos: Record<string, string> = { g1: 'PG', c1: 'C' }
    expect(validateCampusLineup({ before, after: after(['g1', 'c1']), slots: { G: 1, C: 1 }, positionOf: (id) => pos[id], sport: 'basketball' })).toEqual([])
    expect(validateCampusLineup({ before, after: after(['g1', 'c1']), slots: { G: 2 }, positionOf: (id) => pos[id], sport: 'basketball' }).map((i) => i.code)).toEqual(['campus_ineligible'])

    const db = { redraftRosterPlayer: { findMany: vi.fn(async () => [{ playerId: 'g1', position: 'PG', playerName: 'G' }, { playerId: 'c1', position: 'C', playerName: 'C' }]) } }
    const league = { id: 'L1', platform: 'af', sport: 'NBA', leagueVariant: 'c2c' }
    expect(await checkCampusSave(db as never, { league, redraftRosterId: 'R1', before, after: after(['g1', 'c1']) })).toEqual([
      expect.objectContaining({ code: 'campus_ineligible', message: expect.stringContaining('schedule is unavailable') }),
    ])

    expect(campusToggles(['C'], [], [{ id: 'g1', position: 'PG' }, { id: 'c1', position: 'C' }], 'basketball')).toEqual([
      { playerId: 'g1', onCampus: false, canStart: false },
      { playerId: 'c1', onCampus: false, canStart: true },
    ])
  })
})

describe('the NBA C2C lineup view', () => {
  it('names the dates whose college games count this week', async () => {
    const db = {
      redraftRosterPlayer: { findMany: vi.fn(async () => [{ playerId: 'g1', playerName: 'Campus Guard', position: 'PG', team: 'Duke' }]) },
      redraftRoster: { findUnique: vi.fn(async () => ({ season: { season: 2026, currentWeek: 6 } })) },
      sportsGame: { findMany: vi.fn(async () => []) },
      sportsDataCache: { findUnique: vi.fn(async () => null) },
    }
    const view = await loadCampusLineupView(db as never, {
      league: { id: 'L1', platform: 'af', sport: 'NBA', leagueVariant: 'c2c' },
      playerData: { lineup_sections: { devy: [{ id: 'g1' }], campus: ['g1'] } },
      redraftRosterId: 'R1',
    })
    expect(view).toEqual({
      sport: 'basketball',
      seats: ['G', 'G', 'F', 'F', 'C', 'FLEX', 'FLEX'],
      starterIds: ['g1'],
      players: [{ id: 'g1', name: 'Campus Guard', position: 'PG', team: 'Duke' }],
      cfbWeeks: [],
      nflWeek: 6,
      window: { start: WEEK.start.toISOString(), end: WEEK.end.toISOString() },
    })
    expect(db.sportsGame.findMany).not.toHaveBeenCalled() // no college football weeks are looked up
  })

  it('has Spanish for the new lines, without «waiver»', () => {
    for (const k of ['dates', 'noDates'] as const) {
      expect(CAMPUS_COPY[k].es).toBeTruthy()
      expect(CAMPUS_COPY[k].es.toLowerCase()).not.toContain('waiver')
    }
  })
})
