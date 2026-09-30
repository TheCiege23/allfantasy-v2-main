/**
 * `getGameStarters` — your starters in ONE game, for the clicked-game view.
 * Same roster read and the same starters-only rule as the slate card.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  leagueTeamFindMany: vi.fn(),
  rosterFindMany: vi.fn(),
  weeklyScoreFindMany: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
  sportsGameFindFirst: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: { findMany: m.leagueTeamFindMany },
    roster: { findMany: m.rosterFindMany },
    leaguePlayerWeeklyScore: { findMany: m.weeklyScoreFindMany },
    sportsPlayer: { findMany: m.sportsPlayerFindMany },
    sportsGame: { findFirst: m.sportsGameFindFirst },
  },
}))
vi.mock('@/lib/live/playFeedPresentation', () => ({ getPlayFeed: vi.fn(async () => []) }))

import { getGameStarters } from '@/lib/live/liveScoresPage'

const GAME = { sport: 'NFL', gameId: '401872925', homeAbbrev: 'BUF', awayAbbrev: 'PIT' }

beforeEach(() => {
  vi.clearAllMocks()
  // A league that states no week of its own, so the game's week has to decide.
  m.leagueTeamFindMany.mockResolvedValue([
    { leagueId: 'L1', league: { id: 'L1', name: 'Turf Wars', platformLeagueId: 'p1', sport: 'NFL', season: 2026 } },
  ])
  m.rosterFindMany.mockResolvedValue([
    { id: 'r1', leagueId: 'L1', platformUserId: 'u1', playerData: { players: ['home', 'away', 'bench', 'elsewhere'], starters: ['home', 'away', 'elsewhere'] } },
  ])
  m.sportsPlayerFindMany.mockResolvedValue([
    { sleeperId: 'home', name: 'Home Starter', position: 'RB', team: 'BUF', sport: 'NFL' },
    { sleeperId: 'away', name: 'Away Starter', position: 'WR', team: 'PIT', sport: 'NFL' },
    { sleeperId: 'bench', name: 'Home Bench', position: 'WR', team: 'BUF', sport: 'NFL' },
    { sleeperId: 'elsewhere', name: 'Other Game', position: 'QB', team: 'KC', sport: 'NFL' },
  ])
  m.sportsGameFindFirst.mockResolvedValue({ season: 2026, week: 3 })
  m.weeklyScoreFindMany.mockResolvedValue([
    { leagueId: 'p1', playerId: 'home', points: 14.2, week: 3 },
    { leagueId: 'p1', playerId: 'away', points: 6, week: 3 },
  ])
})

describe('getGameStarters', () => {
  it('is null when signed out, and reads nothing', async () => {
    expect(await getGameStarters({ ...GAME, userId: null })).toBeNull()
    expect(m.leagueTeamFindMany).not.toHaveBeenCalled()
  })

  it('returns your starters on either team — not your bench, not another game', async () => {
    const r = await getGameStarters({ ...GAME, userId: 'u1' })
    expect(r?.rosterFailed).toBe(false)
    expect(r?.tieIns.map((t) => [t.playerId, t.team, t.points])).toEqual([
      ['home', 'BUF', 14.2],
      ['away', 'PIT', 6],
    ])
  })

  it('takes the week from the game itself when the league states none', async () => {
    const r = await getGameStarters({ ...GAME, userId: 'u1' })
    expect(m.sportsGameFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ sport: 'NFL', externalId: '401872925' }) }),
    )
    expect(r?.tieIns[0]?.points).toBe(14.2)
  })

  it('without a known week, shows points as unknown rather than guessing one', async () => {
    m.sportsGameFindFirst.mockResolvedValue(null)
    const r = await getGameStarters({ ...GAME, userId: 'u1' })
    expect(r?.tieIns.map((t) => t.points)).toEqual([null, null])
  })

  it('reads the game\'s clubs through the NFL aliases (WSH is WAS)', async () => {
    m.sportsPlayerFindMany.mockResolvedValue([{ sleeperId: 'home', name: 'Home Starter', position: 'RB', team: 'WAS', sport: 'NFL' }])
    const r = await getGameStarters({ ...GAME, homeAbbrev: 'WSH', userId: 'u1' })
    expect(r?.tieIns.map((t) => t.playerId)).toEqual(['home'])
  })

  it('reports a failed roster read as a failure, never as "no starters"', async () => {
    m.weeklyScoreFindMany.mockRejectedValue(Object.assign(new Error('P2021'), { code: 'P2021' }))
    const r = await getGameStarters({ ...GAME, userId: 'u1' })
    expect(r).toEqual({ tieIns: [], hasRosterData: false, rosterFailed: true })
  })
})
