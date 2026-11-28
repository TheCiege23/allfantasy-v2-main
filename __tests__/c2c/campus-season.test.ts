import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * C2C "separate" standings (owner's decision, 2026-11-24): the college side plays its own schedule on
 * college weeks, keeps its own record and standings (median included), its own playoff and champion,
 * plus an overall title for the best combined finish.
 */

const { campusPointsForCfbWeek, getC2CConfig } = vi.hoisted(() => ({
  campusPointsForCfbWeek: vi.fn(),
  getC2CConfig: vi.fn(async () => ({ standingsModel: 'separate' })),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/c2c/campusScoring', () => ({ campusPointsForCfbWeek }))
vi.mock('@/lib/merged-devy-c2c/C2CLeagueConfig', () => ({ getC2CConfig }))
vi.mock('@/lib/league/divisions/loadLeagueDivisions', () => ({ loadSeasonRosterDivisions: vi.fn(async () => null) }))

import {
  campusBracketRound,
  campusPlayoffWinner,
  computeCampusStandings,
  overallTitleStandings,
  readCampusSeasonShape,
  type CampusGame,
} from '@/lib/c2c/campusSeason/campusSeasonRules'
import { runCampusSeasonTick } from '@/lib/c2c/campusSeason/runCampusSeason'

const g = (week: number, home: string, away: string | null, hs: number, as: number, status = 'final', kind = away ? 'regular' : 'bye'): CampusGame => ({ week, homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as, status, kind })

describe('readCampusSeasonShape', () => {
  it('defaults to Cream Bowl: ten regular weeks and a six-team, three-round playoff', () => {
    expect(readCampusSeasonShape({}, 12)).toEqual({ regularSeasonWeeks: 10, playoffTeams: 6, playoffRounds: 3, lastWeek: 13 })
  })
  it('reads the commissioner’s settings and keeps the playoff inside the league', () => {
    expect(readCampusSeasonShape({ c2c_college_regular_weeks: 8, c2c_college_playoff_teams: 4 }, 12)).toMatchObject({ regularSeasonWeeks: 8, playoffTeams: 4, lastWeek: 10 })
    expect(readCampusSeasonShape({ c2c_college_playoff_teams: 20 }, 6).playoffTeams).toBe(6)
    expect(readCampusSeasonShape({ c2c_college_playoff_teams: 0 }, 12)).toMatchObject({ playoffTeams: 0, playoffRounds: 0, lastWeek: 10 })
  })
})

describe('computeCampusStandings', () => {
  it('counts wins, losses, ties and points; only final regular-season games count', () => {
    const rows = computeCampusStandings({
      rosterIds: ['a', 'b', 'c', 'd'],
      medianGame: false,
      games: [g(1, 'a', 'b', 30, 20), g(1, 'c', 'd', 10, 10), g(2, 'a', 'c', 5, 40), g(2, 'b', 'd', 0, 0, 'active'), g(11, 'a', 'c', 99, 0, 'final', 'playoff')],
    })
    const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]))
    expect(by.a).toMatchObject({ wins: 1, losses: 1, ties: 0, pointsFor: 35, pointsAgainst: 60 })
    expect(by.c).toMatchObject({ wins: 1, losses: 0, ties: 1, pointsFor: 50 })
    expect(by.d).toMatchObject({ ties: 1, pointsFor: 10 })
    expect(rows[0]!.rosterId).toBe('c')
  })

  it('adds the median game as a second result each week', () => {
    const rows = computeCampusStandings({ rosterIds: ['a', 'b', 'c', 'd'], medianGame: true, games: [g(1, 'a', 'b', 40, 30), g(1, 'c', 'd', 20, 10)] })
    const by = Object.fromEntries(rows.map((r) => [r.rosterId, r]))
    expect(by.a).toMatchObject({ wins: 1, medianWins: 1 })
    expect(by.b).toMatchObject({ losses: 1, medianWins: 1 })
    expect(by.c).toMatchObject({ wins: 1, medianLosses: 1 })
  })

  it('a team playing several games in a week counts its points once', () => {
    const rows = computeCampusStandings({ rosterIds: ['a', 'b', 'c'], medianGame: false, games: [g(1, 'a', 'b', 50, 20), g(1, 'a', 'c', 50, 60)] })
    const a = rows.find((r) => r.rosterId === 'a')!
    expect(a).toMatchObject({ wins: 1, losses: 1, pointsFor: 50, pointsAgainst: 80 })
  })
})

describe('the college playoff', () => {
  const seeded = ['s1', 's2', 's3', 's4', 's5', 's6']
  it('six teams: the top two rest in round one, 3 v 6 and 4 v 5 play', () => {
    expect(campusBracketRound({ round: 1, seeded, alive: seeded })).toEqual([
      { homeRosterId: 's1', awayRosterId: null, bracketSlot: 1 },
      { homeRosterId: 's2', awayRosterId: null, bracketSlot: 2 },
      { homeRosterId: 's3', awayRosterId: 's6', bracketSlot: 3 },
      { homeRosterId: 's4', awayRosterId: 's5', bracketSlot: 4 },
    ])
  })
  it('re-seeds each round: the best seed left plays the worst', () => {
    expect(campusBracketRound({ round: 2, seeded, alive: ['s5', 's2', 's1', 's3'] }).map((x) => [x.homeRosterId, x.awayRosterId])).toEqual([['s1', 's5'], ['s2', 's3']])
  })
  it('a tied playoff game goes to the better seed; a bye advances', () => {
    expect(campusPlayoffWinner(g(12, 's4', 's1', 10, 10, 'final', 'playoff'), seeded)).toBe('s1')
    expect(campusPlayoffWinner(g(12, 's4', 's1', 11, 10, 'final', 'playoff'), seeded)).toBe('s4')
    expect(campusPlayoffWinner(g(11, 's2', null, 0, 0, 'final', 'playoff'), seeded)).toBe('s2')
  })
})

describe('overallTitleStandings', () => {
  it('adds both sides’ records, median results included, then points', () => {
    const rows = overallTitleStandings({
      pro: [{ rosterId: 'a', wins: 5, losses: 5, ties: 0, pointsFor: 1000 }, { rosterId: 'b', wins: 7, losses: 3, ties: 0, pointsFor: 900 }],
      college: [
        { rosterId: 'a', wins: 8, losses: 2, ties: 0, medianWins: 6, medianLosses: 4, medianTies: 0, pointsFor: 500, pointsAgainst: 0, rank: 1 },
        { rosterId: 'b', wins: 4, losses: 6, ties: 0, medianWins: 5, medianLosses: 5, medianTies: 0, pointsFor: 400, pointsAgainst: 0, rank: 2 },
      ],
    })
    expect(rows.map((r) => [r.rosterId, r.wins, r.losses])).toEqual([['a', 19, 11], ['b', 16, 14]])
  })
})

/* ---------- A full college season through the runner, on an in-memory database ---------- */

type Row = Record<string, any>
function fakeDb(opts: { teams: number; settings: Record<string, unknown>; variant?: string | null; leagueType?: string }) {
  const rosters = Array.from({ length: opts.teams }, (_, i) => ({ id: `r${i + 1}`, ownerId: `u${i + 1}` }))
  const seasons: Row[] = []
  const matchups: Row[] = []
  const standings: Row[] = []
  let n = 0
  const id = () => `id${++n}`
  // College weeks 1..20: week k kicks off Saturday Sept 5 + 7(k-1), last game that evening.
  const sat = (k: number) => Date.UTC(2026, 8, 5 + 7 * (k - 1), 16)
  const cfbGames = Array.from({ length: 20 }, (_, i) => [
    { week: i + 1, startTime: new Date(sat(i + 1)) },
    { week: i + 1, startTime: new Date(sat(i + 1) + 8 * 3600_000) },
  ]).flat()
  const where = (m: Row, w: Row = {}) => Object.entries(w).every(([k, v]) => (v && typeof v === 'object' && 'not' in v ? m[k] !== v.not : m[k] === v))
  return {
    sat,
    matchups,
    standings,
    seasons,
    db: {
      league: { findUnique: async () => ({ id: 'L1', platform: 'af', sport: 'NFL', leagueVariant: opts.variant === undefined ? 'c2c' : opts.variant, leagueType: opts.leagueType ?? 'c2c', settings: opts.settings }) },
      redraftSeason: { findFirst: async () => ({ id: 'S1', season: 2026, medianGame: false }) },
      redraftRoster: { findMany: async () => rosters },
      sportsGame: { findMany: async ({ where: w }: Row) => (w.sport === 'NCAAF' ? cfbGames : []) },
      c2CCampusSeason: {
        findUnique: async ({ where: w }: Row) => seasons.find((s) => s.leagueId === w.leagueId_season.leagueId && s.season === w.leagueId_season.season) ?? null,
        create: async ({ data }: Row) => {
          const s = { id: id(), status: 'regular', championRosterId: null, ...data, matchups: undefined }
          seasons.push(s)
          for (const m of data.matchups.create) matchups.push({ id: id(), campusSeasonId: s.id, homeScore: 0, awayScore: 0, status: 'scheduled', playoffRound: null, bracketSlot: null, ...m })
          return s
        },
        update: async ({ where: w, data }: Row) => Object.assign(seasons.find((s) => s.id === w.id)!, data),
      },
      c2CCampusMatchup: {
        findMany: async ({ where: w }: Row) => matchups.filter((m) => where(m, w)).sort((a, b) => a.week - b.week),
        update: async ({ where: w, data }: Row) => Object.assign(matchups.find((m) => m.id === w.id)!, data),
        createMany: async ({ data }: Row) => { for (const m of data) matchups.push({ id: id(), homeScore: 0, awayScore: 0, ...m }) },
      },
      c2CCampusStanding: {
        upsert: async ({ where: w, create, update }: Row) => {
          const key = w.campusSeasonId_rosterId
          const row = standings.find((s) => s.campusSeasonId === key.campusSeasonId && s.rosterId === key.rosterId)
          if (row) Object.assign(row, update)
          else standings.push({ ...create })
        },
      },
    },
  }
}

describe('runCampusSeasonTick: a whole college season', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getC2CConfig.mockResolvedValue({ standingsModel: 'separate' })
    // Higher-numbered teams score more, so the result is predictable: r6 is the best team.
    campusPointsForCfbWeek.mockImplementation(async (_db: unknown, { homeRosterId, awayRosterId }: { homeRosterId: string; awayRosterId: string }) => ({
      cfbWeeks: [1],
      home: { points: Number(homeRosterId.slice(1)) * 10, players: [] },
      away: { points: Number(awayRosterId.slice(1)) * 10, players: [] },
    }))
  })

  it('schedules, scores, seals, seeds, plays the bracket and crowns a college champion', async () => {
    const f = fakeDb({ teams: 6, settings: { c2c_college_regular_weeks: 3, c2c_college_playoff_teams: 4 } })
    const tick = (at: number) => runCampusSeasonTick('L1', { db: f.db as never, now: new Date(at) })

    // Before the season: created with a three-week schedule, nothing scored.
    const first = await tick(f.sat(1) - 86400_000)
    expect(first).toMatchObject({ status: 'ok', created: true, weeksScored: [] })
    expect(new Set(f.matchups.map((m) => m.week))).toEqual(new Set([1, 2, 3]))
    expect(f.matchups.filter((m) => m.week === 1)).toHaveLength(3)

    // Mid-game Saturday: week 1 is live, not sealed.
    await tick(f.sat(1) + 3600_000)
    expect(f.matchups.filter((m) => m.week === 1).every((m) => m.status === 'active')).toBe(true)

    // Run the clock week by week to the end of the college season.
    for (let k = 1; k <= 8; k++) await tick(f.sat(k) + 3 * 86400_000)

    const season = f.seasons[0]!
    expect(season.status).toBe('complete')
    expect(season.championRosterId).toBe('r6')
    const seeds = f.standings.filter((s) => s.seed != null).sort((a, b) => a.seed - b.seed).map((s) => s.rosterId)
    expect(seeds).toHaveLength(4)
    expect(seeds[0]).toBe('r6')
    // Four teams: two playoff rounds, in weeks 4 and 5.
    expect(new Set(f.matchups.filter((m) => m.kind === 'playoff').map((m) => m.week))).toEqual(new Set([4, 5]))
    // The college lineup scored from each college week itself.
    expect(campusPointsForCfbWeek).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ season: 2026, cfbWeek: 2 }))
  })

  it('does nothing for a league on combined scoring', async () => {
    getC2CConfig.mockResolvedValue({ standingsModel: 'unified' })
    const f = fakeDb({ teams: 4, settings: {} })
    await expect(runCampusSeasonTick('L1', { db: f.db as never })).resolves.toEqual({ status: 'skipped', reason: 'standings model is not separate' })
    expect(f.seasons).toHaveLength(0)
  })

  it('a wizard-made devy league with college scoring plays its own college season, whatever the C2C config says', async () => {
    getC2CConfig.mockResolvedValue({ standingsModel: 'unified' })
    const f = fakeDb({ teams: 4, variant: null, leagueType: 'devy', settings: { devy_college_scoring: true, c2c_college_regular_weeks: 2, c2c_college_playoff_teams: 2 } })
    for (let k = 1; k <= 4; k++) await runCampusSeasonTick('L1', { db: f.db as never, now: new Date(f.sat(k) + 3 * 86400_000) })
    expect(f.seasons[0]).toMatchObject({ status: 'complete', championRosterId: 'r4' })
    expect(getC2CConfig).not.toHaveBeenCalled()
  })

  it('turned on mid-season, the college schedule starts with the next college week', async () => {
    const f = fakeDb({ teams: 4, settings: { c2c_college_regular_weeks: 5, c2c_college_playoff_teams: 0 } })
    await runCampusSeasonTick('L1', { db: f.db as never, now: new Date(f.sat(3) + 3 * 86400_000) })
    expect(new Set(f.matchups.map((m) => m.week))).toEqual(new Set([4, 5]))
    expect(campusPointsForCfbWeek).not.toHaveBeenCalled() // no week already played is scored
  })

  it('turned on after the college regular season, it waits for next season', async () => {
    const f = fakeDb({ teams: 4, settings: { c2c_college_regular_weeks: 3 } })
    await expect(runCampusSeasonTick('L1', { db: f.db as never, now: new Date(f.sat(5)) })).resolves.toMatchObject({ status: 'skipped' })
    expect(f.seasons).toHaveLength(0)
  })

  it('a stash-only devy league has no college season', async () => {
    const f = fakeDb({ teams: 4, variant: null, leagueType: 'devy', settings: {} })
    await expect(runCampusSeasonTick('L1', { db: f.db as never })).resolves.toMatchObject({ status: 'skipped' })
    expect(f.seasons).toHaveLength(0)
  })

  it('with no college playoff, the regular-season leader is the college champion', async () => {
    const f = fakeDb({ teams: 4, settings: { c2c_college_regular_weeks: 2, c2c_college_playoff_teams: 0 } })
    for (let k = 1; k <= 3; k++) await runCampusSeasonTick('L1', { db: f.db as never, now: new Date(f.sat(k) + 3 * 86400_000) })
    expect(f.seasons[0]).toMatchObject({ status: 'complete', championRosterId: 'r4' })
  })
})
