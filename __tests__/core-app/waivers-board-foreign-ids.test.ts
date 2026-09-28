import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A FOREIGN LEAGUE'S ROSTER IDS COLLIDE WITH REAL SLEEPER IDS.
 *
 * Fleaflicker ids are short numbers in Sleeper's range (51 of 248 on the one production league ARE
 * real `SportsPlayer.sleeperId`s). The waivers board used to read them raw: once enough of a roster
 * collided to clear `ID_SPACE_FLOOR`, the league was "priced" and the board named a stranger as the
 * weakest player to drop, and struck real Sleeper players off the wire as "rostered".
 *
 * The same roster in a Sleeper league is the CONTROL: it proves the harness can see a name at all.
 */

const prismaMock = vi.hoisted(() => ({
  leagueTeam: { findMany: vi.fn() },
  roster: { findMany: vi.fn() },
  leagueWaiverSettings: { findMany: vi.fn() },
  fantasyProjection: { findMany: vi.fn() },
  sportsPlayer: { findMany: vi.fn() },
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => ({ season: '2026', week: 4 })),
}))
vi.mock('@/lib/core-app/rosteredMarket', () => ({
  MIN_LEAGUES_FOR_MARKET: 8,
  getRosteredMarket: vi.fn(async () => ({ byPlayerId: new Map(), leaguesCounted: 0 })),
}))
vi.mock('@/lib/core-app/leagueHome', () => ({ leagueDisplayName: (n: string | null) => n ?? 'League' }))

import { getWaiversBoard } from '@/lib/core-app/waiversBoard'

function claimed(platform: string) {
  return [
    {
      leagueId: 'L1',
      externalId: '1',
      platformUserId: 'me',
      league: {
        id: 'L1',
        name: 'The League',
        platform,
        sport: 'NFL',
        settings: { scoring_settings: { rec: 1 } },
        platformLeagueId: 'P1',
        leagueType: 'redraft',
        scoring: null,
        logoUrl: null,
        avatarUrl: null,
      },
    },
  ]
}

/* Your roster: '6038' starts, '6039' sits. Both ARE real Sleeper ids in the fake player table. */
const ROSTERS = [
  { leagueId: 'L1', platformUserId: 'me', faabRemaining: 50, playerData: { players: ['6038', '6039'], starters: ['6038'] } },
  { leagueId: 'L1', platformUserId: 'them', faabRemaining: 50, playerData: { players: ['7000'], starters: ['7000'] } },
]

const proj = (playerId: string, rec: number) => ({ playerId, projectedPoints: rec, stats: { stats: { rec } } })

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.roster.findMany.mockResolvedValue(ROSTERS)
  prismaMock.leagueWaiverSettings.findMany.mockResolvedValue([])
  prismaMock.fantasyProjection.findMany.mockResolvedValue([proj('8000', 10), proj('6038', 9), proj('7000', 8), proj('6039', 3)])
  prismaMock.sportsPlayer.findMany.mockResolvedValue([
    { id: 'u1', externalId: '6038', sleeperId: '6038', name: 'Wrong Starter', position: 'WR', team: 'KC', imageUrl: null },
    { id: 'u2', externalId: '6039', sleeperId: '6039', name: 'Wrong Player', position: 'WR', team: 'KC', imageUrl: null },
    { id: 'u3', externalId: '7000', sleeperId: '7000', name: 'Their Guy', position: 'WR', team: 'KC', imageUrl: null },
    { id: 'u4', externalId: '8000', sleeperId: '8000', name: 'Free Agent Guy', position: 'WR', team: 'KC', imageUrl: null },
  ])
})

describe('getWaiversBoard — foreign roster ids never reach a Sleeper-id read', () => {
  it('CONTROL: a Sleeper league names the roster ids — the harness can see names', async () => {
    prismaMock.leagueTeam.findMany.mockResolvedValue(claimed('sleeper'))
    const board = await getWaiversBoard('user-1')
    expect(board.rows).toHaveLength(1)
    expect(board.rows[0].add.name).toBe('Free Agent Guy')
    expect(board.rows[0].drop?.name).toBe('Wrong Player')
  })

  it('a Fleaflicker league with colliding ids names no stranger and is withheld as idSpace', async () => {
    prismaMock.leagueTeam.findMany.mockResolvedValue(claimed('fleaflicker'))
    const board = await getWaiversBoard('user-1')
    expect(board.rows).toHaveLength(0)
    expect(board.withheld.idSpace).toBe(1)
    expect(JSON.stringify(board)).not.toContain('Wrong Player')
  })
})
