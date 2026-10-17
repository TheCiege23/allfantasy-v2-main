import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  session: vi.fn(), league: vi.fn(), chart: vi.fn(), market: vi.fn(), search: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: mocks.session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/trade-value-console/league-loader', () => ({ loadLeagueForTrade: mocks.league }))
vi.mock('@/lib/trade-value-console/leagueTradePricing', () => ({ resolveLeagueTradeChart: mocks.chart }))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst: mocks.market }))
vi.mock('@/lib/data/players', () => ({ searchPlayers: mocks.search }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => ({ success: true }), getClientIp: () => 'test' }))
vi.mock('@/lib/draft-sports-models/player-asset-resolver', () => ({ resolveHeadshotUrl: () => null }))

import { GET } from '@/app/api/trade-value/player-search/route'

const request = (query: string) => new NextRequest(`http://localhost/api/trade-value/player-search?${query}`)
beforeEach(() => {
  vi.clearAllMocks()
  mocks.session.mockResolvedValue({ user: { id: 'viewer' } })
  mocks.league.mockResolvedValue({ id: 'l1', leagueSize: 16 })
  mocks.chart.mockResolvedValue({ fcPlayers: [], nflCtx: { leagueValueBySleeperId: new Map() } })
  mocks.search.mockResolvedValue([])
  mocks.market.mockResolvedValue([])
})

describe('search prices use the analyzer basis', () => {
  it('uses the selected league chart and carries verified player identity', async () => {
    mocks.chart.mockResolvedValue({ fcPlayers: [{
      player: { name: 'Test Receiver', position: 'WR', sleeperId: 'p1' }, value: 9876,
    }], nflCtx: {} })
    const response = await GET(request('q=Test&sport=NFL&leagueId=l1'))
    expect(mocks.league).toHaveBeenCalledWith({ leagueId: 'l1', userId: 'viewer' })
    expect(mocks.chart).toHaveBeenCalledWith(expect.objectContaining({ overrides: { leagueSize: 16 } }))
    expect(mocks.market).not.toHaveBeenCalled()
    expect(await response.json()).toEqual([expect.objectContaining({
      value: 9876, playerId: 'p1', providerIdentity: { provider: 'sleeper', id: 'p1', position: 'WR' },
    })])
  })

  it('finds defenders on the league board without assigning them an offensive chart price', async () => {
    mocks.chart.mockResolvedValue({ fcPlayers: [], nflCtx: { leagueValueBySleeperId: new Map([
      ['d1', { name: 'Test Defender', position: 'CB', value: 354, basis: 'idp-vorp' }],
    ]) } })
    const response = await GET(request('q=Defender&sport=NFL&leagueId=l1'))
    expect(await response.json()).toEqual([expect.objectContaining({ value: 354, source: 'idp-vorp', playerId: 'd1' })])
  })

  it('refuses league prices without authentication or membership instead of falling back to another chart', async () => {
    mocks.session.mockResolvedValue(null)
    expect((await GET(request('q=Test&sport=NFL&leagueId=l1'))).status).toBe(401)
    expect(mocks.chart).not.toHaveBeenCalled()
    mocks.session.mockResolvedValue({ user: { id: 'viewer' } })
    mocks.league.mockResolvedValue(null)
    expect((await GET(request('q=Test&sport=NFL&leagueId=l1'))).status).toBe(404)
  })

  it('agrees with grading: a non-NFL row carries no price, and says why', async () => {
    // Grading no longer converts `sports_players.dynasty_value` (a list position) into a price, so
    // search must not show one either — the picker and the verdict say the same thing.
    mocks.search.mockResolvedValue([
      { id: 'NCAAF:c1', name: 'Test Ranked', sport: 'NCAAF', position: 'QB', dynastyValue: 20 },
      { id: 'NCAAF:c2', name: 'Test Unranked', sport: 'NCAAF', position: 'RB', dynastyValue: 0 },
    ])
    const response = await GET(request('q=Test&sport=NCAAF'))
    expect(await response.json()).toEqual([
      expect.objectContaining({ value: null, unpricedReason: expect.objectContaining({ code: 'no_feed_for_sport' }) }),
      expect.objectContaining({ value: null, unpricedReason: expect.objectContaining({ code: 'no_feed_for_sport' }) }),
    ])
  })
})
