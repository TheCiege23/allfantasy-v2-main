/**
 * The daily-sport points loader against a stubbed database shaped like production on 2026-10-09:
 * projection rows keyed on identity ids with per-game rates, a schedule whose upcoming games all carry a
 * NULL `seasonType`, identity rows carrying Rolling Insights ids, and rosters in that id space.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  projections: [] as Array<{ playerId: string; playerName: string; position: string; season: number; adjustmentFactors: unknown }>,
  games: [] as Array<{ homeTeam: string; awayTeam: string; seasonType: string | null; startTime: Date }>,
  identities: [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null }>,
  rosters: [] as Array<{ playerData: unknown }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    aFProjectionSnapshot: {
      findFirst: vi.fn(async () => (db.projections[0] ? { season: db.projections[0].season } : null)),
      findMany: vi.fn(async () => db.projections),
    },
    sportsGame: {
      findFirst: vi.fn(async () => (db.games.length ? { id: 'g' } : null)),
      findMany: vi.fn(async ({ where }: { where: { startTime: { gte: Date } } }) => db.games.filter((g) => g.startTime >= where.startTime.gte)),
    },
    playerIdentityMap: { findMany: vi.fn(async () => db.identities) },
    roster: { findMany: vi.fn(async () => db.rosters) },
  },
}))

import { loadSportPointsBase } from '@/lib/decision-os/trade/sportPointsContext'

const NOW = new Date('2026-10-20T12:00:00Z')

function nbaPlayer(id: string, name: string, position: string, rates: Record<string, number>, sample = 60) {
  db.projections.push({
    playerId: id, playerName: name, position, season: 2026,
    adjustmentFactors: { perGameRates: rates, confidenceReasons: [`${sample} games in the season sample`], sourceSeason: 2025 },
  })
  db.identities.push({ id, rollingInsightsId: `ri-${id}`, sleeperId: null })
}

function schedule(teams: string[], gamesEach: number, seasonType: string | null) {
  for (let i = 0; i < gamesEach; i++) {
    for (let t = 0; t < teams.length; t += 2) {
      db.games.push({ homeTeam: teams[t]!, awayTeam: teams[t + 1]!, seasonType, startTime: new Date(NOW.getTime() + (i + 1) * 86_400_000) })
    }
  }
}

beforeEach(() => {
  db.projections = []
  db.games = []
  db.identities = []
  db.rosters = []
})

describe('loadSportPointsBase', () => {
  it('counts upcoming games whose season type is NULL, and leaves out marked preseason games', async () => {
    nbaPlayer('a', 'Alpha', 'C', { points: 30, total_rebounds: 10 })
    nbaPlayer('b', 'Beta', 'PG', { points: 20, assists: 8 })
    schedule(['T1', 'T2', 'T3', 'T4'], 40, null)
    schedule(['T1', 'T2', 'T3', 'T4'], 3, 'preseason')
    const out = await loadSportPointsBase({ sport: 'NBA', league: null, now: NOW })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.ctx.window.gamesRemaining).toBe(40)
  })

  it('scores the projected line under the scoring rules and drops double-double bonuses', async () => {
    // 12 points and 10 rebounds a game: a double-double on the AVERAGE, not every night.
    nbaPlayer('a', 'Alpha', 'C', { points: 12, total_rebounds: 10 })
    nbaPlayer('b', 'Beta', 'C', { points: 5, total_rebounds: 2 })
    schedule(['T1', 'T2'], 10, null)
    const out = await loadSportPointsBase({ sport: 'NBA', league: null, now: NOW })
    if (!out.ok) throw new Error(out.reason)
    const alpha = out.ctx.board.find((p) => p.name === 'Alpha')!
    expect(alpha.perGame).toBeCloseTo(12 + 10 * 1.2, 5) // no +1.5 double-double
    expect(alpha.aliases).toEqual(['ri-a'])
    expect(out.ctx.window.baselineSeasonLabel).toBe('2025-26')
  })

  it('takes the waiver wire from the league rosters when they map onto the board', async () => {
    nbaPlayer('a', 'Alpha', 'C', { points: 40 })
    nbaPlayer('b', 'Beta', 'C', { points: 30 })
    nbaPlayer('c', 'Gamma', 'C', { points: 10 })
    schedule(['T1', 'T2'], 10, null)
    db.rosters = [{ playerData: { players: ['ri-a'] } }, { playerData: { players: ['ri-b'] } }]
    const out = await loadSportPointsBase({
      sport: 'NBA',
      league: { id: 'L1', settings: { scoring_mode: 'points' }, leagueType: 'redraft', leagueSize: 2 },
      now: NOW,
    })
    if (!out.ok) throw new Error(out.reason)
    expect(out.ctx.replacementByPosition.get('C')?.name).toBe('Gamma')
    expect(out.ctx.scoringBasis).toBe('league')
  })

  it('refuses a category league and a dynasty league before reading anything', async () => {
    const cat = await loadSportPointsBase({ sport: 'NBA', league: { id: 'L', settings: { scoring_mode: 'h2h_category' }, leagueType: 'redraft', leagueSize: 12 }, now: NOW })
    expect(cat).toMatchObject({ ok: false })
    const dyn = await loadSportPointsBase({ sport: 'NBA', league: { id: 'L', settings: {}, leagueType: 'dynasty', leagueSize: 12 }, now: NOW })
    expect(dyn).toMatchObject({ ok: false })
  })

  describe('category leagues', () => {
    // Same points, rebounds and assists; one makes his shots and protects the ball, the other does not.
    function categoryBoard() {
      const base = { points: 22, total_rebounds: 6, assists: 5, steals: 1, blocks: 0.5, three_points_made: 2 }
      nbaPlayer('eff', 'Efficient', 'SF', { ...base, field_goals_made: 9, field_goals_attempted: 16, free_throws_made: 4, free_throws_attempted: 4.5, turnovers: 1.5 })
      nbaPlayer('ineff', 'Inefficient', 'SF', { ...base, field_goals_made: 8, field_goals_attempted: 22, free_throws_made: 3, free_throws_attempted: 6, turnovers: 4 })
      nbaPlayer('mid', 'Middle', 'SF', { ...base, points: 15, field_goals_made: 6, field_goals_attempted: 13, free_throws_made: 2, free_throws_attempted: 2.6, turnovers: 2 })
      schedule(['T1', 'T2'], 10, null)
    }
    const NINE_CAT = { scoring_mode: 'h2h_category', category_preset_id: 'nba_9cat', category_record_mode: 'each' }

    it('values a league on its own stored 9-category preset', async () => {
      categoryBoard()
      const out = await loadSportPointsBase({ sport: 'NBA', league: { id: 'L', settings: NINE_CAT, leagueType: 'redraft', leagueSize: 12 }, now: NOW })
      if (!out.ok) throw new Error(out.reason)
      expect(out.ctx.valueKind).toBe('categories')
      expect(out.ctx.categoryList).toBe('PTS, REB, AST, STL, BLK, TO, FG%, FT% and 3PM')
      const value = (name: string) => out.ctx.board.find((p) => p.name === name)!.perGame
      // A points scorer could not tell these two apart; categories can.
      expect(value('Efficient')).toBeGreaterThan(value('Inefficient'))
    })

    it('scores the open analyzer on the category preset it was asked for, and on points by default', async () => {
      categoryBoard()
      const cats = await loadSportPointsBase({ sport: 'NBA', league: null, format: 'nba_9cat', now: NOW })
      if (!cats.ok) throw new Error(cats.reason)
      expect(cats.ctx.valueKind).toBe('categories')
      const points = await loadSportPointsBase({ sport: 'NBA', league: null, now: NOW })
      if (!points.ok) throw new Error(points.reason)
      expect(points.ctx.valueKind).toBe('points')
      expect(points.ctx.categoryList).toBeNull()
    })

    it('scores a league by its own settings even when the analyzer asked for categories', async () => {
      categoryBoard()
      const out = await loadSportPointsBase({ sport: 'NBA', league: { id: 'L', settings: { scoring_mode: 'points' }, leagueType: 'redraft', leagueSize: 12 }, format: 'nba_9cat', now: NOW })
      if (!out.ok) throw new Error(out.reason)
      expect(out.ctx.valueKind).toBe('points')
    })

    it('refuses categories for college basketball, whose feed carries no shot attempts', async () => {
      categoryBoard()
      const out = await loadSportPointsBase({ sport: 'NCAAB', league: null, format: 'nba_9cat', now: NOW })
      expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^Category grades are not available for NCAAB/) })
    })

    it('refuses a category league it cannot read rather than grading it on points', async () => {
      categoryBoard()
      const out = await loadSportPointsBase({ sport: 'NBA', league: { id: 'L', settings: { scoring_mode: 'roto', category_preset_id: 'nba_9cat', category_record_mode: 'roto' }, leagueType: 'redraft', leagueSize: 12 }, now: NOW })
      expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/category grades cover the standard 8- and 9-category head-to-head setups/) })
    })
  })

  it('says the schedule is missing rather than that the season is over', async () => {
    nbaPlayer('a', 'Alpha', 'C', { points: 30 })
    const out = await loadSportPointsBase({ sport: 'NBA', league: null, now: NOW })
    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/schedule is not on file/) })
  })

  it('pauses a board whose projections rest on a handful of games', async () => {
    for (let i = 0; i < 10; i++) nbaPlayer(`n${i}`, `Thin ${i}`, 'C', { goals: 1, assists: 1 }, 3)
    db.projections.forEach((p) => { p.adjustmentFactors = { ...(p.adjustmentFactors as object), sourceSeason: 2026 } })
    schedule(['T1', 'T2'], 10, null)
    const out = await loadSportPointsBase({ sport: 'NHL', league: null, now: NOW })
    expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^NHL projections are switching/) })
  })
})
