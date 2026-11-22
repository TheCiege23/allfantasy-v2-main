/**
 * `/api/league/trades-panel` → `historyTrades` on an IMPORTED league (ESPN / Yahoo / MFL / Fleaflicker).
 *
 * Until 2026-11-17 these leagues' history listed only trades made inside AllFantasy, while /core Trades
 * listed every synced deal. Pinned here: the provider-completed rows reach the response first, built for the
 * viewer's own provider account; a native league never asks; and a failure costs only that list.
 * The builder's own mapping is pinned in `__tests__/provider-trades/provider-completed-history.test.ts`.
 * Mocks mirror `trades-panel-executed-trades.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
const findFirstLeague = vi.fn()
const findFirstRoster = vi.fn()
const findManyRoster = vi.fn()
const findManyAppUser = vi.fn()
const listAfLeagueTrades = vi.fn()
const isElevatedCommissioner = vi.fn()
const findManyTradeOfferEvent = vi.fn()
const priceTradesAtCurrentMarket = vi.fn()
const findFirstLeagueTeam = vi.fn()
const buildProviderCompletedHistory = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...a: unknown[]) => findFirstLeague(...a) },
    roster: {
      findFirst: (...a: unknown[]) => findFirstRoster(...a),
      findMany: (...a: unknown[]) => findManyRoster(...a),
    },
    appUser: { findMany: (...a: unknown[]) => findManyAppUser(...a) },
    tradeBlockEntry: { findMany: vi.fn().mockResolvedValue([]) },
    tradeDraft: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn(), upsert: vi.fn() },
    userProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    leagueTeam: { findFirst: (...a: unknown[]) => findFirstLeagueTeam(...a) },
    tradeOfferEvent: { findMany: (...a: unknown[]) => findManyTradeOfferEvent(...a) },
  },
}))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({
  listAfLeagueTrades: (...a: unknown[]) => listAfLeagueTrades(...a),
}))
vi.mock('@/server/services/permissionService', () => ({
  isElevatedCommissioner: (...a: unknown[]) => isElevatedCommissioner(...a),
}))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  priceTradesAtCurrentMarket: (...a: unknown[]) => priceTradesAtCurrentMarket(...a),
}))
// Routes ask lib/league/commissionerAccess.ts (2026-11-16); this defers to the old check this test mocks.
vi.mock('@/lib/league/commissionerAccess', async () => (await import('../helpers/commissionerAccessMock')).accessFromBoolean(() => async (l: string, u: string) => Boolean(await isElevatedCommissioner(l, u))))

vi.mock('@/lib/provider-trades/providerCompletedHistory', () => ({
  buildProviderCompletedHistory: (...a: unknown[]) => buildProviderCompletedHistory(...a),
}))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/league/trades-panel/route'

const PROVIDER_ROW = { id: 'espn:tx1', direction: 'complete', status: 'completed_on_espn', partnerName: 'Gridiron Gang', sent: [], received: [], timestamp: '2026-11-02T18:30:00.000Z' }
const NATIVE_DONE = {
  id: 't-done', status: 'processed', proposerRosterId: 'r1', receiverRosterId: 'r2',
  createdAt: new Date('2026-09-01T00:00:00Z'), processedAt: new Date('2026-09-03T00:00:00Z'),
  items: [{ id: 'i1', fromRosterId: 'r1', toRosterId: 'r2', itemReference: 'p1', metadata: { playerName: 'CeeDee Lamb' } }],
}

async function panel(platform: string, platformLeagueId: string | null = '123456') {
  findFirstLeague.mockResolvedValue({ id: 'l-1', platform, platformLeagueId, name: 'L', sport: 'NFL' })
  const res = await GET(new NextRequest('http://localhost/api/league/trades-panel?leagueId=l-1'))
  return { status: res.status, body: await res.json() }
}

describe('trades-panel historyTrades on an imported league', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSession.mockResolvedValue({ user: { id: 'u1' } })
    findFirstRoster.mockResolvedValue({ id: 'r1' })
    findManyRoster.mockResolvedValue([{ id: 'r1', platformUserId: 'u1' }, { id: 'r2', platformUserId: 'u2' }])
    findManyAppUser.mockResolvedValue([{ id: 'u1', displayName: 'Me', username: 'me' }, { id: 'u2', displayName: 'Them', username: 'them' }])
    listAfLeagueTrades.mockResolvedValue([NATIVE_DONE])
    findManyTradeOfferEvent.mockResolvedValue([])
    priceTradesAtCurrentMarket.mockResolvedValue(new Map())
    isElevatedCommissioner.mockResolvedValue(false)
    findFirstLeagueTeam.mockResolvedValue({ platformUserId: 'espn-user-7' })
    buildProviderCompletedHistory.mockResolvedValue([PROVIDER_ROW])
  })

  it('lists the league’s synced completed trades first, built for the viewer’s provider account', async () => {
    const { status, body } = await panel('espn')
    expect(status).toBe(200)
    expect(body.historyTrades[0]).toMatchObject({ id: 'espn:tx1', status: 'completed_on_espn' })
    expect(buildProviderCompletedHistory).toHaveBeenCalledWith(expect.objectContaining({
      leagueId: 'l-1', userId: 'u1', platform: 'espn', platformLeagueId: '123456', sport: 'NFL', viewerPlatformUserId: 'espn-user-7',
    }))
  })

  it('🛑 a native league never asks — its history is AllFantasy’s own', async () => {
    const { body } = await panel('manual', null)
    expect(buildProviderCompletedHistory).not.toHaveBeenCalled()
    expect(body.historyTrades.some((t: { id: string }) => t.id === 'espn:tx1')).toBe(false)
  })

  it('a failed provider read costs that list, never the panel', async () => {
    buildProviderCompletedHistory.mockRejectedValue(new Error('db down'))
    const { status, body } = await panel('mfl')
    expect(status).toBe(200)
    expect(body.historyTrades.some((t: { id: string }) => t.id === 'espn:tx1')).toBe(false)
  })
})
