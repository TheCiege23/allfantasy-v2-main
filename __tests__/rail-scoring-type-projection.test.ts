import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 THE RAIL'S MATCHUP CHIP DRAWS NO POINTS PROJECTION FOR A CATEGORY OR ROTO LEAGUE.
 *
 * `loadRailProjections` priced every league's starters in fantasy points. A categories or rotisserie
 * league (Fantrax: `fantrax_settings.scoringSystem.type`) is not won on points, so the chip's
 * "PROJ 112.4" there described nothing. The league's format is now read with `weeklyFormat` — the
 * rule the week board and Season Outlook use — from a settings subpath, and such a league's sides are
 * left unpriced, which the chip already renders as `PROJ —`. Harness from
 * rail-projection-availability.test.ts.
 */
const h = vi.hoisted(() => ({ raw: vi.fn(), projections: vi.fn(), latest: vi.fn(), afEngine: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  $queryRawUnsafe: h.raw, sportsPlayer: { findMany: vi.fn(async () => []) }, sportsInjury: { findMany: vi.fn(async () => []) },
} }))
vi.mock('@/lib/core-app/playerProjections', async (importOriginal) => ({
  afEngineForLeague: (await importOriginal<typeof import('@/lib/core-app/playerProjections')>()).afEngineForLeague,
  lookupProjections: h.projections,
  latestProjectionWeek: h.latest,
  lookupAfEngineProjections: h.afEngine,
}))
vi.mock('@/lib/core-app/byeWeeks', () => ({ getByeWeeks: vi.fn(async () => null) }))

import { loadRailProjections } from '@/lib/core-app/railMatchups'

const meta = (id: string, formatSettings: unknown, leagueType: string | null = 'redraft') => ({
  id, sport: 'NFL', platform: 'sleeper', scoring_settings: { rec: 1 }, scoringSettings: null, yahoo_settings: null,
  confirmedType: null, leagueType, guillotineMode: false, formatSettings,
})
const fantrax = (type: string) => ({ fantrax_settings: { scoringSystem: { type } } })
const fixtures = (ids: string[]) => ({
  fixtures: ids.map((id) => ({ dbLeagueId: id, platformLeagueId: id, rosterIds: ['team'] })),
  teamByKey: new Map(ids.map((id) => [id + ':team', { externalId: 'team', rosterKeys: ['user'] }])),
  season: 2026, week: 3,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.projections.mockReset().mockResolvedValue(new Map([['p1', { projectedPoints: 15, componentStats: { rec: 6 } }]]))
  h.latest.mockReset().mockResolvedValue(null)
  h.afEngine.mockReset().mockResolvedValue(new Map())
})

function load(metas: unknown[]) {
  const ids = metas.map((m) => (m as { id: string }).id)
  h.raw.mockReset().mockResolvedValueOnce(metas)
    .mockResolvedValueOnce(ids.map((leagueId) => ({ leagueId, platformUserId: 'user', starters: ['p1'] })))
  return loadRailProjections(fixtures(ids))
}

describe('rail projections — points only for head-to-head points leagues', () => {
  it('control: a head-to-head points league is priced', async () => {
    const result = await load([meta('H', fantrax('HEAD_TO_HEAD_POINTS_BASED'))])
    expect(result.byLeague.get('H')?.sides.get('team')?.projected).toBe(15)
  })

  it.each([
    ['Fantrax categories', fantrax('HEAD_TO_HEAD_CATEGORIES'), 'redraft'],
    ['Fantrax roto', fantrax('ROTISSERIE'), 'redraft'],
    ['a categories league type', {}, 'h2h_categories'],
  ])('🛑 %s is not priced in points, and a points league beside it still is', async (_label, settings, leagueType) => {
    const result = await load([meta('C', settings, leagueType), meta('H', {})])
    expect(result.byLeague.get('C')?.sides.get('team') ?? null).toBeNull()
    expect(result.byLeague.get('H')?.sides.get('team')?.projected).toBe(15)
  })

  /* A Yahoo league's scoring type lives only in the raw `yahoo_settings` the rail already selects. */
  it('🛑 a Yahoo head-to-head categories league is not priced in points; a Yahoo points league is', async () => {
    const yahoo = (scoring_type: string, id: string) => ({ ...meta(id, {}), yahoo_settings: { scoring_type } })
    const result = await load([yahoo('head', 'C'), yahoo('headpoint', 'H')])
    expect(result.byLeague.get('C')?.sides.get('team') ?? null).toBeNull()
    expect(result.byLeague.get('H')?.sides.get('team')?.projected).toBe(15)
  })

  it('reads the format from a settings subpath, never the whole settings column', async () => {
    await load([meta('H', {})])
    const sql = String(h.raw.mock.calls[0][0])
    expect(sql).toMatch(/AS "formatSettings"/)
    expect(sql).toContain(`'fantrax_settings'`)
    expect(sql).not.toMatch(/settings\s+AS/)
  })
})
