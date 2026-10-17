import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({ teams: vi.fn(), latest: vi.fn(), priced: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findMany: h.teams } } }))
vi.mock('@/lib/core-app/playerProjections', () => ({ latestProjectionWeek: h.latest }))
vi.mock('@/lib/core-app/railMatchups', () => ({ loadRailProjections: h.priced }))

import { getStandingsLineups } from '@/lib/core-app/standingsLineups'

const side = (over: Record<string, unknown> = {}) => ({
  projected: 110, afProjected: 118, afEngine: 121, afEngineFrom: 9, pricedFrom: 9, starterCount: 9, ...over,
})

beforeEach(() => {
  vi.resetAllMocks()
  h.latest.mockResolvedValue({ season: '2026', week: 4 })
  h.teams.mockResolvedValue([
    { externalId: '1', platformUserId: 'sl-1', claimedByUserId: null, teamName: 'Alpha', ownerName: null },
    { externalId: '2', platformUserId: 'sl-2', claimedByUserId: 'u1', teamName: null, ownerName: 'guap' },
    { externalId: null, platformUserId: 'x', claimedByUserId: null, teamName: 'No Id', ownerName: null },
  ])
  h.priced.mockResolvedValue({
    byLeague: new Map([['L', { elimination: false, sides: new Map([['1', side({ afEngine: 101 })], ['2', side({ afEngine: 125, afEngineFrom: 8 })]]) }]]),
    projectionWeek: { season: '2026', week: 4 },
  })
})

describe('getStandingsLineups', () => {
  it('prices every team through the rail loader and ranks by AF', async () => {
    const r = await getStandingsLineups({ league: { id: 'L', platformLeagueId: 'P' }, userId: 'u1' })
    expect(r?.week).toBe(4)
    expect(r?.rows.map((x) => [x.rosterId, x.name, x.isYou, x.af, x.afFrom, x.api])).toEqual([
      ['2', 'guap', true, 125, 8, 118],
      ['1', 'Alpha', false, 101, 9, 118],
    ])
    const call = h.priced.mock.calls[0][0]
    expect(call.fixtures).toEqual([{ dbLeagueId: 'L', platformLeagueId: 'P', rosterIds: ['1', '2'] }])
    // The same three roster keys the rail tries, in order.
    expect(call.teamByKey.get('P:2')).toEqual({ externalId: '2', rosterKeys: ['sl-2', 'u1', '2'] })
    expect([call.season, call.week]).toEqual([2026, 4])
  })

  it('states the week the feed actually served when it fell back', async () => {
    h.priced.mockResolvedValue({
      byLeague: new Map([['L', { elimination: false, sides: new Map([['1', side()]]) }]]),
      projectionWeek: { season: '2026', week: 5 },
    })
    expect((await getStandingsLineups({ league: { id: 'L', platformLeagueId: 'P' }, userId: 'u1' }))?.week).toBe(5)
  })

  it('is null — no section — when nothing priced, no week is published, or a read fails', async () => {
    h.priced.mockResolvedValueOnce({ byLeague: new Map(), projectionWeek: null })
    expect(await getStandingsLineups({ league: { id: 'L', platformLeagueId: 'P' }, userId: 'u1' })).toBeNull()
    h.latest.mockResolvedValueOnce(null)
    expect(await getStandingsLineups({ league: { id: 'L', platformLeagueId: 'P' }, userId: 'u1' })).toBeNull()
    h.priced.mockRejectedValueOnce(new Error('db down'))
    expect(await getStandingsLineups({ league: { id: 'L', platformLeagueId: 'P' }, userId: 'u1' })).toBeNull()
  })
})
