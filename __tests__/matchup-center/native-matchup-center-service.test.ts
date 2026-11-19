/**
 * 🛑 THE MATCHUP TAB OF A LEAGUE THAT PLAYS HERE READ A TABLE ITS SEASON NEVER WRITES.
 *
 * Found on the real league page, 2026-11-19: a 12-team league in week 2, with week 1 scored and final
 * (681.0 - 718.0), showed "Week 1 · upcoming", "No opponent", 0.0 and an empty scoreboard. The tab read
 * `teamWeekResult`, which only a manual "process week" writes; the season lives in `RedraftMatchup`.
 *
 * These drive the real reader over a faked database: the schedule, the bracket, the lineup that
 * counted, and the cases a big league hits (several games in a week, a bye, a commissioner with no team).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  seasons: [] as any[],
  matchups: [] as any[],
  rounds: [] as any[],
  players: [] as any[],
  scores: [] as any[],
  calls: { scores: 0, rounds: 0, seasons: 0 },
}))
const engine = vi.hoisted(() => ({ scoreRosterForWeek: vi.fn() }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftSeason: { findMany: vi.fn(async () => { db.calls.seasons += 1; return db.seasons }) },
    redraftMatchup: {
      findMany: vi.fn(async ({ where }: any) => db.matchups.filter((m) => m.seasonId === where.seasonId && m.week === where.week && !m.isMedianMatchup)),
    },
    redraftPlayoffRound: { findMany: vi.fn(async () => { db.calls.rounds += 1; return db.rounds }) },
    redraftRosterPlayer: { findMany: vi.fn(async ({ where }: any) => db.players.filter((p) => where.rosterId.in.includes(p.rosterId))) },
    roster: { findMany: vi.fn(async () => []) },
    afRosterLineupAssignment: { findMany: vi.fn(async () => []) },
    leaguePlayerWeeklyScore: {
      findMany: vi.fn(async ({ where }: any) => {
        db.calls.scores += 1
        return db.scores.filter((s) => s.week === where.week && where.rosterId.in.includes(s.rosterId))
      }),
    },
  },
}))
vi.mock('@/lib/player-media', () => ({ attachPlayerMediaBatch: vi.fn(async () => new Map()) }))
vi.mock('@/lib/matchup-center/afProjections', async (orig) => ({
  ...(await orig<typeof import('@/lib/matchup-center/afProjections')>()),
  loadMatchupAfProjections: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/redraft/scoringEngine', () => ({ scoreRosterForWeek: engine.scoreRosterForWeek }))

import { buildNativeMatchupCenterPayload, loadNativeScoreboard } from '@/server/services/nativeMatchupCenter'
import { nativeRosterSeat } from '@/lib/redraft/nativePlayerWeeklyScores'

const LEAGUE = { id: 'L', season: 2026, sport: 'NBA', settings: {}, leagueVariant: null, platform: 'manual', playoffWeeksPerRound: 1 }
const roster = (id: string, ownerId: string, teamName: string, w = 0, l = 0, extra: Record<string, unknown> = {}) => ({
  id, ownerId, managerUserId: null, ownerName: ownerId, teamName, avatarUrl: null, wins: w, losses: l, ties: 0, ...extra,
})
const player = (rosterId: string, playerId: string, position: string, slotType = position) => ({
  rosterId, playerId, playerName: `Name ${playerId}`, position, team: 'BOS', slotType, droppedAt: null, injuryStatus: null,
})
const ok = <T,>(v: T | { error: string; status: number; code?: string } | null): Exclude<T, null> => {
  if (!v || (typeof v === 'object' && 'error' in (v as object))) throw new Error(`expected a payload, got ${JSON.stringify(v)}`)
  return v as Exclude<T, null>
}

beforeEach(() => {
  db.seasons = [{ id: 'S', season: 2026, currentWeek: 2, playoffStartWeek: 15, rosters: [roster('rA', 'me', 'Aces', 0, 1), roster('rB', 'u2', 'Bears', 1, 0), roster('rC', 'u3', 'Cubs'), roster('rD', 'u4', 'Ducks')] }]
  db.matchups = [
    { id: 'm1', seasonId: 'S', week: 1, homeRosterId: 'rA', awayRosterId: 'rB', homeScore: 681, awayScore: 718, status: 'final', isMedianMatchup: false },
    { id: 'm2', seasonId: 'S', week: 1, homeRosterId: 'rC', awayRosterId: 'rD', homeScore: 640.5, awayScore: 610, status: 'final', isMedianMatchup: false },
    { id: 'm3', seasonId: 'S', week: 2, homeRosterId: 'rC', awayRosterId: 'rA', homeScore: 0, awayScore: 0, status: 'scheduled', isMedianMatchup: false },
    { id: 'm4', seasonId: 'S', week: 2, homeRosterId: 'rB', awayRosterId: 'rD', homeScore: 0, awayScore: 0, status: 'scheduled', isMedianMatchup: false },
  ]
  db.rounds = []
  db.players = [player('rA', 'a-pg', 'PG'), player('rA', 'a-c', 'C'), player('rA', 'a-bn', 'SF', 'bench'), player('rB', 'b-pg', 'PG'), player('rC', 'c-pg', 'PG')]
  db.scores = [
    { week: 1, rosterId: nativeRosterSeat('rA'), playerId: 'a-pg', points: 400, isStarter: true },
    { week: 1, rosterId: nativeRosterSeat('rA'), playerId: 'a-c', points: 281, isStarter: true },
    { week: 1, rosterId: nativeRosterSeat('rA'), playerId: 'a-bn', points: 90, isStarter: false },
    { week: 1, rosterId: nativeRosterSeat('rB'), playerId: 'b-pg', points: 718, isStarter: true },
  ]
  db.calls = { scores: 0, rounds: 0, seasons: 0 }
  engine.scoreRosterForWeek.mockReset()
})

describe('the viewer’s matchup, from the league’s own season', () => {
  it('🛑 opens on the season’s current week, with the real opponent', async () => {
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' }))
    expect(p.week).toBe(2)
    expect(p.matchupStatus).toBe('upcoming')
    expect(p.left).toMatchObject({ rosterId: 'rA', teamName: 'Aces', record: { wins: 0, losses: 1, ties: 0 } })
    expect(p.right).toMatchObject({ rosterId: 'rC', teamName: 'Cubs' })
    // Not started: today's starters, no bench player.
    expect(p.left.starters.map((s) => s.playerId)).toEqual(['a-pg', 'a-c'])
    expect(p.native).toMatchObject({ scoreUnit: 'points', bye: false, gameNumber: 1, gameCount: 1, playerPointsAvailable: true })
    // A game not started is never asked of the scoring engine.
    expect(engine.scoreRosterForWeek).not.toHaveBeenCalled()
  })

  it('a played week shows the score the season holds and the points each starter counted for', async () => {
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me', week: 1 }))
    expect(p.matchupStatus).toBe('final')
    expect([p.left.totalPoints, p.right.totalPoints]).toEqual([681, 718])
    expect(p.left.starters.map((s) => [s.playerId, s.currentPoints, s.gameStatus])).toEqual([
      ['a-pg', 400, 'final'],
      ['a-c', 281, 'final'],
    ])
    expect(p.right.starters.map((s) => [s.playerId, s.currentPoints])).toEqual([['b-pg', 718]])
    expect(p.left.remainingStarters).toBe(0)
    expect(p.refreshIntervalMs).toBe(0)
  })

  it('the away team reads its own score, not the home team’s', async () => {
    db.matchups[2] = { ...db.matchups[2], homeScore: 55, awayScore: 77, status: 'active' }
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' }))
    expect(p.matchupStatus).toBe('live')
    expect([p.left.totalPoints, p.right.totalPoints]).toEqual([77, 55])
  })

  it('a week in play with no stored player rows asks the scoring engine, which only reads', async () => {
    db.matchups[2] = { ...db.matchups[2], homeScore: 55, awayScore: 77, status: 'active' }
    engine.scoreRosterForWeek.mockImplementation(async ({ rosterId }: { rosterId: string }) => ({
      playerPoints: rosterId === 'rA' ? [{ playerId: 'a-pg', points: 77, isStarter: true }] : [{ playerId: 'c-pg', points: 55, isStarter: true }],
    }))
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' }))
    expect(engine.scoreRosterForWeek).toHaveBeenCalledTimes(2)
    expect(engine.scoreRosterForWeek).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L', week: 2, seasonYear: 2026, collectPlayerPoints: true }))
    expect(p.left.starters.map((s) => [s.playerId, s.currentPoints, s.gameStatus])).toEqual([['a-pg', 77, 'live']])
    expect(p.native.playerPointsAvailable).toBe(true)
  })

  it('and when the engine cannot say, the team score stands and players draw dashes', async () => {
    db.matchups[2] = { ...db.matchups[2], homeScore: 55, awayScore: 77, status: 'active' }
    engine.scoreRosterForWeek.mockRejectedValue(new Error('no stats'))
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' }))
    expect([p.left.totalPoints, p.right.totalPoints]).toEqual([77, 55])
    expect(p.native.playerPointsAvailable).toBe(false)
  })
})

describe('a league that plays more than one game a week', () => {
  beforeEach(() => {
    db.matchups.push({ id: 'm5', seasonId: 'S', week: 2, homeRosterId: 'rA', awayRosterId: 'rD', homeScore: 0, awayScore: 0, status: 'scheduled', isMedianMatchup: false })
  })
  it('counts the viewer’s games and lists the other one', async () => {
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' }))
    expect(p.right.teamName).toBe('Cubs')
    expect(p.native).toMatchObject({ gameNumber: 1, gameCount: 2 })
    expect(p.native.otherGames.map((g) => [g.home.teamName, g.away?.teamName])).toEqual([['Aces', 'Ducks']])
  })
  it('`game` picks which one the card shows, and an out-of-range number stays on a real game', async () => {
    const second = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me', game: 2 }))
    expect(second.right.teamName).toBe('Ducks')
    expect(second.native).toMatchObject({ gameNumber: 2, gameCount: 2 })
    const past = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me', game: 9 }))
    expect(past.native.gameNumber).toBe(2)
  })
})

describe('weeks with no game', () => {
  it('a bye says so and draws no opponent', async () => {
    db.matchups = [{ id: 'bye', seasonId: 'S', week: 2, homeRosterId: 'rA', awayRosterId: null, homeScore: 0, awayScore: 0, status: 'scheduled', isMedianMatchup: false }]
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' }))
    expect(p.native).toMatchObject({ bye: true, gameCount: 0, gameNumber: 0 })
    expect(p.right.rosterId).toBe('bye')
    expect(p.winProbabilityLeft).toBeNull()
    // The team's own lineup still shows.
    expect(p.left.starters.length).toBe(2)
  })
  it('nothing scheduled is not called a bye', async () => {
    db.matchups = []
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' }))
    expect(p.native).toMatchObject({ bye: false, gameCount: 0 })
  })
})

describe('playoff weeks come from the bracket', () => {
  beforeEach(() => {
    db.seasons[0].currentWeek = 15
    db.rounds = [
      { roundNumber: 1, roundName: 'Semifinal', matchups: [
        { id: 'p1', homeRosterId: 'rB', awayRosterId: 'rA', homeScore: null, awayScore: null, status: 'scheduled', metadata: { live: { homeScore: 120.5, awayScore: 133 } } },
        { id: 'p2', homeRosterId: 'rC', awayRosterId: null, homeScore: null, awayScore: null, status: 'bye', metadata: {} },
      ] },
      { roundNumber: 2, roundName: 'Final', matchups: [{ id: 'p3', homeRosterId: 'rC', awayRosterId: null, homeScore: null, awayScore: null, status: 'scheduled', metadata: {} }] },
      { roundNumber: 101, roundName: 'Consolation', matchups: [{ id: 'c1', homeRosterId: 'rD', awayRosterId: 'rC', homeScore: 90, awayScore: 80, status: 'final', metadata: {} }] },
    ]
    engine.scoreRosterForWeek.mockResolvedValue({ playerPoints: [] })
  })
  it('the viewer’s semifinal, with the score the round is being played at', async () => {
    const p = ok(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' }))
    expect(p.week).toBe(15)
    expect(p.matchupStatus).toBe('live')
    expect(p.right.teamName).toBe('Bears')
    expect([p.left.totalPoints, p.right.totalPoints]).toEqual([133, 120.5])
    expect(p.native.gameLabel).toBe('Semifinal')
  })
  it('the scoreboard holds the title game and the lower bracket, not a seat still waiting on a winner', async () => {
    const board = await loadNativeScoreboard({ league: LEAGUE, viewerUserId: 'me', week: 15 })
    expect(board?.games.map((g) => [g.id, g.kind, g.label, g.status])).toEqual([
      ['p1', 'playoff', 'Semifinal', 'live'],
      ['c1', 'consolation', 'Consolation', 'final'],
    ])
    // The final is week 16: nothing of it is drawn in week 15.
    const next = await loadNativeScoreboard({ league: LEAGUE, viewerUserId: 'me', week: 16 })
    expect(next?.games).toEqual([])
  })
  it('a regular-season week never reads the bracket', async () => {
    await loadNativeScoreboard({ league: LEAGUE, viewerUserId: 'me', week: 1 })
    expect(db.calls.rounds).toBe(0)
  })
})

describe('category leagues', () => {
  const CATEGORY = { ...LEAGUE, settings: { scoring_mode: 'h2h_category' } }
  it('the two numbers are categories won, and no player points are read or drawn', async () => {
    db.matchups[0] = { ...db.matchups[0], homeScore: 5, awayScore: 4 }
    const p = ok(await buildNativeMatchupCenterPayload({ league: CATEGORY, viewerUserId: 'me', week: 1 }))
    expect([p.left.totalPoints, p.right.totalPoints]).toEqual([5, 4])
    expect(p.native).toMatchObject({ scoreUnit: 'categories', playerPointsAvailable: false })
    expect(db.calls.scores).toBe(0)
    expect(engine.scoreRosterForWeek).not.toHaveBeenCalled()
  })
  it('a rotisserie league has no head-to-head scoreboard', async () => {
    const board = await loadNativeScoreboard({ league: { ...LEAGUE, settings: { scoring_mode: 'roto' } }, viewerUserId: 'me', week: 1 })
    expect(board).toEqual({ season: 2026, week: 1, games: [] })
  })
})

describe('who is asking, and which league', () => {
  it('a member with no team gets the distinct no-team answer, never a made-up matchup', async () => {
    expect(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'commish-who-does-not-play' })).toEqual({
      error: 'Roster not found', status: 404, code: 'NO_CLAIMED_TEAM',
    })
  })
  it('and still gets the week’s scoreboard', async () => {
    const board = await loadNativeScoreboard({ league: LEAGUE, viewerUserId: 'commish-who-does-not-play' })
    expect(board?.week).toBe(2)
    expect(board?.games.every((g) => !g.mine)).toBe(true)
    expect(board?.games.length).toBe(2)
  })
  it('🛑 an imported league is not read here at all: its platform owns its schedule', async () => {
    expect(await buildNativeMatchupCenterPayload({ league: { ...LEAGUE, platform: 'sleeper' }, viewerUserId: 'me' })).toBeNull()
    expect(await loadNativeScoreboard({ league: { ...LEAGUE, platform: 'espn' }, viewerUserId: 'me' })).toBeNull()
    expect(db.calls.seasons).toBe(0)
  })
  it('a native league with no season yet answers null, so the caller answers as before', async () => {
    db.seasons = []
    expect(await buildNativeMatchupCenterPayload({ league: LEAGUE, viewerUserId: 'me' })).toBeNull()
  })
})
