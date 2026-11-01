import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Odd-team native leagues, engine side: the bye rotation is fair, odd playoff fields seed byes to the
 * top seeds, standings rank by win percentage, and the team on a bye still plays the league median.
 */

const db = vi.hoisted(() => ({
  league: { findFirst: vi.fn() },
  redraftMatchup: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  redraftSeason: { findFirst: vi.fn(), findUnique: vi.fn() },
  redraftRoster: { findMany: vi.fn(), update: vi.fn() },
  redraftRosterPlayer: { findMany: vi.fn() },
  playerWeeklyScore: { findUnique: vi.fn() },
  roster: { findMany: vi.fn() },
  afRosterLineupAssignment: { findMany: vi.fn() },
  teamWeekResult: { findMany: vi.fn() },
  leagueTeam: { updateMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/devy/scoringEligibilityEngine', () => ({
  leagueUsesDevyEngine: vi.fn(async () => false),
  calculateOfficialTeamScore: vi.fn(),
}))
vi.mock('@/lib/c2c/scoringEngine', () => ({ leagueUsesC2CEngine: vi.fn(async () => false), updateC2CMatchupScores: vi.fn() }))
vi.mock('@/lib/events', () => ({ getPlatformEvents: () => ({ emit: vi.fn(async () => undefined) }), EVENT: {} }))
vi.mock('@/lib/sports-evidence/gates', () => ({ isSportsDataEnabled: () => false }))

import { generateSchedule } from '@/lib/redraft/scheduleEngine'
import { redraftPlayoffShapeFor } from '@/lib/league-defaults/redraftPlayoffFit'
import { MAX_PLAYOFF_TEAMS, firstRoundByesForTeams } from '@/lib/playoff-runtime/playoffFit'
import {
  buildNflRedraftPlayoffRuntimeState,
  generateNflRedraftPlayoffBracket,
} from '@/lib/playoff-runtime/canonicalNflRedraftPlayoffRuntime'
import { computeWeeklyMedianResults } from '@/lib/redraft/medianGame'
import { updateStandings } from '@/lib/redraft/standingsEngine'
import { updateMatchupScores } from '@/lib/redraft/scoringEngine'

const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const

describe('the bye rotation is fair across a full season', () => {
  for (const sport of SPORTS) {
    for (const teams of [5, 7, 9, 19]) {
      it(`${sport}, ${teams} teams: one bye a week, byes spread evenly, nobody plays twice in a week`, () => {
        const shape = redraftPlayoffShapeFor({ sport, leagueSize: teams })!
        expect(shape).not.toBeNull()
        const rosters = Array.from({ length: teams }, (_, i) => ({ id: `r${String(i + 1).padStart(2, '0')}` }))
        const slots = generateSchedule(rosters, shape.seasonWeeks, shape.playoffStartWeek, sport)
        const regularWeeks = shape.regularSeasonEndWeek
        expect(new Set(slots.map((s) => s.week)).size).toBe(regularWeeks)

        const byes = new Map(rosters.map((r) => [r.id, 0]))
        const games = new Map(rosters.map((r) => [r.id, 0]))
        for (let week = 1; week <= regularWeeks; week += 1) {
          const rows = slots.filter((s) => s.week === week)
          const seen = rows.flatMap((s) => (s.away ? [s.home, s.away] : [s.home]))
          expect(new Set(seen).size, `week ${week} has every team once`).toBe(teams)
          expect(seen.length).toBe(teams)
          const weekByes = rows.filter((s) => !s.away)
          expect(weekByes).toHaveLength(1)
          byes.set(weekByes[0]!.home, byes.get(weekByes[0]!.home)! + 1)
          for (const s of rows.filter((r) => r.away)) {
            games.set(s.home, games.get(s.home)! + 1)
            games.set(s.away!, games.get(s.away!)! + 1)
          }
        }
        const counts = [...byes.values()]
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1)
        // Byes are handed out in turn: after each full rotation of `teams` weeks, every team has had one.
        const fullCycles = Math.floor(regularWeeks / teams)
        expect(Math.min(...counts)).toBeGreaterThanOrEqual(fullCycles)
        for (const r of rosters) expect(games.get(r.id)! + byes.get(r.id)!).toBe(regularWeeks)
      })
    }
  }

  it('control: the fairness assertion catches a lopsided bye rotation', () => {
    const counts = [3, 1, 2, 2, 2]
    expect(Math.max(...counts) - Math.min(...counts)).toBeGreaterThan(1)
  })
})

