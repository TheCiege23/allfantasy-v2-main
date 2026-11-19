/**
 * 🛑 THE STANDINGS TAB WAS EMPTY FOR EVERY POINTS LEAGUE THAT PLAYS ON ALLFANTASY.
 *
 * The route read `fantasyStanding` and kept only teams with a final `teamWeekResult` row. The season
 * engine writes neither for a points league (records go to `RedraftRoster`), so a league with a scored
 * week showed "Standings appear once the first week is scored". Measured on a local 12-team league,
 * 2026-11-19: week 1 final, `standings` rows 0, `team_week_results` rows 0.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildNativeStandings, weeklyScoresFromGames, type NativeSeasonRoster } from '@/lib/standings/nativeSeasonStandings'

const roster = (id: string, w: number, l: number, pf: number, pa: number, over: Partial<NativeSeasonRoster> = {}): NativeSeasonRoster => ({
  id, ownerName: `owner-${id}`, teamName: `Team ${id}`, wins: w, losses: l, ties: 0, pointsFor: pf, pointsAgainst: pa, streak: null, playoffSeed: null, ...over,
})
const game = (week: number, home: string, hs: number, away: string, as: number) => ({ week, homeRosterId: home, awayRosterId: away, homeScore: hs, awayScore: as })
const same = (id: string) => id
const noName = () => null

describe('buildNativeStandings', () => {
  it('🛑 a scored week gives a full table: every team, with the record the season holds', () => {
    const { standings, scoredWeeks } = buildNativeStandings({
      rosters: [roster('A', 0, 1, 681, 718, { streak: 'L1' }), roster('B', 1, 0, 718, 681, { streak: 'W1' }), roster('C', 1, 0, 640.5, 610), roster('D', 0, 1, 610, 640.5)],
      finalGames: [game(1, 'A', 681, 'B', 718), game(1, 'C', 640.5, 'D', 610)],
      idFor: same,
      nameFor: noName,
      allPlay: true,
    })
    expect(scoredWeeks).toBe(1)
    expect(standings.map((r) => [r.rank, r.teamName, r.wins, r.losses, r.pointsFor, r.streak, r.allPlay])).toEqual([
      [1, 'Team B', 1, 0, 718, 'W1', '3-0'],
      [2, 'Team C', 1, 0, 640.5, '—', '1-2'],
      [3, 'Team A', 0, 1, 681, 'L1', '2-1'],
      [4, 'Team D', 0, 1, 610, '—', '0-3'],
    ])
  })

  it('the season engine’s own order wins over a fresh sort', () => {
    // Its tiebreakers put C ahead of B: the table follows it, not points for.
    const { standings } = buildNativeStandings({
      rosters: [roster('B', 1, 0, 718, 681, { playoffSeed: 2 }), roster('C', 1, 0, 640.5, 610, { playoffSeed: 1 }), roster('A', 0, 1, 681, 718, { playoffSeed: 3 })],
      finalGames: [game(1, 'A', 681, 'B', 718)],
      idFor: same,
      nameFor: noName,
      allPlay: true,
    })
    expect(standings.map((r) => [r.rank, r.rosterId, r.playoffSeed])).toEqual([[1, 'C', 1], [2, 'B', 2], [3, 'A', 3]])
  })

  it('a season nobody has played is empty, not a table of 0-0 teams', () => {
    expect(buildNativeStandings({ rosters: [roster('A', 0, 0, 0, 0), roster('B', 0, 0, 0, 0)], finalGames: [], idFor: same, nameFor: noName, allPlay: true })).toEqual({ standings: [], scoredWeeks: 0 })
  })

  it('rows carry the league page’s roster id and its team label', () => {
    const { standings } = buildNativeStandings({
      rosters: [roster('season-1', 1, 0, 100, 90)],
      finalGames: [game(1, 'season-1', 100, 'season-2', 90)],
      idFor: (id) => (id === 'season-1' ? 'league-roster-1' : id),
      nameFor: (id) => (id === 'league-roster-1' ? 'The Commish' : null),
      allPlay: true,
    })
    expect(standings[0]).toMatchObject({ rosterId: 'league-roster-1', teamName: 'The Commish' })
  })

  it('a category league carries its categories won and draws no all-play', () => {
    const { standings } = buildNativeStandings({
      rosters: [roster('A', 1, 0, 5, 4)],
      finalGames: [game(1, 'A', 5, 'B', 4)],
      idFor: same,
      nameFor: noName,
      categoryRecord: new Map([['A', { wins: 5, losses: 4, ties: 0 }]]),
      allPlay: false,
    })
    expect(standings[0]).toMatchObject({ categoryWinsFor: 5, categoryLossesFor: 4, categoryTiesFor: 0, allPlay: '—' })
  })
})

describe('weeklyScoresFromGames', () => {
  it('a team that plays twice in a week is counted once in all-play', () => {
    const scores = weeklyScoresFromGames([game(1, 'A', 100, 'B', 90), game(1, 'A', 100, 'C', 80), game(2, 'A', 70, 'B', 95)])
    expect(scores.filter((s) => s.rosterId === 'A').map((s) => [s.week, s.totalPoints])).toEqual([[1, 100], [2, 70]])
    expect(scores.length).toBe(5)
  })
})

/* ── The route, over a faked database ─────────────────────────────────────────────────────────── */

