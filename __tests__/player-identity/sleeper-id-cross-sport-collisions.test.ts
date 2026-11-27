// @vitest-environment node
/**
 * One Sleeper id, two people: the reads fixed alongside the sport-scope guard, on the REAL
 * collisions in production `SportsPlayer`.
 *
 *   1466  NFL Travis Kelce (TE)       NBA JaVale McGee (C)
 *   4866  NFL Saquon Barkley (RB)     NBA AJ Dybantsa (F)
 *   4984  NFL Josh Allen (QB)         NBA Cameron Corhen (F)
 *
 * Every read runs against the catalog in BOTH row orders. "First row wins" and "last row wins" are
 * each right for exactly one of the two orders, so an unscoped read fails one of them whichever
 * tie-break it happens to use — the test cannot pass by the luck of Postgres row order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { COLLISION_ROWS, NBA_NAME, NFL_NAME, fakeFindMany, type CatalogRow } from './sleeperCollisionCatalog'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  rows: [] as unknown[],
  leagueSport: 'NFL' as string | undefined,
  leagueTeams: [] as unknown[],
  rosters: [] as unknown[],
  trade: null as unknown,
  exposures: [] as unknown[],
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayer: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        const { fakeFindMany: f } = await import('./sleeperCollisionCatalog')
        return f(h.rows as CatalogRow[])(args as never)
      }),
    },
    league: {
      findUnique: vi.fn(async () => ({ name: 'Pirate League', sport: h.leagueSport })),
    },
    leagueTeam: { findMany: vi.fn(async () => h.leagueTeams) },
    roster: { findMany: vi.fn(async () => h.rosters) },
    afLeagueTrade: { findUnique: vi.fn(async () => h.trade) },
    appUser: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({ id, displayName: id === 'uA' ? 'Dana' : 'Bob', username: null })),
      ),
      findUnique: vi.fn(async () => null),
    },
    userProfile: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
  },
}))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/shared-services/game-day/UserPlayerExposureService', () => ({
  computeUserPlayerExposure: vi.fn(async () => ({ exposures: h.exposures, connectedLeagueCount: 1 })),
}))

import { composePlayerIdentities } from '@/lib/core-app/playerIdentityCompose'
import { sleeperIdsBySportWhere } from '@/lib/player-identity/externalIdNamespace'
import { getCrossLeagueExposure } from '@/lib/core-app/dash3aPanels'
import { defaultTradeContextBackfillDeps } from '@/lib/trade-market/tradeContextBackfill'
import { loadNativeTradeOffer } from '@/lib/chat-notifications/tradeOfferSources'

const ORDERS: Array<[string, CatalogRow[]]> = [
  ['NBA rows first (fresher)', COLLISION_ROWS],
  ['NFL rows first', [...COLLISION_ROWS].reverse()],
]

beforeEach(() => {
  h.leagueSport = 'NFL'
  h.leagueTeams = []
  h.rosters = []
  h.trade = null
  h.exposures = []
})

describe('the fake catalog is a real control', () => {
  it('an UNSCOPED read returns both people under one id — the shape #4298 shipped', async () => {
    const rows = (await fakeFindMany()({ where: { sleeperId: { in: ['1466'] } } })) as CatalogRow[]
    expect(rows.map((r) => r.name).sort()).toEqual(['JaVale McGee', 'Travis Kelce'])
  })
})

describe('composePlayerIdentities refuses one id that names two sports', () => {
  it.each(ORDERS)('%s: an unscoped NFL+NBA group is left unnamed, never given the other sport\'s name', (_, rows) => {
    const out = composePlayerIdentities(rows)
    for (const id of ['1466', '4866', '4984']) expect(out.get(id)).toBeUndefined()
  })

  it.each(ORDERS)('%s: a one-sport read composes normally', (_, rows) => {
    const out = composePlayerIdentities(rows.filter((r) => r.sport === 'NFL'))
    expect(out.get('1466')?.name).toBe('Travis Kelce')
    expect(out.get('4866')?.name).toBe('Saquon Barkley')
    expect(out.get('4984')?.position).toBe('QB')
  })

  it('a college vendor row stamped with the pro id does not unname the pro player', () => {
    const nfl = COLLISION_ROWS.filter((r) => r.sport === 'NFL' && r.sleeperId === '4866')
    const college = { ...nfl[0]!, id: 'cfbd_x', sport: 'NCAAF', source: 'cfbd', name: 'Saquon Barkley', team: 'PSU' }
    expect(composePlayerIdentities([college, ...nfl]).get('4866')?.team).toBe('PHI')
  })
})

describe('sleeperIdsBySportWhere', () => {
  it('one arm per sport; each id comes back only in the sport it was rostered in', async () => {
    const where = sleeperIdsBySportWhere([
      ['nfl', ['1466', '4866']],
      ['NBA', ['4984']],
      [null, ['1466']], // no sport → dropped, never widened
    ])
    const rows = (await fakeFindMany()({ where })) as CatalogRow[]
    expect(rows.map((r) => `${r.sport}:${r.name}`).sort()).toEqual(['NBA:Cameron Corhen', 'NFL:Saquon Barkley', 'NFL:Travis Kelce'])
  })

  it('no sport at all matches nothing', async () => {
    expect(await fakeFindMany()({ where: sleeperIdsBySportWhere([[undefined, ['1466']]]) })).toEqual([])
  })
})

describe('getCrossLeagueExposure (Home): an NFL and an NBA roster both holding 1466 are two people', () => {
  it.each(ORDERS)('%s', async (_, rows) => {
    h.rows = rows
    h.leagueTeams = [
      { leagueId: 'NFL1', platformUserId: 'me', externalId: '1' },
      { leagueId: 'NBA1', platformUserId: 'me', externalId: '1' },
    ]
    h.rosters = [
      { leagueId: 'NFL1', playerData: { players: ['1466', '4866'], starters: ['1466'] }, league: { platform: 'sleeper', sport: 'NFL' } },
      { leagueId: 'NBA1', playerData: { players: ['1466', '4984'], starters: [] }, league: { platform: 'sleeper', sport: 'NBA' } },
    ]
    const panel = await getCrossLeagueExposure('u1', ['NFL1', 'NBA1'])
    expect(panel.available).toBe(true)
    if (!panel.available) return
    const named = panel.data.rows.map((r) => `${r.name}/${r.position}/${r.count}`).sort()
    // Before: one "1466" row, count 2, named whichever row came back first.
    expect(named).toEqual(['Cameron Corhen/F/1', 'JaVale McGee/C/1', 'Saquon Barkley/RB/1', 'Travis Kelce/TE/1'])
  })
})

describe('trade context backfill: positions come from the trade\'s own sport', () => {
  it.each(ORDERS)('%s', async (_, rows) => {
    h.rows = rows
    const deps = defaultTradeContextBackfillDeps({ remainingMs: () => 60_000 })
    const nfl = await deps.loadPositions('nfl', ['1466', '4866', '4984'])
    expect(Object.fromEntries([...nfl].map(([id, p]) => [id, p.position]))).toEqual({ '1466': 'TE', '4866': 'RB', '4984': 'QB' })
    const nba = await deps.loadPositions('NBA', ['1466'])
    expect(nba.get('1466')?.position).toBe('C')
  })
})

describe('trade-offer DM card (native league): names the league\'s sport, or nobody', () => {
  const trade = {
    id: 't1',
    leagueId: 'L1',
    proposerRosterId: 'rA',
    receiverRosterId: 'rB',
    proposedByUserId: 'uA',
    status: 'pending',
    items: ['1466', '4866', '4984'].map((id, i) => ({
      itemType: 'player',
      itemReference: id,
      fromRosterId: i % 2 ? 'rB' : 'rA',
      toRosterId: i % 2 ? 'rA' : 'rB',
      metadata: {},
    })),
  }

  it.each(ORDERS)('%s: an NFL league\'s card names Kelce, Barkley and Allen', async (_, rows) => {
    h.rows = rows
    h.trade = trade
    h.rosters = [
      { id: 'rA', platformUserId: 'uA' },
      { id: 'rB', platformUserId: 'uB' },
    ]
    const loaded = await loadNativeTradeOffer('t1')
    const text = JSON.stringify(loaded)
    for (const id of ['1466', '4866', '4984']) {
      expect(text).toContain(NFL_NAME[id])
      expect(text).not.toContain(NBA_NAME[id])
    }
  })

  it.each(ORDERS)('%s: an NBA league\'s card names McGee, Dybantsa and Corhen', async (_, rows) => {
    h.rows = rows
    h.trade = trade
    h.leagueSport = 'NBA'
    h.rosters = [
      { id: 'rA', platformUserId: 'uA' },
      { id: 'rB', platformUserId: 'uB' },
    ]
    const text = JSON.stringify(await loadNativeTradeOffer('t1'))
    for (const id of ['1466', '4866', '4984']) {
      expect(text).toContain(NBA_NAME[id])
      expect(text).not.toContain(NFL_NAME[id])
    }
  })
})

describe('/api/players/my-exposure: an NFL Sleeper id is enriched from the NFL row', () => {
  it.each(ORDERS)('%s', async (_, rows) => {
    h.rows = rows
    h.exposures = ['1466', '4866', '4984'].map((id) => ({
      playerId: id,
      idSpace: 'sleeper',
      sport: 'NFL',
      playerName: null,
      position: null,
      leagueCount: 1,
      rosterCount: 1,
      startingCount: 1,
      benchCount: 0,
      irTaxiCount: 0,
      exposurePercent: 100,
    }))
    const { GET } = await import('@/app/api/players/my-exposure/route')
    const body = await (await GET(new Request('http://x/api/players/my-exposure'))).json()
    const names = Object.fromEntries((body.players as Array<{ playerId: string; name: string }>).map((p) => [p.playerId, p.name]))
    expect(names).toEqual(NFL_NAME)
  })
})