function playoffTeams(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    rosterId: `r${i + 1}`,
    displayName: `Team ${i + 1}`,
    wins: 20 - i,
    losses: i,
    ties: 0,
    pointsFor: 2000 - i * 10,
    pointsAgainst: 1500,
  }))
}

describe('odd playoff fields seed first-round byes to the top seeds', () => {
  for (let field = 3; field <= 19; field += 2) {
    it(`a ${field}-team field`, () => {
      const leagueSize = Math.max(field, 4) + 1
      const state = buildNflRedraftPlayoffRuntimeState({
        leagueId: 'L1',
        seasonId: 's1',
        season: 2026,
        week: 15,
        rules: {
          playoffs: { teamCount: field, startWeek: 15, standingsTiebreakers: [] },
          schedule: { regularSeasonLength: 14 },
        } as never,
        teams: playoffTeams(leagueSize) as never,
      })
      if (field > MAX_PLAYOFF_TEAMS) {
        // The engine runs at most four rounds; the settings PATCH refuses these fields before they reach it.
        expect(state.settings.supported).toBe(false)
        return
      }
      expect(state.settings.supported).toBe(true)
      const byes = firstRoundByesForTeams(field)
      expect(state.settings.firstRoundByes).toBe(byes)
      const bracket = generateNflRedraftPlayoffBracket({ state })
      const round1 = bracket.bracket.rounds[0]!.matchups
      const byeSeeds = round1.filter((m) => m.bye).map((m) => m.homeSeed).sort((a, b) => a! - b!)
      expect(byeSeeds).toEqual(Array.from({ length: byes }, (_, i) => i + 1))
      const playing = round1.filter((m) => !m.bye && m.homeRosterId && m.awayRosterId)
      expect(playing).toHaveLength((field - byes) / 2)
      // Every seed in the field enters the bracket exactly once, and nobody outside it does.
      // (A bye slot keeps its empty seed number with no roster behind it, so count rosters, not numbers.)
      const entered = round1.flatMap((m) => [
        m.homeRosterId ? m.homeSeed : null,
        m.awayRosterId ? m.awaySeed : null,
      ]).filter((s): s is number => s != null)
      expect(entered.sort((a, b) => a - b)).toEqual(Array.from({ length: field }, (_, i) => i + 1))
      // Highest plays lowest among the teams without a bye.
      for (const m of playing) expect(m.homeSeed! + m.awaySeed!).toBe(byes + 1 + field)
    })
  }
})

describe('standings rank by win percentage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.redraftRoster.update.mockResolvedValue({})
    db.redraftMatchup.updateMany.mockResolvedValue({ count: 0 })
    db.redraftSeason.findUnique.mockResolvedValue({ leagueId: 'L1', medianGame: false, league: { medianGame: false, settings: {} } })
    db.league.findFirst.mockResolvedValue({ platform: 'sleeper' })
  })

  it('a team that played fewer games ranks on its record, not its win total', async () => {
    // B sat out three weeks on byes and is 2-0; A played every week and is 3-2. Counting wins put A first.
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'A' }, { id: 'B' }, { id: 'C' }, { id: 'D' }, { id: 'E' }])
    const game = (id: string, week: number, home: string, away: string | null, hs: number, as: number) =>
      ({ id, week, homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as, status: away ? 'final' : 'scheduled' })
    db.redraftMatchup.findMany.mockResolvedValue([
      game('1', 1, 'A', 'C', 100, 90), game('2', 1, 'B', 'E', 100, 90), game('3', 1, 'D', null, 0, 0),
      game('4', 2, 'A', 'D', 100, 90), game('5', 2, 'B', 'C', 100, 90), game('6', 2, 'E', null, 0, 0),
      game('7', 3, 'A', 'E', 100, 90), game('8', 3, 'C', 'D', 100, 90), game('9', 3, 'B', null, 0, 0),
      game('10', 4, 'C', 'A', 100, 90), game('11', 4, 'D', 'E', 100, 90), game('12', 4, 'B', null, 0, 0),
      game('13', 5, 'D', 'A', 100, 90), game('14', 5, 'C', 'E', 100, 90), game('15', 5, 'B', null, 0, 0),
    ])
    await updateStandings('s1', 5)
    const seeds = Object.fromEntries(db.redraftRoster.update.mock.calls.map(([a]) => [a.where.id, a.data.playoffSeed]))
    const recs = Object.fromEntries(db.redraftRoster.update.mock.calls.map(([a]) => [a.where.id, `${a.data.wins}-${a.data.losses}`]))
    expect(recs.A).toBe('3-2')
    expect(recs.B).toBe('2-0')
    expect(seeds.B).toBe(1)
    expect(seeds.A).toBeGreaterThan(1)
  })

  it('at an equal win % points for decides, not who played more games', async () => {
    // A is 2-1 (.667) with more points; B is 4-2 (.667) after A's byes. Wins used to rank B first,
    // while the bracket seeds by win %, then points for.
    db.redraftRoster.findMany.mockResolvedValue([{ id: 'A' }, { id: 'B' }, { id: 'C' }])
    const game = (id: string, week: number, home: string, away: string | null, hs: number, as: number) =>
      ({ id, week, homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as, status: away ? 'final' : 'scheduled' })
    db.redraftMatchup.findMany.mockResolvedValue([
      game('1', 1, 'A', 'B', 300, 90), game('2', 2, 'A', 'C', 300, 90), game('3', 3, 'C', 'A', 300, 100),
      game('4', 4, 'B', 'C', 100, 90), game('5', 5, 'B', 'C', 100, 90), game('6', 6, 'B', 'C', 100, 90),
      game('7', 7, 'B', 'C', 100, 90), game('8', 8, 'C', 'B', 100, 90),
      game('9', 4, 'A', null, 0, 0), game('10', 5, 'A', null, 0, 0), game('11', 6, 'A', null, 0, 0), game('12', 7, 'A', null, 0, 0),
    ])
    await updateStandings('s1', 8)
    const seeds = Object.fromEntries(db.redraftRoster.update.mock.calls.map(([a]) => [a.where.id, a.data.playoffSeed]))
    const recs = Object.fromEntries(db.redraftRoster.update.mock.calls.map(([a]) => [a.where.id, `${a.data.wins}-${a.data.losses}`]))
    expect(recs).toMatchObject({ A: '2-1', B: '4-2' })
    expect(seeds).toMatchObject({ A: 1, B: 2 })
  })
})

