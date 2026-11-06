// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 A NON-NFL LEAGUE IS NEVER PRICED FROM NFL PROJECTION ROWS.
 *
 * `fantasy_projections` holds the NFL feed (the importer writes `sport: 'NFL'`) keyed by Sleeper id.
 * A Sleeper NBA league's roster ids are Sleeper ids too — from Sleeper's NBA namespace, which is
 * numbered independently of the NFL one (migration 20261103050000_nba_sleeper_identity_bridge). Both
 * are short numeric strings, so an NBA starter whose id equals an NFL player's matched that NFL row:
 * `lookupProjections` / `lookupAfEngineProjections` filtered on `playerId` alone, and the rail priced
 * every league's starters through one such read keyed by id. The NFL stranger's points were summed
 * into the NBA side.
 *
 * The lookups are REAL here; the prisma double honours a `sport` filter when the caller sends one, as
 * Postgres would, and ignores it when the caller does not — so an unscoped read is exactly what lets
 * the stranger in.
 */
const h = vi.hoisted(() => ({
  raw: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  findMany: vi.fn(),
}))

function matches(row: Record<string, unknown>, where: Record<string, any>): boolean {
  if (where.playerId?.in && !where.playerId.in.includes(row.playerId)) return false
  if (where.season != null && row.season !== where.season) return false
  if (where.week != null && row.week !== where.week) return false
  if (typeof where.source === 'string' && row.source !== where.source) return false
  if (where.source?.not != null && row.source === where.source.not) return false
  if (where.sport != null && row.sport !== where.sport) return false
  return true
}

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: h.raw,
    fantasyProjection: {
      findMany: h.findMany,
      findFirst: vi.fn(async () => null),
    },
    aFProjectionSnapshot: { findMany: vi.fn(async () => []) },
    sportsPlayer: { findMany: vi.fn(async () => []) },
    sportsInjury: { findMany: vi.fn(async () => []) },
  },
}))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: vi.fn(async () => null) }))

import { lookupAfEngineProjections, lookupProjections } from '@/lib/core-app/playerProjections'
import { loadRailProjections } from '@/lib/core-app/railMatchups'

const AT = { season: '2026', week: 3 }
/** "2002" is an NFL Sleeper id on the feed AND the id an NBA Sleeper league's starter carries. */
const SHARED_ID = '2002'

beforeEach(() => {
  vi.clearAllMocks()
  h.rows = [
    {
      playerId: SHARED_ID, sport: 'NFL', season: '2026', week: 3, source: 'sleeper', projectedPoints: 18,
      stats: { name: 'NFL Namesake', position: 'RB', team: 'KC', stats: { rec: 6 } },
    },
    {
      playerId: SHARED_ID, sport: 'NFL', season: '2026', week: 3, source: 'allfantasy', projectedPoints: 20,
      stats: { name: 'NFL Namesake', position: 'RB', basis: 'sleeper_weekly_projection', confidenceLevel: 'high' },
    },
  ]
  h.findMany.mockImplementation(async (args: { where: Record<string, any> }) => h.rows.filter((r) => matches(r, args.where)))
})

describe('lookupProjections / lookupAfEngineProjections — scoped to the league sport', () => {
  it('🛑 an NBA lookup prices nothing from an NFL row sharing the id', async () => {
    expect((await lookupProjections([SHARED_ID], AT, null, 'NBA')).size).toBe(0)
    expect((await lookupProjections([SHARED_ID], AT, null, 'nba')).size).toBe(0)
    expect((await lookupAfEngineProjections([SHARED_ID], AT, 'NBA')).size).toBe(0)
  })

  it('control: an NFL lookup, or one with no sport, still finds the row', async () => {
    expect((await lookupProjections([SHARED_ID], AT, null, 'NFL')).get(SHARED_ID)?.projectedPoints).toBe(18)
    expect((await lookupProjections([SHARED_ID], AT)).get(SHARED_ID)?.projectedPoints).toBe(18)
    expect((await lookupAfEngineProjections([SHARED_ID], AT, 'NFL')).get(SHARED_ID)?.projectedPoints).toBe(20)
    expect((await lookupAfEngineProjections([SHARED_ID], AT)).get(SHARED_ID)?.projectedPoints).toBe(20)
  })

  it('an NFL or sport-less lookup sends exactly the query it always did — no sport key', async () => {
    await lookupProjections([SHARED_ID], AT, null, 'NFL')
    await lookupProjections([SHARED_ID], AT)
    await lookupAfEngineProjections([SHARED_ID], AT, 'NFL')
    await lookupAfEngineProjections([SHARED_ID], AT)
    const wheres = h.findMany.mock.calls.map(([args]) => args.where)
    expect(wheres).toEqual([
      { playerId: { in: [SHARED_ID] }, season: '2026', week: 3, source: { not: 'allfantasy' } },
      { playerId: { in: [SHARED_ID] }, season: '2026', week: 3, source: { not: 'allfantasy' } },
      { playerId: { in: [SHARED_ID] }, season: '2026', week: 3, source: 'allfantasy' },
      { playerId: { in: [SHARED_ID] }, season: '2026', week: 3, source: 'allfantasy' },
    ])
  })
})

describe('rail — an NBA Sleeper league beside an NFL one', () => {
  const meta = (id: string, sport: string) => ({
    id, sport, platform: 'sleeper', scoring_settings: { rec: 1 }, scoringSettings: null, yahoo_settings: null,
    confirmedType: null, leagueType: 'redraft', guillotineMode: false, formatSettings: {},
  })
  function load(leagues: Array<[string, string]>) {
    h.raw.mockReset()
      .mockResolvedValueOnce(leagues.map(([id, sport]) => meta(id, sport)))
      .mockResolvedValueOnce(leagues.map(([leagueId]) => ({ leagueId, platformUserId: 'user', starters: [SHARED_ID] })))
    const ids = leagues.map(([id]) => id)
    return loadRailProjections({
      fixtures: ids.map((id) => ({ dbLeagueId: id, platformLeagueId: id, rosterIds: ['team'] })),
      teamByKey: new Map(ids.map((id) => [`${id}:team`, { externalId: 'team', rosterKeys: ['user'] }])),
      season: 2026,
      week: 3,
    })
  }

  it('🛑 the NBA side prices nothing from the NFL row sharing its starter id', async () => {
    const result = await load([['NBA1', 'NBA'], ['NFL1', 'NFL']])
    const nba = result.byLeague.get('NBA1')?.sides.get('team') ?? null
    expect(nba?.projected ?? null).toBeNull()
    expect(nba?.afProjected ?? null).toBeNull()
    expect(nba?.afEngine ?? null).toBeNull()
  })

  it('🛑 an NBA-only rail never asks the feed about its starters', async () => {
    const result = await load([['NBA1', 'NBA']])
    expect(result.byLeague.get('NBA1')?.sides.get('team')?.projected ?? null).toBeNull()
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('control: the NFL side beside it prices exactly as before', async () => {
    const result = await load([['NBA1', 'NBA'], ['NFL1', 'NFL']])
    expect(result.byLeague.get('NFL1')?.sides.get('team')).toMatchObject({
      projected: 18,
      afProjected: 6,
      pricedFrom: 1,
      starterCount: 1,
    })
    expect(result.byLeague.get('NFL1')?.sides.get('team')?.afEngine).not.toBeNull()
  })
})
