import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A FANTRAX LEAGUE'S PLAYER CARD (2026-11-06).
 *
 * My team in a Fantrax league sends the roster's own id (`04yla`) in the `sleeperId` slot. No
 * `SportsPlayer` row carries it, so every card in the league opened as "This player's card could
 * not be loaded" — five of five on a live NHL league. The card now crosswalks the id through
 * `PlayerIdentityMap.fantraxId` first and reads `SportsPlayer` by the id the linked row speaks.
 *
 * Prisma is a default-empty stand-in; each test sets the few reads it needs. The Sleeper and
 * no-league cases are the CONTROL that every other caller reads exactly as before.
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
  lookupAfEngineProjections: vi.fn(async () => new Map()),
}))
vi.mock('@/lib/core-app/archivedTradeGrade', () => ({ gradeArchivedTradeRows: vi.fn(async () => new Map()) }))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({ marketContextFor: () => ({ teams: 12 }) }))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: vi.fn(async () => null), playerValue: () => null }))

import { anchorLookupFor, getPlayerCard, isWeeklyScheduleSport, NON_WEEKLY_SCHEDULE, slotOfRosterId } from '@/lib/core-app/playerCard'

const SORO = {
  source: 'rolling_insights',
  fetchedAt: new Date('2026-11-01T00:00:00Z'),
  externalId: '1114',
  sleeperId: null,
  sport: 'NHL',
  name: 'Ilya Sorokin',
  position: 'G',
  team: 'NYI',
  number: 30,
  imageUrl: null,
  age: 31,
  height: null,
  weight: null,
  yearsExp: null,
  college: null,
}

function leagueOn(platform: string, sport = 'NHL') {
  overrides.league = { findUnique: async () => ({ id: 'L1', name: 'Top Shelf', platform, sport, settings: {}, leagueType: 'redraft' }) }
}

function identities(rows: Array<{ fantraxId: string; rollingInsightsId?: string | null; sleeperId?: string | null; cfbdId?: string | null }>) {
  overrides.playerIdentityMap = {
    findMany: async (args: { where: { fantraxId: { in: string[] }; sport?: string } }) =>
      rows
        .filter((r) => args.where.fantraxId.in.includes(r.fantraxId))
        .map((r) => ({ canonicalName: 'Someone', position: 'G', currentTeam: 'NYI', rollingInsightsId: null, cfbdId: null, sleeperId: null, ...r })),
  }
}

let anchorWheres: unknown[] = []
beforeEach(() => {
  for (const k of Object.keys(overrides)) delete overrides[k]
  anchorWheres = []
  overrides.sportsPlayer = {
    findFirst: async (args: { where: Record<string, unknown> }) => {
      anchorWheres.push(args.where)
      return args.where.externalId === '1114' && args.where.source === 'rolling_insights' ? SORO : null
    },
    findMany: async () => [],
  }
})

describe('player card anchor in a Fantrax league', () => {
  it('crosswalks the Fantrax id to the Rolling Insights row and opens the card', async () => {
    leagueOn('fantrax')
    identities([{ fantraxId: '04yla', rollingInsightsId: '1114' }])
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '04yla', leagueId: 'L1' })
    expect(card).not.toBeNull()
    expect(card?.player.name).toBe('Ilya Sorokin')
    expect(anchorWheres[0]).toMatchObject({ externalId: '1114', source: 'rolling_insights' })
  })

  it('prefers the linked Sleeper id for an NFL Fantrax row', async () => {
    leagueOn('fantrax', 'NFL')
    identities([{ fantraxId: '06k5m', sleeperId: '4984', rollingInsightsId: '77' }])
    await expect(anchorLookupFor({ sport: 'NFL', sleeperId: '06k5m', leagueId: 'L1' })).resolves.toEqual({ sleeperId: '4984', rosterId: '06k5m' })
  })

  it('an id the registry cannot link is a miss, never retried as a Sleeper id', async () => {
    leagueOn('fantrax')
    identities([])
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '04yla', leagueId: 'L1' })
    expect(card).toBeNull()
    expect(anchorWheres).toEqual([])
  })

  it('an id two identity rows share is refused rather than guessed', async () => {
    leagueOn('fantrax')
    identities([
      { fantraxId: '04yla', rollingInsightsId: '1114' },
      { fantraxId: '04yla', rollingInsightsId: '2222' },
    ])
    await expect(anchorLookupFor({ sport: 'NHL', sleeperId: '04yla', leagueId: 'L1' })).resolves.toBeNull()
  })
})