const db = vi.hoisted(() => ({
  league: { id: 'L', season: 2026, settings: {} as Record<string, unknown>, platform: 'manual', bestBallMode: false, bbMatchupFormat: null, leagueType: 'redraft', leagueVariant: null },
  season: { id: 'S' } as { id: string } | null,
  rosters: [] as any[],
  games: [] as any[],
  generic: [] as any[],
  fantasyStanding: [] as any[],
  teamWeekResult: [] as any[],
  calls: { fantasyStanding: 0, teamWeekResult: 0, redraftSeason: 0 },
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'me' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/league/viewerTeams', () => ({ requestedRosterIdFrom: () => null, resolveViewingRoster: vi.fn(async () => ({ rosterId: 'g-A' })) }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: vi.fn(async () => new Map([['g-A', 'Aces'], ['g-B', 'Bears']])) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: vi.fn(async () => db.league) },
    redraftSeason: { findFirst: vi.fn(async () => { db.calls.redraftSeason += 1; return db.season }) },
    redraftRoster: { findMany: vi.fn(async () => db.rosters) },
    redraftMatchup: { findMany: vi.fn(async () => db.games) },
    roster: { findMany: vi.fn(async () => db.generic) },
    leagueTeam: { findMany: vi.fn(async () => []) },
    fantasyStanding: { findMany: vi.fn(async () => { db.calls.fantasyStanding += 1; return db.fantasyStanding }) },
    teamWeekResult: { findMany: vi.fn(async () => { db.calls.teamWeekResult += 1; return db.teamWeekResult }) },
  },
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/leagues/[leagueId]/scoring/standings/route'

const call = async () => {
  const res = await GET(new NextRequest('http://localhost/api/leagues/L/scoring/standings?season=2026'), { params: Promise.resolve({ leagueId: 'L' }) })
  return (await res.json()) as any
}

beforeEach(() => {
  db.league = { id: 'L', season: 2026, settings: {}, platform: 'manual', bestBallMode: false, bbMatchupFormat: null, leagueType: 'redraft', leagueVariant: null }
  db.season = { id: 'S' }
  db.rosters = [
    { id: 'rA', ownerId: 'me', ownerName: 'me', teamName: 'A team', wins: 0, losses: 1, ties: 0, pointsFor: 681, pointsAgainst: 718, streak: 'L1', playoffSeed: 2 },
    { id: 'rB', ownerId: 'u2', ownerName: 'u2', teamName: 'B team', wins: 1, losses: 0, ties: 0, pointsFor: 718, pointsAgainst: 681, streak: 'W1', playoffSeed: 1 },
  ]
  db.games = [{ week: 1, homeRosterId: 'rA', awayRosterId: 'rB', homeScore: 681, awayScore: 718 }]
  // One team is linked by the stored link, the other only by its owner.
  db.generic = [{ id: 'g-A', platformUserId: 'me', redraftRosterId: null }, { id: 'g-B', platformUserId: 'someone-else', redraftRosterId: 'rB' }]
  db.fantasyStanding = []
  db.teamWeekResult = []
  db.calls = { fantasyStanding: 0, teamWeekResult: 0, redraftSeason: 0 }
})

describe('GET /api/leagues/[id]/scoring/standings', () => {
  it('🛑 a points league that plays here gets its standings with nothing in the old tables', async () => {
    const body = await call()
    expect(body.source).toBe('native')
    expect(body.scoredWeeks).toBe(1)
    expect(body.viewerRosterId).toBe('g-A')
    expect(body.standings.map((r: any) => [r.rank, r.rosterId, r.teamName, r.wins, r.losses, r.pointsFor, r.streak, r.allPlay])).toEqual([
      [1, 'g-B', 'Bears', 1, 0, 718, 'W1', '1-0'],
      [2, 'g-A', 'Aces', 0, 1, 681, 'L1', '0-1'],
    ])
    // The viewer's row is one of them: the highlight has a row to land on.
    expect(body.standings.some((r: any) => r.rosterId === body.viewerRosterId)).toBe(true)
    expect(db.calls).toMatchObject({ fantasyStanding: 0, teamWeekResult: 0 })
  })

  it('a head-to-head category league reads its record here and its categories won beside it', async () => {
    db.league.settings = { scoring_mode: 'h2h_category' }
    db.fantasyStanding = [{ rosterId: 'g-B', categoryWinsFor: 6, categoryLossesFor: 3, categoryTiesFor: 0 }]
    const body = await call()
    expect(body.scoringMode).toBe('h2h_category')
    expect(body.standings[0]).toMatchObject({ rosterId: 'g-B', wins: 1, categoryWinsFor: 6, categoryLossesFor: 3, allPlay: '—' })
    expect(db.calls.teamWeekResult).toBe(0)
  })

  it('a rotisserie league keeps the read its scoring fills', async () => {
    db.league.settings = { scoring_mode: 'roto' }
    db.fantasyStanding = [{ rosterId: 'g-A', wins: 0, losses: 0, ties: 0, pointsFor: 55, pointsAgainst: 0, rank: 1, playoffSeed: null, categoryWinsFor: 0, categoryLossesFor: 0, categoryTiesFor: 0 }]
    db.teamWeekResult = [{ week: 1, rosterId: 'g-A', totalPoints: 0, winLoss: null }]
    const body = await call()
    expect(db.calls.redraftSeason).toBe(0)
    expect(body.standings.map((r: any) => [r.rosterId, r.pointsFor])).toEqual([['g-A', 55]])
    expect(body.scoredWeeks).toBe(1)
  })

  it('a league with no season for the year answers as before', async () => {
    db.season = null
    const body = await call()
    expect(body.standings).toEqual([])
    expect(db.calls).toMatchObject({ fantasyStanding: 1, teamWeekResult: 1 })
  })
})
