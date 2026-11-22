// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The Trade Center's partner panel (2026-11-22): beside what a manager trades, the paid panel says how their trades
 * priced at the time and what they traded for at each end of the standings — only those offer-relevant lines.
 */

const db = vi.hoisted(() => ({ league: { findUnique: vi.fn() }, leagueTeam: { findUnique: vi.fn(), findFirst: vi.fn() }, sportsDataCache: { findUnique: vi.fn() } }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ TRADE_GRADES_CACHE_PREFIX: 'trade-grades:v2:' }))
const loader = vi.hoisted(() => ({ on: vi.fn(() => true), read: vi.fn() }))
vi.mock('@/lib/competitive-edge/managerRecordLoader', () => ({ managerTradeSituationOn: loader.on, readTradeSituation: loader.read }))

import { loadTradeEdge } from '@/lib/competitive-edge/tradeEdgeLoader'

const NOW = new Date('2026-11-22T18:00:00.000Z')
const trades = [1, 2, 3].map((i) => ({
  id: `SL1:t${i}`, season: '2026', week: 8 + i, createdIso: `2026-11-0${i}T15:00:00.000Z`,
  sides: [
    { ownerId: 'u-tasha', rosterId: 3, playersIn: [{ position: 'WR' }], playersOut: [{ position: 'RB' }], picksIn: [], picksOut: [] },
    { ownerId: 'u-mike', rosterId: 7, playersIn: [{ position: 'RB' }], playersOut: [{ position: 'WR' }], picksIn: [], picksOut: [] },
  ],
}))
const load = () => loadTradeEdge({ leagueId: 'L1', userId: 'viewer', opponentTeamExternalId: '3', deal: { theyGet: [{ kind: 'player', position: 'WR' }], theySend: [] }, now: NOW })

beforeEach(() => {
  vi.clearAllMocks()
  loader.on.mockReturnValue(true)
  db.league.findUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: 'SL1' })
  db.leagueTeam.findUnique.mockResolvedValue({ externalId: '3', platformUserId: 'u-tasha', ownerName: 'tashaR', teamName: 'Titans' })
  db.leagueTeam.findFirst.mockResolvedValue({ platformUserId: 'u-you' })
  db.sportsDataCache.findUnique.mockResolvedValue({ data: { version: 2, fetchedAt: NOW.toISOString(), staleAsOf: null, sleeperLeagueId: 'SL1', seasonsScanned: ['2026'], missing: [], trades }, expiresAt: new Date(NOW.getTime() + 3_600_000) })
  loader.read.mockResolvedValue({
    contexts: new Map(), ages: new Map(), now: NOW,
    prices: new Map(trades.map((t, i) => [t.id, { sideA: '3', sideB: '7', gapPct: [20, -15, 12][i]! }])),
  })
})

describe('offer facts in the Trade Center partner panel', () => {
  it('adds the price line for this manager, read for this league, and not the timing line', async () => {
    const r = await load()
    if (!r.available) throw new Error('unavailable')
    expect(loader.read).toHaveBeenCalledWith(expect.anything(), NOW, 'L1')
    const price = r.data.facts.find((f) => f.key === 'trade.situation.price')!
    expect(price.text).toMatch(/tashaR received more in 2, less in 1, and 0 were about even/)
    expect(r.data.facts.some((f) => f.key === 'trade.situation.timing')).toBe(false)
  })

  it('switched off, or a failed read: the panel is exactly what it was', async () => {
    loader.on.mockReturnValue(false)
    const off = await load()
    loader.on.mockReturnValue(true)
    loader.read.mockRejectedValue(new Error('down'))
    const failed = await load()
    for (const r of [off, failed]) {
      if (!r.available) throw new Error('unavailable')
      expect(r.data.facts.some((f) => f.key.startsWith('trade.situation.'))).toBe(false)
      expect(r.data.facts.length).toBeGreaterThan(0)
    }
  })
})
