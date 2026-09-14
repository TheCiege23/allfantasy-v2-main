import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const h = vi.hoisted(() => ({ session: vi.fn(), teams: vi.fn(), feed: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findMany: h.teams } } }))
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
  it('reports provider failure instead of inventing zeros', async () => {
    h.feed.mockRejectedValue(new Error('Offline'))
    expect((await GET(request('mine'))).status).toBe(503)
  })
})
