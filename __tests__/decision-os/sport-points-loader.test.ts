/**
 * The daily-sport points loader against a stubbed database shaped like production on 2026-10-09:
 * projection rows keyed on identity ids with per-game rates, a schedule whose upcoming games all carry a
 * NULL `seasonType`, identity rows carrying Rolling Insights ids, and rosters in that id space.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  projections: [] as Array<{ playerId: string; playerName: string; position: string; season: number; adjustmentFactors: unknown }>,
  games: [] as Array<{ homeTeam: string; awayTeam: string; seasonType: string | null; startTime: Date }>,
  identities: [] as Array<{ id: string; rollingInsightsId: string | null; sleeperId: string | null; canonicalName?: string }>,
  rosters: [] as Array<{ playerData: unknown }>,
  // Soccer's per-match rows (`player_game_stats`), both seasons.
  matchRows: [] as Array<{ playerId: string; season: number; team: string; gameId: string; gameDate: Date; normalizedStatMap: unknown }>,
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
    playerGameStat: {
      findFirst: vi.fn(async () => (db.matchRows.length ? { season: Math.max(...db.matchRows.map((r) => r.season)) } : null)),
      findMany: vi.fn(async ({ where }: { where: { season: number } }) => db.matchRows.filter((r) => r.season === where.season)),
    },
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
  db.matchRows = []
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

  describe('soccer', () => {
    const GROUP: Record<string, string> = { Goalkeeper: 'goalkeepers' }
    // One player's matches: `apps` of `clubMatches`, each with the given per-match stats.
    function soccerPlayer(id: string, position: string, season: number, team: string, apps: number, stats: Record<string, number>, clubMatches = apps) {
      for (let m = 0; m < clubMatches; m++) {
        db.matchRows.push({
          playerId: id, season, team, gameId: `${season}-${team}-${m}:${GROUP[position] ?? 'fielders'}`,
          gameDate: new Date(Date.UTC(season, 8, 1 + m)),
          normalizedStatMap: { group: GROUP[position] ?? 'fielders', position, stats: { minutes_played: m < apps ? 90 : 0, ...(m < apps ? stats : {}) } },
        })
      }
      if (!db.identities.some((i) => i.id === id)) db.identities.push({ id, rollingInsightsId: `ri-${id}`, sleeperId: null, canonicalName: id })
    }
    function soccerBoard() {
      soccerPlayer('ace', 'Forward', 2026, 'ARS', 4, { goals: 0.75 })
      soccerPlayer('ace', 'Forward', 2025, 'ARS', 38, { goals: 0.25 })
      soccerPlayer('rookie', 'Forward', 2026, 'CHE', 4, { goals: 1 })
      soccerPlayer('gone', 'Forward', 2025, 'CHE', 35, { goals: 0.6 })
      soccerPlayer('keeper', 'Goalkeeper', 2026, 'ARS', 4, { saves: 3 })
      soccerPlayer('keeper', 'Goalkeeper', 2025, 'ARS', 38, { saves: 3 })
      soccerPlayer('back', 'Defender', 2026, 'CHE', 4, { assists: 0.25 })
      soccerPlayer('back', 'Defender', 2025, 'CHE', 30, { assists: 0.1 })
      soccerPlayer('wing', 'Forward', 2026, 'ARS', 4, { goals: 0.25 })
      soccerPlayer('wing', 'Forward', 2025, 'ARS', 30, { goals: 0.2 })
      schedule(['ARS', 'CHE'], 30, null)
    }

    it('grades from both seasons of match rows, on the 2026-27 season, never from stored projections', async () => {
      soccerBoard()
      const out = await loadSportPointsBase({ sport: 'SOCCER', league: null, now: NOW })
      if (!out.ok) throw new Error(out.reason)
      expect(out.ctx.window).toMatchObject({ season: 2026, seasonLabel: '2026-27', gamesRemaining: 30 })
      expect(out.ctx.valueKind).toBe('points')
      const ace = out.ctx.board.find((p) => p.name === 'ace')!
      // Four matches this season steadied by ten of last season's, on what an unsaved soccer league
      // scores: 6 a goal and 0.02 a minute (90 a match, every match).
      expect(ace).toMatchObject({ position: 'FWD', sampleGames: 14 })
      expect(ace.perGame).toBeCloseTo(6 * ((3 + 10 * 0.25) / 14) + 0.02 * 90, 6)
    })

    it('leaves last season’s departures off the board, and holds a newcomer to his own sample', async () => {
      soccerBoard()
      const out = await loadSportPointsBase({ sport: 'SOCCER', league: null, now: NOW })
      if (!out.ok) throw new Error(out.reason)
      expect(out.ctx.board.map((p) => p.name)).not.toContain('gone')
      expect(out.ctx.board.find((p) => p.name === 'rookie')!.sampleGames).toBe(4)
    })

    it('values a rotation player on the matches he plays, not on every match his club plays', async () => {
      soccerBoard()
      soccerPlayer('sub', 'Forward', 2026, 'ARS', 2, { goals: 0.75 }, 4)
      soccerPlayer('sub', 'Forward', 2025, 'ARS', 19, { goals: 0.25 }, 38)
      const out = await loadSportPointsBase({ sport: 'SOCCER', league: null, now: NOW })
      if (!out.ok) throw new Error(out.reason)
      const value = (name: string) => out.ctx.board.find((p) => p.name === name)!.perGame
      // His per-appearance line sits near the ace's; he plays about half the matches.
      expect(value('sub') / value('ace')).toBeLessThan(0.6)
    })
  })

  describe('MLB', () => {
    // Stored the way `mlbPerGameRates` writes them: engine keys, per APPEARANCE, target 2027 from 2026.
    function mlbPlayer(id: string, name: string, position: string, rates: Record<string, number>, sample: number) {
      db.projections.push({
        playerId: id, playerName: name, position, season: 2027,
        adjustmentFactors: { perGameRates: rates, confidenceReasons: [`${sample} games in the season sample`], sourceSeason: 2026 },
      })
      db.identities.push({ id, rollingInsightsId: `ri-${id}`, sleeperId: null })
    }
    const hitter = (hr: number) => ({ ab: 3.8, h: 1, r: 0.6, hr, rbi: 0.6, sb: 0.1, tb: 1.6, bb: 0.4, bat_so: 0.9 })
    const starter = { ip: 6, outs: 18, so: 6.5, w: 0.4, l: 0.3, er: 2.2, p_h: 5, p_bb: 1.8 }
    function mlbBoard() {
      for (let i = 0; i < 12; i++) mlbPlayer(`h${i}`, `Hitter ${i}`, ['C', '1B', '2B', '3B', 'SS', 'LF'][i % 6]!, hitter(0.1 + i * 0.02), 150)
      mlbPlayer('ace', 'Ace', 'P', { ...starter, so: 7.5, er: 1.8 }, 32)
      mlbPlayer('half', 'Half Season', 'P', { ...starter, so: 7.5, er: 1.8 }, 16)
      mlbPlayer('closer', 'Closer', 'P', { ip: 1, outs: 3, so: 1.2, sv: 0.6, er: 0.3, p_h: 0.8, p_bb: 0.3 }, 60)
      for (let i = 0; i < 6; i++) mlbPlayer(`sp${i}`, `Starter ${i}`, 'P', { ...starter, so: 4 + i * 0.3 }, 30)
    }

    it('prices the whole 162-game season ahead when the schedule is not posted, and says so', async () => {
      mlbBoard()
      const out = await loadSportPointsBase({ sport: 'MLB', league: null, now: NOW })
      if (!out.ok) throw new Error(out.reason)
      expect(out.ctx.window).toMatchObject({ season: 2027, seasonLabel: '2027', gamesRemaining: 162, scheduleKnown: false, baselineSeasonLabel: '2026' })
    })

    it('puts a starter on the team-game scale — the same line over half the starts is worth half', async () => {
      mlbBoard()
      const out = await loadSportPointsBase({ sport: 'MLB', league: null, format: 'points', now: NOW })
      if (!out.ok) throw new Error(out.reason)
      const value = (name: string) => out.ctx.board.find((p) => p.name === name)!.perGame
      expect(value('Half Season') / value('Ace')).toBeCloseTo(0.5, 6)
      // Per start the ace scores far more than an everyday hitter scores per game; per team game he does not.
      expect(value('Ace')).toBeLessThan(value('Hitter 11') * 2)
    })

    it('files pitchers as SP and RP so they fill the lineup’s pitching slots', async () => {
      mlbBoard()
      const out = await loadSportPointsBase({ sport: 'MLB', league: null, format: 'points', now: NOW })
      if (!out.ok) throw new Error(out.reason)
      const pos = (name: string) => out.ctx.board.find((p) => p.name === name)!.position
      expect(pos('Ace')).toBe('SP')
      expect(pos('Closer')).toBe('RP')
      expect([...out.ctx.replacementByPosition.keys()]).not.toContain('P')
    })

    it('measures hitters only against hitters in a 5x5 — adding pitchers moves no hitter', async () => {
      for (let i = 0; i < 12; i++) mlbPlayer(`h${i}`, `Hitter ${i}`, ['C', '1B', '2B', '3B', 'SS', 'LF'][i % 6]!, hitter(0.1 + i * 0.02), 150)
      mlbPlayer('ace', 'Ace', 'P', starter, 32)
      const few = await loadSportPointsBase({ sport: 'MLB', league: null, format: 'mlb_5x5', now: NOW })
      for (let i = 0; i < 6; i++) mlbPlayer(`sp${i}`, `Starter ${i}`, 'P', { ...starter, so: 4 + i * 0.3 }, 30)
      const many = await loadSportPointsBase({ sport: 'MLB', league: null, format: 'mlb_5x5', now: NOW })
      if (!few.ok || !many.ok) throw new Error('not loaded')
      expect(many.ctx.valueKind).toBe('categories')
      expect(many.ctx.categoryList).toBe('R, HR, RBI, SB, AVG, W, SV, K, ERA and WHIP')
      const hitterValue = (ctx: typeof few.ctx) => ctx.board.find((p) => p.name === 'Hitter 5')!.perGame
      expect(hitterValue(many.ctx)).toBeCloseTo(hitterValue(few.ctx), 9)
    })

    it('values a league on its own stored 5x5, roto included', async () => {
      mlbBoard()
      const settings = { scoring_mode: 'roto', category_preset_id: 'mlb_5x5', category_record_mode: 'roto' }
      const out = await loadSportPointsBase({ sport: 'MLB', league: { id: 'L', settings, leagueType: 'redraft', leagueSize: 12 }, now: NOW })
      if (!out.ok) throw new Error(out.reason)
      expect(out.ctx.valueKind).toBe('categories')
    })

    it('does not pause a complete board because most of it is call-ups short of the at-bat bar', async () => {
      mlbBoard()
      // Two call-ups for every regular: past ten games, under a hundred at-bats.
      for (let i = 0; i < 40; i++) mlbPlayer(`cu${i}`, `Call-Up ${i}`, '2B', { ...hitter(0.05), ab: 2.5 }, 15)
      const out = await loadSportPointsBase({ sport: 'MLB', league: null, format: 'points', now: NOW })
      if (!out.ok) throw new Error(out.reason)
      expect(out.ctx.board.find((p) => p.name === 'Call-Up 0')!.sampleBar).toMatchObject({ ok: false, has: '38 at-bats' })
    })

    it('grades nothing off the old fielding-only rows', async () => {
      mlbPlayer('old', 'Old Row', 'SS', { E: 0.05, PO: 1.2 }, 140)
      const out = await loadSportPointsBase({ sport: 'MLB', league: null, format: 'points', now: NOW })
      expect(out).toMatchObject({ ok: false, reason: expect.stringMatching(/^No MLB projection could be scored/) })
    })
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
