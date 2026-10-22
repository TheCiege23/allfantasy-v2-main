import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/*
 * `/api/core/rail-scores` with native leagues in the batch (2026-10-18). A native guillotine league's
 * line is answered from the database (`getNativeRailMatchups`), never a provider, and it must not be
 * reported "unavailable" — which the client draws as "Score update delayed" — nor take a Sleeper
 * failure down with it.
 */

const h = vi.hoisted(() => ({ session: vi.fn(), teams: vi.fn(), feed: vi.fn(), native: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next-auth', () => ({ getServerSession: h.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: { leagueTeam: { findMany: h.teams } } }))
vi.mock('@/lib/core-app/nativeRailMatchups', () => ({ getNativeRailMatchups: h.native }))
vi.mock('@/lib/core-app/sleeperRailFeed', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/core-app/sleeperRailFeed')>()),
  sleeperRailFeed: h.feed,
}))
import { GET } from '@/app/api/core/rail-scores/route'

const request = (...ids: string[]) =>
  new NextRequest(`https://allfantasy.ai/api/core/rail-scores?${new URLSearchParams(ids.map((id) => ['league', id]))}`)

const guillotineRow = {
  leagueId: 'native-g',
  yourTeam: 'Ciege', yourAvatarUrl: null, yourScore: 112.4, yourProjection: null,
  opponentTeam: null, opponentAvatarUrl: null, opponentScore: 0, opponentProjection: null,
  unpaired: true,
  standing: { rank: 8, outOf: 16, overCut: 12.4, basis: 'points', placesAboveCut: 8, cutLine: 100, elimination: true },
  eliminated: false, scored: true, freshAt: '2026-10-18T12:00:00.000Z', source: 'live_cache', season: 2026, week: 3,
  guillotine: { state: 'alive', week: 3, points: 112.4, projected: null, rank: 8, aliveCount: 16, chopMargin: 12.4, basis: 'points', firstChopWeek: 10, choppedWeek: null, draftAt: null },
  native: true,
}

beforeEach(() => {
  vi.resetAllMocks()
  h.session.mockResolvedValue({ user: { id: 'me' } })
  h.native.mockResolvedValue({ byLeague: { 'native-g': guillotineRow } })
})

describe('rail-scores with native leagues', () => {
  it('answers a native Guilly league from the database, with no provider call', async () => {
    h.teams.mockResolvedValueOnce([]) // the user owns no Sleeper team in this batch
    const data = await (await GET(request('native-g'))).json()
    expect(h.native).toHaveBeenCalledWith('me', ['native-g'])
    expect(h.feed).not.toHaveBeenCalled()
    expect(data.unavailable).toEqual([])
    expect(data.updates['native-g']).toMatchObject({
      native: true,
      yourScore: 112.4,
      guillotine: { state: 'alive', rank: 8, aliveCount: 16, chopMargin: 12.4 },
      fieldStanding: { rank: 8, elimination: true },
      freshAt: '2026-10-18T12:00:00.000Z',
    })
    // `updatedAt` is when it was read, so a five-minute-old stat row is not drawn as a delayed poll.
    expect(Date.now() - Date.parse(data.updates['native-g'].updatedAt)).toBeLessThan(10_000)
  })

  it('never asks the native loader about a league it already answers from Sleeper', async () => {
    h.teams
      .mockResolvedValueOnce([{ externalId: '1', league: { id: 'sleeper-1', platform: 'sleeper', platformLeagueId: '123456789012345678', guillotineMode: false } }])
      .mockResolvedValueOnce([{ leagueId: 'sleeper-1', externalId: '1', teamName: 'Home' }, { leagueId: 'sleeper-1', externalId: '2', teamName: 'Away' }])
    h.feed.mockImplementation(async (path: string) => {
      if (path === 'state/nfl') return { season: '2026', week: 2, season_type: 'regular' }
      if (path.includes('/matchups/')) return [{ roster_id: 1, matchup_id: 1, points: 20 }, { roster_id: 2, matchup_id: 1, points: 10 }]
      return { sport: 'nfl', season: '2026' }
    })
    const data = await (await GET(request('sleeper-1', 'native-g'))).json()
    expect(h.native).toHaveBeenCalledWith('me', ['native-g'])
    expect(Object.keys(data.updates).sort()).toEqual(['native-g', 'sleeper-1'])
    expect(data.unavailable).toEqual([])
  })

  it('a Sleeper outage leaves the native line standing', async () => {
    h.teams
      .mockResolvedValueOnce([{ externalId: '1', league: { id: 'sleeper-1', platform: 'sleeper', platformLeagueId: '123456789012345678', guillotineMode: false } }])
      .mockResolvedValueOnce([])
    h.feed.mockResolvedValue(null)
    const response = await GET(request('sleeper-1', 'native-g'))
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.updates['native-g']).toMatchObject({ native: true })
    expect(data.unavailable).toEqual(['sleeper-1'])
  })

  it('a native league the loader does not answer is unavailable, not invented', async () => {
    h.teams.mockResolvedValueOnce([])
    h.native.mockResolvedValue({ byLeague: {} })
    const data = await (await GET(request('native-x'))).json()
    expect(data.updates).toEqual({})
    expect(data.unavailable).toEqual(['native-x'])
  })
})