describe('the team on a bye still plays the league median', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.redraftMatchup.update.mockResolvedValue({})
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL', medianGame: true })
    db.roster.findMany.mockResolvedValue([])
    db.afRosterLineupAssignment.findMany.mockResolvedValue([])
    db.redraftRosterPlayer.findMany.mockResolvedValue([
      { playerId: 'w1', position: 'WR', slotType: 'WR', rosterId: 'bye-team', sport: 'NFL', playerName: 'w1', droppedAt: null },
    ])
    db.playerWeeklyScore.findUnique.mockResolvedValue({ stats: { rec_yds: 100 }, isFinalized: true })
    db.redraftMatchup.findFirst.mockResolvedValue({
      id: 'bye-row', leagueId: 'L1', seasonId: 's1', week: 4, homeRosterId: 'bye-team', awayRosterId: null,
      homeRoster: {}, homeScore: 0, awayScore: 0, lineupSnapshots: null,
    })
  })

  it('scores the bye row when league median is on', async () => {
    db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: {}, medianGame: true })
    expect(await updateMatchupScores('bye-row')).toBeNull()
    expect(db.redraftMatchup.update).toHaveBeenCalledTimes(1)
    const data = db.redraftMatchup.update.mock.calls[0]![0].data
    expect(data.homeScore).toBeGreaterThan(0)
    expect(data.status).toBe('final')
    expect(data.lineupSnapshots.redraftScoring.bye).toBe(true)
  })

  it('leaves the bye row alone without league median', async () => {
    db.league.findFirst.mockResolvedValue({ sport: 'NFL', settings: {}, medianGame: false })
    db.redraftSeason.findFirst.mockResolvedValue({ id: 's1', season: 2026, sport: 'NFL', medianGame: false })
    expect(await updateMatchupScores('bye-row')).toBeNull()
    expect(db.redraftMatchup.update).not.toHaveBeenCalled()
  })

  it('a scored bye row gives the bye team its median result', () => {
    const results = computeWeeklyMedianResults([
      { week: 4, homeRosterId: 'a', awayRosterId: 'b', homeScore: 100, awayScore: 80, status: 'final' },
      { week: 4, homeRosterId: 'c', awayRosterId: 'd', homeScore: 90, awayScore: 70, status: 'final' },
      { week: 4, homeRosterId: 'bye-team', awayRosterId: null, homeScore: 120, awayScore: 0, status: 'final' },
    ])
    expect(results[0]!.median).toBe(90)
    expect(results[0]!.outcomes.get('bye-team')).toBe('W')
    expect(results[0]!.outcomes.size).toBe(5)
  })
})
