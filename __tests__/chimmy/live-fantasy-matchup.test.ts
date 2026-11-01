import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  league: vi.fn(), board: vi.fn(), scores: vi.fn(), matchup: vi.fn(), nativePlayers: vi.fn(), sportsPlayers: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  league: { findUnique: h.league }, leaguePlayerWeeklyScore: { findMany: h.scores },
  weeklyMatchup: { findFirst: h.matchup }, redraftRosterPlayer: { findMany: h.nativePlayers },
  sportsPlayer: { findMany: h.sportsPlayers },
} }))
vi.mock('@/lib/core-app/weekBoard', () => ({ getWeekBoard: h.board }))
vi.mock('@/lib/core-app/weeklyCapabilities', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/core-app/weeklyCapabilities')>(),
  nativeWeeklyLeague: (league: { platform: string }) => league.platform === 'allfantasy',
}))

import { buildLiveFantasyMatchupContext } from '@/lib/chimmy/liveFantasyMatchupGrounding'

beforeEach(() => {
  vi.clearAllMocks()
  h.league.mockResolvedValue({ id: 'L1', name: 'Hoops', sport: 'NBA', platform: 'sleeper', platformLeagueId: 'P1', leagueType: 'redraft' })
  h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '1', yours: { season: 2026, week: 2, opponent: { rosterId: '2', name: 'Rival' }, live: { you: 93, them: 87, margin: 6, final: false } } }, eliminationWeeks: [] })
  h.scores.mockResolvedValue([
    { playerId: 'a', rosterId: 1, points: 31.5, updatedAt: new Date('2026-11-01T20:00:00Z') },
    { playerId: 'b', rosterId: 2, points: 28, updatedAt: new Date('2026-11-01T20:00:00Z') },
  ])
  h.matchup.mockResolvedValue({ updatedAt: new Date('2026-11-01T20:02:00Z') })
  h.sportsPlayers.mockResolvedValue([{ sleeperId: 'a', name: 'Home Star' }, { sleeperId: 'b', name: 'Away Star' }])
  h.nativePlayers.mockResolvedValue([])
})

describe('selected league live fantasy matchup', () => {
  it('uses the league board for actual scores and league-scored starter rows for contributions', async () => {
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('your team 93.00, Rival 87.00')
    expect(out).toContain('Home Star 31.50')
    expect(out).toContain('Away Star 28.00')
    expect(out).toContain('2026-11-01T20:02:00.000Z')
    expect(h.board).toHaveBeenCalledWith('u1', expect.any(Array), 'L1')
    expect(h.scores.mock.calls[0][0].where).toMatchObject({ leagueId: 'P1', seasonYear: 2026, week: 2, source: 'sleeper', isStarter: true })
  })

  it('does not turn an empty score into a reported zero', async () => {
    h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '1', yours: { season: 2026, week: 2, opponent: { rosterId: '2', name: 'Rival' }, live: null } }, eliminationWeeks: [] })
    h.scores.mockResolvedValue([])
    h.matchup.mockResolvedValue(null)
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('No fantasy points are on the board')
    expect(out).toContain('No score refresh time is on file')
    expect(out).not.toContain('your team 0.00')
  })

  it('withholds zero-valued player rows until the board reports a score', async () => {
    h.board.mockResolvedValue({ leagueBoard: { yourRosterId: '1', yours: { season: 2026, week: 2, opponent: { rosterId: '2', name: 'Rival' }, live: null } }, eliminationWeeks: [] })
    h.scores.mockResolvedValue([{ playerId: 'a', rosterId: 1, points: 0, updatedAt: new Date('2026-11-01T20:00:00Z') }])
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toContain('withheld until the matchup board reports points')
    expect(out).not.toContain('Home Star 0.00')
  })

  it('refuses a missing league before reading anyone’s board', async () => {
    h.league.mockResolvedValue(null)
    expect(await buildLiveFantasyMatchupContext({ leagueId: 'missing', userId: 'u1' })).toMatch(/could not be read/)
    expect(h.board).not.toHaveBeenCalled()
  })

  it('does not present a scalar score for a category league', async () => {
    h.league.mockResolvedValue({ id: 'L1', name: 'Hoops Categories', sport: 'NBA', platform: 'sleeper', platformLeagueId: 'P1', leagueType: 'categories', settings: {} })
    const out = await buildLiveFantasyMatchupContext({ leagueId: 'L1', userId: 'u1' })
    expect(out).toMatch(/category or rotisserie/)
    expect(h.board).not.toHaveBeenCalled()
  })
})
