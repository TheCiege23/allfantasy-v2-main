// @vitest-environment node
/**
 * The game-day triage loader and foreign roster ids.
 *
 * 🛑 A Fleaflicker/MFL/Fantrax/Yahoo roster holds the PROVIDER's ids, short numbers in Sleeper's
 * range. '6038' below is a real Sleeper id in the fake catalog, owned by "Wrong Player" who is Out.
 * Reading the Fleaflicker starter as a Sleeper id flags a stranger's injury as yours.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const db = vi.hoisted(() => ({ platform: 'fleaflicker' }))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueTeam: {
      findMany: vi.fn(async () => [{ id: 'T1', leagueId: 'L1', platformUserId: 'me', externalId: '4' }]),
    },
    league: {
      findMany: vi.fn(async () => [
        {
          id: 'L1', name: 'Flea League', platform: db.platform, season: 2026, status: 'in_season',
          lifecycleState: null, bestBallMode: false, leagueVariant: null, guillotineMode: false, leagueType: null, settings: {},
        },
      ]),
    },
    roster: {
      findMany: vi.fn(async () => [
        { id: 'R1', leagueId: 'L1', platformUserId: 'me', playerData: { players: ['6038', '6039'], starters: ['6038'] } },
      ]),
    },
    guillotineRosterState: { findMany: vi.fn(async () => []) },
    guillotineElimination: { findMany: vi.fn(async () => []) },
    sportsPlayer: {
      findMany: vi.fn(async ({ where }: { where: { sleeperId: { in: string[] } } }) =>
        where.sleeperId.in.includes('6038')
          ? [{ sleeperId: '6038', sport: 'NFL', externalId: '6038', name: 'Wrong Player', position: 'WR', team: 'NYJ', imageUrl: null }]
          : [],
      ),
    },
    sportsInjury: {
      findMany: vi.fn(async () => [
        {
          playerName: 'Wrong Player', team: 'NYJ', status: 'Out', description: 'Hamstring',
          date: new Date('2026-09-26T12:00:00Z'), fetchedAt: new Date('2026-09-26T12:00:00Z'),
        },
      ]),
    },
    sportsGame: { findMany: vi.fn(async () => []) },
    // The identity bridge (bridgedRosterIds.ts): no Fleaflicker id bridges here, so the league
    // stays unreadable — the collision this file guards must never be read raw.
    playerIdentityMap: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/core-app/sportsWeek', () => ({ resolveSportsWeek: vi.fn(async () => null) }))

import { prisma } from '@/lib/prisma'
import { loadGameDayTriage } from '@/lib/core-app/gameDayTriageLoader'

const NOW = '2026-09-27T12:00:00.000Z'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('loadGameDayTriage — foreign roster ids', () => {
  it('🛑 never flags a stranger from a Fleaflicker lineup, and does not count that lineup as read', async () => {
    db.platform = 'fleaflicker'
    const state = await loadGameDayTriage('u1', ['L1'], NOW)
    expect(state.available).toBe(true)
    if (!state.available) return
    expect(JSON.stringify(state.data)).not.toContain('Wrong Player')
    expect(state.data.rows).toHaveLength(0)
    expect(state.data.leaguesRead).toBe(0)
    expect(prisma.sportsPlayer.findMany).not.toHaveBeenCalled()
  })

  it('CONTROL: the same starter in a Sleeper league IS named and flagged', async () => {
    db.platform = 'sleeper'
    const state = await loadGameDayTriage('u1', ['L1'], NOW)
    expect(state.available).toBe(true)
    if (!state.available) return
    expect(state.data.leaguesRead).toBe(1)
    expect(state.data.rows.map((r) => r.player.name)).toEqual(['Wrong Player'])
    expect(state.data.rows[0].status?.tone).toBe('bad')
  })
})
