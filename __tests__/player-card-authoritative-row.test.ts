import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * getPlayerCard took the NEWEST SportsPlayer row for a Sleeper id. Production, 2026-10-12: Sleeper
 * 5864 is CB Byron Murphy (MIN) on its Sleeper row and DT Byron Murphy (SEA) on a fresher TheSportsDB
 * row that took the id by a name match — so the card printed the Seahawks tackle for the Vikings corner.
 * Prisma is the default-empty stand-in from player-card-league-foreign-ids with SportsPlayer overridden.
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
    prisma: new Proxy({}, { get: (_t, name: string) => (name.startsWith('$') ? async () => [] : model(name)) }),
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

const blank = { number: null, height: null, weight: null, yearsExp: null, college: null, sport: 'NFL' }
const TSDB_DT = {
  ...blank,
  source: 'thesportsdb',
  externalId: 'tsdb_1',
  sleeperId: '5864',
  name: 'Byron Murphy',
  position: 'DT',
  team: 'Seattle Seahawks',
  imageUrl: 'https://img/dt.png',
  age: 23,
  fetchedAt: new Date('2026-10-11T08:42:36Z'),
}
const SLEEPER_CB = {
  ...blank,
  source: 'sleeper',
  externalId: '5864',
  sleeperId: '5864',
  name: 'Byron Murphy',
  position: 'CB',
  team: 'Minnesota Vikings',
  imageUrl: null,
  age: 28,
  fetchedAt: new Date('2026-10-10T12:06:58Z'),
}
const ROWS = [TSDB_DT, SLEEPER_CB]

beforeEach(() => {
  for (const k of Object.keys(overrides)) delete overrides[k]
  overrides.sportsPlayer = {
    // The old read: newest row for the requested key.
    findFirst: async ({ where }: { where: Record<string, any> }) =>
      where.externalId ? ROWS.find((r) => r.externalId === where.externalId) ?? null : TSDB_DT,
    findMany: async ({ where }: { where: Record<string, any> }) =>
      where.sleeperId ? ROWS.filter((r) => r.sleeperId === where.sleeperId.equals) : [],
  }
})

describe('getPlayerCard — the Sleeper row speaks for a Sleeper id', () => {
  it('shows the Vikings corner for 5864, not the fresher TheSportsDB tackle', async () => {
    const card = await getPlayerCard({ sport: 'NFL', sleeperId: '5864' })
    expect(card?.player.position).toBe('CB')
    expect(card?.player.team).toBe('Minnesota Vikings')
    // The contradicting row fills nothing — not even the headshot the Sleeper row lacks.
    expect(card?.player.imageUrl).toBeNull()
  })

  it('a row asked for by its own externalId that contradicts the Sleeper row is shown as asked', async () => {
    const card = await getPlayerCard({ sport: 'NFL', externalId: 'tsdb_1' })
    expect(card?.player.position).toBe('DT')
    expect(card?.player.team).toBe('Seattle Seahawks')
  })
})
