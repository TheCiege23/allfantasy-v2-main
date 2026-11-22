/**
 * `/api/leagues/[id]/scoring/matchups` for a league that plays on AllFantasy: the week's games come
 * from its own season. `games` is one line per game; `matchups` keeps the one-row-per-team shape its
 * other readers expect (the league home's week recap, the scoring previews), which only ever held a
 * scored week with a number in it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const state = vi.hoisted(() => ({ board: null as unknown, teamWeekRows: [] as unknown[], lastArgs: null as unknown }))

vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'me' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn(async () => ({ isMember: true })) }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: vi.fn(async () => new Map([['x1', 'Imported One']])) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: vi.fn(async () => ({ id: 'L', season: 2026, sport: 'NBA', settings: {}, leagueVariant: null, platform: 'manual', playoffWeeksPerRound: 1 })) },
    teamWeekResult: { findMany: vi.fn(async () => state.teamWeekRows) },
  },
}))
vi.mock('@/server/services/nativeMatchupCenter', () => ({
  loadNativeScoreboard: vi.fn(async (args: unknown) => {
    state.lastArgs = args
    return state.board
  }),
}))

import { GET } from '@/app/api/leagues/[leagueId]/scoring/matchups/route'
import { buildLastWeekRecap } from '@/lib/league-media/redraftLeagueHome'

const call = async (query = '') => {
  const res = await GET(new NextRequest(`http://localhost/api/leagues/L/scoring/matchups${query}`), { params: Promise.resolve({ leagueId: 'L' }) })
  return { status: res.status, body: (await res.json()) as any }
}
const g = (id: string, status: string, home: [string, number | null], away: [string, number | null] | null) => ({
  id, kind: 'regular', label: null, status, mine: false,
  home: { rosterId: `${home[0]}-id`, teamName: home[0], totalPoints: home[1] },
  away: away ? { rosterId: `${away[0]}-id`, teamName: away[0], totalPoints: away[1] } : null,
})

beforeEach(() => {
  state.board = null
  state.teamWeekRows = []
  state.lastArgs = null
})

describe('a league that plays here', () => {
  it('answers for the season’s own week when none is asked for', async () => {
    state.board = { season: 2026, week: 7, games: [] }
    const { body } = await call('?season=2026')
    expect(body).toMatchObject({ season: 2026, week: 7, games: [], matchups: [] })
    expect(state.lastArgs).toMatchObject({ season: 2026, week: undefined, viewerUserId: 'me' })
  })

  it('a final week: one line per game, and a W/L row per team', async () => {
    state.board = { season: 2026, week: 1, games: [g('m1', 'final', ['Aces', 681], ['Bears', 718]), g('m2', 'final', ['Cubs', 640.5], ['Ducks', 610])] }
    const { body } = await call('?season=2026&week=1')
    expect(body.games.length).toBe(2)
    expect(body.matchups.map((r: any) => [r.teamName, r.totalPoints, r.opponentName, r.winLoss, r.status])).toEqual([
      ['Aces', 681, 'Bears', 'L', 'final'],
      ['Bears', 718, 'Aces', 'W', 'final'],
      ['Cubs', 640.5, 'Ducks', 'W', 'final'],
      ['Ducks', 610, 'Cubs', 'L', 'final'],
    ])
    // The league home's week recap is built from exactly these rows, and now has something to read.
    expect(buildLastWeekRecap(1, body.matchups)).toEqual({
      week: 1,
      topScore: { team: 'Bears', points: 718 },
      closest: { winner: 'Cubs', loser: 'Ducks', margin: 30.5 },
      biggest: { winner: 'Bears', loser: 'Aces', margin: 37 },
    })
  })

  it('🛑 a game not started and a bye are in `games` only: no team row with a made-up 0', async () => {
    state.board = { season: 2026, week: 2, games: [g('m3', 'upcoming', ['Aces', null], ['Cubs', null]), g('bye', 'upcoming', ['Elks', null], null), g('m4', 'live', ['Bears', 12], ['Ducks', 9])] }
    const { body } = await call('?week=2')
    expect(body.games.length).toBe(3)
    expect(body.matchups.map((r: any) => [r.teamName, r.totalPoints, r.winLoss])).toEqual([
      ['Bears', 12, null],
      ['Ducks', 9, null],
    ])
  })

  it('a week out of range is not passed on', async () => {
    state.board = { season: 2026, week: 3, games: [] }
    await call('?week=0&season=1')
    expect(state.lastArgs).toMatchObject({ season: undefined, week: undefined })
  })
})

describe('an imported league', () => {
  it('still reads its stored week rows, exactly as before', async () => {
    state.teamWeekRows = [{ rosterId: 'x1', totalPoints: 99.5, opponentRosterId: null, winLoss: null, status: 'final' }]
    const { body } = await call('?season=2026&week=4')
    expect(body).toEqual({
      season: 2026,
      week: 4,
      matchups: [{ rosterId: 'x1', teamName: 'Imported One', totalPoints: 99.5, opponentRosterId: null, opponentName: null, winLoss: null, status: 'final' }],
    })
    expect(body.games).toBeUndefined()
  })
})
