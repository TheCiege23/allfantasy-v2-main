/**
 * `/api/league/trades-panel` → `tradeBlock` and `tradeBlockNote` (2026-09-17).
 *
 * Until managers could list players (#1001) the table this reads was empty, so the route's direct read
 * of active rows was never exercised. It now goes through `readTradeBlock`, the reader the player card
 * and Chimmy use, which drops a listing once the player has left the team that listed him and names
 * that team. What is pinned:
 *
 *   - the Sleeper branch returns the reader's listings, named by team, with the Sleeper note;
 *   - an unreadable block is said, not shown as empty;
 *   - an imported league the block cannot be read for says which platform;
 *   - a native league keeps its plain empty state (no note).
 *
 * The mocks follow `trades-panel-executed-trades.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getServerSession = vi.fn()
const findFirstLeague = vi.fn()
const readTradeBlock = vi.fn()
const tradeBlockFindMany = vi.fn()

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => getServerSession(...a) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: (...a: unknown[]) => findFirstLeague(...a) },
    roster: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    appUser: { findMany: vi.fn().mockResolvedValue([]) },
    tradeBlockEntry: { findMany: (...a: unknown[]) => tradeBlockFindMany(...a) },
    tradeDraft: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn(), upsert: vi.fn() },
    userProfile: { findUnique: vi.fn().mockResolvedValue(null) },
    leagueTeam: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
    tradeOfferEvent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/lib/trade-block/importedTradeBlock', async (orig) => ({
  ...(await orig<typeof import('@/lib/trade-block/importedTradeBlock')>()),
  readTradeBlock: (...a: unknown[]) => readTradeBlock(...a),
}))
vi.mock('@/lib/league-trade-engine/tradeService', () => ({ listAfLeagueTrades: vi.fn().mockResolvedValue([]) }))
vi.mock('@/server/services/permissionService', () => ({ isElevatedCommissioner: vi.fn().mockResolvedValue(false) }))
vi.mock('@/lib/league-trade-engine/tradeLearningCapture', () => ({
  priceTradesAtCurrentMarket: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/lib/provider-trades/scanPendingSleeperTrades', () => ({
  scanPendingSleeperTrades: vi.fn().mockResolvedValue({ trades: [], scanned: true, reason: null }),
}))
vi.mock('@/lib/provider-trades/scanPendingYahooTrades', () => ({
  scanPendingYahooTrades: vi.fn().mockResolvedValue({ trades: [], scanned: true, reason: null }),
}))
vi.mock('@/lib/provider-trades/evaluatePendingProviderTrades', () => ({
  evaluatePendingProviderTrades: vi.fn().mockResolvedValue(new Map()),
}))
vi.mock('@/lib/provider-trades/providerTradeOfferReads', () => ({
  getLeagueTradeLedgerForRoster: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/league-context/leagueContextService', () => ({ getLeagueContext: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: vi.fn().mockResolvedValue(null) }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/league/trades-panel/route'
import { tradeBlockSupport } from '@/lib/trade-block/importedTradeBlock'

const listing = (over: Record<string, unknown> = {}) => ({
  sleeperId: '10213',
  playerName: 'Tre Tucker',
  position: 'WR',
  nflTeam: 'LV',
  rosterId: 1,
  teamName: 'Ice Kings',
  ownerName: 'owner1',
  since: '2026-09-17T12:00:00.000Z',
  ...over,
})

async function panel(league: Record<string, unknown>) {
  findFirstLeague.mockResolvedValue({ id: 'l-1', name: 'L', sport: 'NFL', platformLeagueId: null, ...league })
  const res = await GET(new NextRequest('http://localhost/api/league/trades-panel?leagueId=l-1'))
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSession.mockResolvedValue({ user: { id: 'u-1' } })
  tradeBlockFindMany.mockResolvedValue([])
  readTradeBlock.mockResolvedValue({ support: tradeBlockSupport('sleeper'), listings: [] })
})

describe('trades-panel trade block, Sleeper league', () => {
  const SLEEPER = { platform: 'sleeper', platformLeagueId: '1313532725151399936' }

  it('returns the reader’s listings, named by the team that listed them, with the Sleeper note', async () => {
    readTradeBlock.mockResolvedValue({
      support: tradeBlockSupport('sleeper'),
      listings: [listing(), listing({ sleeperId: '10229', playerName: 'Rashee Rice', rosterId: 7, teamName: null, ownerName: 'Jordan', position: null, nflTeam: null })],
    })
    const { status, body } = await panel(SLEEPER)
    expect(status).toBe(200)
    expect(readTradeBlock).toHaveBeenCalledWith('l-1')
    expect(body.tradeBlock).toEqual([
      { id: '1:10213', playerId: '10213', name: 'Tre Tucker', position: 'WR', team: 'LV', ownerName: 'Ice Kings' },
      { id: '7:10229', playerId: '10229', name: 'Rashee Rice', position: 'FLEX', team: null, ownerName: 'Jordan' },
    ])
    expect(body.tradeBlockNote).toBe(tradeBlockSupport('sleeper').note)
  })

  it('🛑 never reads the table directly — a traded player would stay "on the block"', async () => {
    await panel(SLEEPER)
    expect(tradeBlockFindMany).not.toHaveBeenCalled()
  })

  it('an unreadable block is said, not shown as an empty one', async () => {
    readTradeBlock.mockResolvedValue(null)
    const { body } = await panel(SLEEPER)
    expect(body.tradeBlock).toEqual([])
    expect(body.tradeBlockNote).toBe('The trade block could not be read right now.')
  })

  it('caps the list at 48', async () => {
    readTradeBlock.mockResolvedValue({
      support: tradeBlockSupport('sleeper'),
      listings: Array.from({ length: 60 }, (_, i) => listing({ sleeperId: String(i) })),
    })
    const { body } = await panel(SLEEPER)
    expect(body.tradeBlock).toHaveLength(48)
  })
})

describe('trades-panel trade block, other leagues', () => {
  it('an imported league the block cannot be read for names its platform', async () => {
    const { body } = await panel({ platform: 'espn' })
    expect(body.tradeBlock).toEqual([])
    expect(body.tradeBlockNote).toBe(tradeBlockSupport('espn').note)
    expect(readTradeBlock).not.toHaveBeenCalled()
  })

  it('Yahoo says so too', async () => {
    const { body } = await panel({ platform: 'yahoo', platformLeagueId: '461.l.1234' })
    expect(body.tradeBlockNote).toBe(tradeBlockSupport('yahoo').note)
  })

  it('a native league keeps its plain empty state', async () => {
    const { body } = await panel({ platform: 'native' })
    expect(body.tradeBlock).toEqual([])
    expect(body.tradeBlockNote).toBeNull()
  })
})
