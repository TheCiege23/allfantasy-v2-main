import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ session: vi.fn(), teams: vi.fn(), feed: vi.fn(), weeks: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findMany: h.teams }, weeklyMatchup: { findMany: h.weeks } } }))
vi.mock('@/lib/core-app/sleeperRailFeed', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/core-app/sleeperRailFeed')>(), sleeperRailFeed: h.feed,
}))
import { GET } from '@/app/api/core/rail-scores/route'
const request = (...ids: string[]) => new NextRequest(`https://allfantasy.ai/api/core/rail-scores?${new URLSearchParams(ids.map(id => ['league', id]))}`)
beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'me' } })
  h.teams.mockResolvedValueOnce([{ externalId: '1', league: { id: 'mine', platform: 'sleeper', platformLeagueId: '123456789012345678', guillotineMode: false } }])
    .mockResolvedValueOnce([{ leagueId: 'mine', externalId: '1', teamName: 'Home' }, { leagueId: 'mine', externalId: '2', teamName: 'Away' }])
  h.feed.mockImplementation(async (path: string) => {
    if (path === 'state/nfl') return { season: '2026', week: 2, season_type: 'regular' }
    if (path.includes('/matchups/')) return [{ roster_id: 1, matchup_id: 1, points: 20 }, { roster_id: 2, matchup_id: 1, points: 10, custom_points: 0 }]
    return { sport: 'nfl', season: '2026' }
  })
})
describe('authenticated live rail endpoint', () => {
  it('rejects anonymous access before reading league data', async () => {
    h.session.mockResolvedValue(null)
    expect((await GET(request('mine'))).status).toBe(401)
    expect(h.teams).not.toHaveBeenCalled()
    expect(h.feed).not.toHaveBeenCalled()
  })
  it('bounds request fanout', async () => {
    expect((await GET(request(...Array.from({ length: 9 }, (_, i) => String(i))))).status).toBe(400)
    expect(h.teams).not.toHaveBeenCalled()
  })
  it('uses owned roster mappings and never fetches an unauthorized league', async () => {
    const response = await GET(request('mine', 'foreign'))
    const data = await response.json()
    expect(h.teams.mock.calls[0][0].where.claimedByUserId).toBe('me')
    expect(data.unavailable).toEqual(['foreign'])
    expect(data.updates.mine).toMatchObject({ yourScore: 20, opponentScore: 0, yourTeam: 'Home', opponentTeam: 'Away', season: 2026, week: 2 })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(h.feed).toHaveBeenCalledWith('league/123456789012345678/matchups/2', 20_000)
  })
  it('does not relabel last season as live this season', async () => {
    h.feed.mockImplementation(async (path: string) => path === 'state/nfl' ? { season: '2026', week: 2, season_type: 'regular' } : { sport: 'nfl', season: '2025' })
    const data = await (await GET(request('mine'))).json()
    expect(data.updates).toEqual({})
    expect(data.unavailable).toEqual(['mine'])
  })
  /*
   * Reported from an iPhone 2026-10-08: every league's opponent read "Unknown" with no projection. That is
   * the importer's placeholder for an open roster slot, which the server-rendered rail already names
   * "Team N" (rosterLabel) — this refresh replaced that with the raw placeholder seconds after paint.
   */
  it("names an open slot by its roster, never by the importer's \"Unknown\"", async () => {
    h.teams.mockReset()
    h.teams.mockResolvedValueOnce([{ externalId: '1', league: { id: 'mine', platform: 'sleeper', platformLeagueId: '123456789012345678', guillotineMode: false } }])
      .mockResolvedValueOnce([
        { leagueId: 'mine', externalId: '1', teamName: 'Unknown', ownerName: 'allfantasyreview' },
        { leagueId: 'mine', externalId: '2', teamName: 'Unknown', ownerName: 'Unknown' },
      ])
    const data = await (await GET(request('mine'))).json()
    expect(data.updates.mine).toMatchObject({ yourTeam: 'allfantasyreview', opponentTeam: 'Team 2' })
  })
  it('still names an opponent whose team row is missing', async () => {
    h.teams.mockReset()
    h.teams.mockResolvedValueOnce([{ externalId: '1', league: { id: 'mine', platform: 'sleeper', platformLeagueId: '123456789012345678', guillotineMode: false } }])
      .mockResolvedValueOnce([{ leagueId: 'mine', externalId: '1', teamName: 'Home' }])
    const data = await (await GET(request('mine'))).json()
    expect(data.updates.mine).toMatchObject({ yourTeam: 'Home', opponentTeam: 'Team 2' })
  })
  it('reports provider failure instead of inventing zeros', async () => {
    h.feed.mockRejectedValue(new Error('Offline'))
    expect((await GET(request('mine'))).status).toBe(503)
  })

  /*
   * Owner's report 2026-10-30: an imported guillotine league read "T-7th of 18" mid-week. The refresh ranked
   * every roster the provider lists, chopped ones included, and took the format from `guillotineMode`, which
   * is false on every imported guillotine league.
   */
  it('ranks a guillotine league (known by its type) in the live field, with the weeks left', async () => {
    h.teams.mockReset()
    h.teams.mockResolvedValueOnce([{ externalId: '1', league: { id: 'mine', platform: 'sleeper', platformLeagueId: '123456789012345678', guillotineMode: false, leagueType: 'guillotine', settings: {} } }])
      .mockResolvedValueOnce([1, 2, 3, 4, 5].map((n) => ({ leagueId: 'mine', externalId: String(n), teamName: `Team ${n}` })))
    // Week 1: roster 5 was lowest, so it is out; the season runs to week 3.
    h.weeks.mockResolvedValue([
      ...[[1, 90], [2, 80], [3, 70], [4, 60], [5, 50]].map(([r, p]) => ({ week: 1, rosterId: String(r), pointsFor: p })),
      ...[1, 2, 3, 4, 5].flatMap((r) => [{ week: 2, rosterId: String(r), pointsFor: 0 }, { week: 3, rosterId: String(r), pointsFor: 0 }]),
    ])
    h.feed.mockImplementation(async (path: string) => {
      if (path === 'state/nfl') return { season: '2026', week: 2, season_type: 'regular' }
      if (path.includes('/matchups/')) return [1, 2, 3, 4, 5].map((n) => ({ roster_id: n, matchup_id: n, points: ({ 1: 40, 2: 55, 3: 61, 4: 22, 5: 0 } as Record<number, number>)[n] }))
      return { sport: 'nfl', season: '2026' }
    })
    const data = await (await GET(request('mine'))).json()
    expect(h.weeks.mock.calls[0][0].where).toEqual({ leagueId: '123456789012345678', seasonYear: 2026 })
    expect(data.updates.mine.standing).toMatchObject({ outOf: 4, rank: 3, elimination: true, weeksLeft: 2, cutTeam: 'Team 4', cutTeamValue: 22 })
    expect(data.updates.mine.fieldStanding).toMatchObject({ outOf: 4, played: 4 })
  })
})
