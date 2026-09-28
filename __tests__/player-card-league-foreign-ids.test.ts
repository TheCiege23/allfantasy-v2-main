import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE LEAGUE HALF OF THE PLAYER CARD, ON A FOREIGN LEAGUE.
 *
 * `loadLeague` finds who holds him by scanning every roster's `playerData` for his Sleeper id, and
 * lists "your players at his position" by reading your roster's ids as Sleeper ids. A Fleaflicker
 * roster's ids are the provider's own — short numbers that collide with real Sleeper ids — so the card
 * named a stranger's team as his holder and listed strangers as your depth at the position.
 *
 * Prisma is a default-empty stand-in with the few reads this path needs overridden; the same rows in
 * a Sleeper league are the CONTROL, proving the harness can see a holder and a name at all.
 */

type Fn = (...a: any[]) => any
const overrides = vi.hoisted(() => ({}) as Record<string, Record<string, Fn>>)

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => {
  const model = (name: string) =>
    new Proxy(
      {},
      {
        get: (_t, method: string) =>
          overrides[name]?.[method] ??
          (async () => (method === 'findMany' || method === 'groupBy' ? [] : method === 'count' ? 0 : null)),
      },
    )
  return {
    prisma: new Proxy(
      {},
      { get: (_t, name: string) => (name.startsWith('$') ? async () => [] : model(name)) },
    ),
  }
})
vi.mock('@/lib/league-access', () => ({ memberLeaguePlatformIdsFor: vi.fn(async () => []) }))
vi.mock('@/lib/waiver-wire/watchlist-service', () => ({ isWatched: vi.fn(async () => false) }))
vi.mock('@/lib/follows/playerFollows', () => ({ followKeyFor: () => null, isFollowingPlayer: vi.fn(async () => null) }))
vi.mock('@/lib/injuries/injurySyncState', () => ({ readInjurySyncFreshness: vi.fn(async () => null) }))
vi.mock('@/lib/core-app/rosteredMarket', () => ({
  getRosteredMarket: vi.fn(async () => ({ byPlayerId: new Map(), leaguesCounted: 0 })),
}))
vi.mock('@/lib/core-app/playerProjections', () => ({
  latestProjectionWeek: vi.fn(async () => null),
  lookupProjections: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/core-app/archivedTradeGrade', () => ({ gradeArchivedTradeRows: vi.fn(async () => new Map()) }))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({ marketContextFor: () => ({ teams: 12 }) }))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: vi.fn(async () => null), playerValue: () => null }))

import { getPlayerCard } from '@/lib/core-app/playerCard'

const HIM = '6813'

function leagueOn(platform: string) {
  overrides.league = {
    findUnique: async () => ({
      id: 'L1',
      name: 'The League',
      platform,
      settings: {},
      leagueType: 'redraft',
      platformLeagueId: 'P1',
    }),
    findMany: async () => [],
  }
}

beforeEach(() => {
  for (const k of Object.keys(overrides)) delete overrides[k]
  overrides.sportsPlayer = {
    findFirst: async () => ({
      externalId: HIM,
      sleeperId: HIM,
      sport: 'NFL',
      name: 'Real Man',
      position: 'WR',
      team: 'KC',
      number: null,
      imageUrl: null,
      age: null,
      height: null,
      weight: null,
      yearsExp: null,
      college: null,
    }),
    // Only the "your players at his position" read carries a position filter.
    findMany: async (args: { where?: { position?: unknown } }) =>
      args?.where?.position ? [{ sleeperId: '111', name: 'Wrong Player' }] : [],
  }
  /* Both rosters' ids ARE Sleeper ids: '6813' is Real Man, '111' is Wrong Player. */
  overrides.roster = {
    findMany: async () => [
      { id: 'r-them', platformUserId: 'them', playerData: { players: [HIM], starters: [HIM] } },
      { id: 'r-me', platformUserId: 'me', playerData: { players: ['111'], starters: [] } },
    ],
  }
  overrides.leagueTeam = {
    findMany: async () => [
      { id: 't1', externalId: '1', platformUserId: 'them', claimedByUserId: null, ownerName: 'stranger', teamName: 'Stranger FC' },
      { id: 't2', externalId: '2', platformUserId: 'me', claimedByUserId: 'u1', ownerName: 'guap', teamName: 'Mine' },
    ],
  }
})

const REQ = { sport: 'NFL', sleeperId: HIM, leagueId: 'L1', userId: 'u1' }

describe('getPlayerCard — the league half never reads a foreign roster as Sleeper ids', () => {
  it('[control] a Sleeper league names his holder, his slot and your depth at the position', async () => {
    leagueOn('sleeper')
    const card = await getPlayerCard(REQ)
    expect(card?.league).not.toBeNull()
    expect(card!.league!.slot).toBe('STARTER')
    expect(card!.league!.owner?.teamName).toBe('Stranger FC')
    expect(card!.league!.yourRoster.map((p) => p.name)).toEqual(['Wrong Player'])
  })

  it('🛑 a Fleaflicker league with colliding ids names no holder and no stranger as your depth', async () => {
    leagueOn('fleaflicker')
    const card = await getPlayerCard(REQ)
    expect(card?.league).not.toBeNull()
    expect(card!.league!.slot).not.toBe('STARTER')
    expect(card!.league!.owner).toBeNull()
    expect(card!.league!.yourRoster).toEqual([])
    expect(JSON.stringify(card!.league)).not.toContain('Wrong Player')
    expect(JSON.stringify(card!.league)).not.toContain('Stranger FC')
  })
})