describe('the card a Fantrax hockey player opens to (live, 2026-11-06)', () => {
  it('says the weekly strip is football-only instead of calling every week a bye', async () => {
    leagueOn('fantrax')
    identities([{ fantraxId: '04yla', rollingInsightsId: '1114' }])
    // A plausible NFL slate on file: before the fix the card searched it for NYI and found a bye.
    overrides.sportsGame = {
      findMany: async () =>
        Array.from({ length: 14 }, (_, i) => ({ homeTeam: `H${i}`, awayTeam: `A${i}`, startTime: new Date(), seasonType: 'regular', venue: null, week: 9 })),
    }
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '04yla', leagueId: 'L1' })
    expect(card?.byeWeek).toBeNull()
    expect(card?.schedule).toEqual({ available: false, reason: NON_WEEKLY_SCHEDULE })
  })

  it("finds who rosters him by the league's own id, not UNREADABLE", async () => {
    leagueOn('fantrax')
    identities([{ fantraxId: '04yla', rollingInsightsId: '1114' }])
    overrides.roster = {
      findMany: async () => [
        { id: 'r1', platformUserId: 'u1', playerData: { players: ['zz999'], starters: ['zz999'] } },
        { id: 'r2', platformUserId: 'u2', playerData: { players: [{ id: '04yla' }, { id: '05abc' }], starters: [{ id: '04yla' }] } },
      ],
    }
    const card = await getPlayerCard({ sport: 'NHL', sleeperId: '04yla', leagueId: 'L1' })
    expect(card?.league?.slot).toBe('STARTER')
  })

  it('weekly sports keep the strip; daily ones do not', () => {
    expect(['NFL', 'ncaaf', null].map(isWeeklyScheduleSport)).toEqual([true, true, true])
    expect(['NBA', 'NHL', 'MLB'].map(isWeeklyScheduleSport)).toEqual([false, false, false])
  })

  it('slotOfRosterId matches bare ids and platform-id objects, exactly', () => {
    expect(slotOfRosterId({ players: ['04yla'], reserve: [] }, '04yla')).toBe('BENCH')
    expect(slotOfRosterId({ players: [{ fantraxId: '04yla' }], ir: [{ fantraxId: '04yla' }] }, '04yla')).toBe('IR SLOT')
    expect(slotOfRosterId({ players: ['04ylaX'] }, '04yla')).toBeNull()
  })
})

describe('control: every other caller reads exactly as before', () => {
  it('a Sleeper league reads the id as a Sleeper id', async () => {
    leagueOn('sleeper', 'NFL')
    await expect(anchorLookupFor({ sport: 'NFL', sleeperId: '4984', leagueId: 'L1' })).resolves.toEqual({ sleeperId: '4984' })
  })

  it('no league reads the id as a Sleeper id without touching the league table', async () => {
    let leagueReads = 0
    overrides.league = { findUnique: async () => { leagueReads += 1; return null } }
    await expect(anchorLookupFor({ sport: 'NFL', sleeperId: '4984' })).resolves.toEqual({ sleeperId: '4984' })
    expect(leagueReads).toBe(0)
  })

  it('an explicit externalId wins unchanged', async () => {
    leagueOn('fantrax')
    await expect(anchorLookupFor({ sport: 'NHL', externalId: '1114', sleeperId: '04yla', leagueId: 'L1' })).resolves.toEqual({ externalId: '1114' })
  })
})
