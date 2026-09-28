/**
 * The pending-offer scan raises the league's trade alerts — only for a SCREEN's read, only when it
 * found a pending offer, and without the page waiting on it (`screenTradeAlerts.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  trigger: vi.fn(),
  transactions: vi.fn(),
  state: vi.fn(async (): Promise<unknown> => ({ leg: 5 })),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/trade-intel/screenTradeAlerts', () => ({ triggerAlertFromScreenRead: h.trigger }))
vi.mock('@/lib/api-cache/SleeperCacheLayer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-cache/SleeperCacheLayer')>()),
  getAllPlayers: vi.fn(async () => ({})),
  getLeagueRosters: vi.fn(async () => [{ roster_id: 1, owner_id: 'me', players: [] }]),
  getLeagueUsers: vi.fn(async () => []),
  getLeagueTransactions: h.transactions,
  getSleeperState: h.state,
}))

import { scanPendingSleeperTrades } from '@/lib/provider-trades/scanPendingSleeperTrades'

const pending = {
  transaction_id: 'OFFER',
  type: 'trade',
  status: 'pending',
  roster_ids: [1, 2],
  creator: 'them',
  created: 1_790_000_000_000,
  adds: {},
  drops: {},
  draft_picks: [],
  waiver_budget: [],
}
const args = { platformLeagueId: 'SL1', ownerSleeperId: 'me', sport: 'NFL' }

beforeEach(() => {
  h.trigger.mockReset()
  h.trigger.mockResolvedValue('ran')
  h.transactions.mockReset()
  h.transactions.mockImplementation(async (_l: string, week: number) => (week === 5 ? [pending] : []))
})

describe('scanPendingSleeperTrades — alertOnNewOffers', () => {
  it('a screen read that finds a pending offer triggers the alert on the current weeks', async () => {
    const scan = await scanPendingSleeperTrades({ ...args, alertOnNewOffers: true })
    expect(scan.trades.map((t) => t.transactionId ?? t.id)).toHaveLength(1)
    expect(h.trigger).toHaveBeenCalledTimes(1)
    const [league, weeks] = h.trigger.mock.calls[0] as [string, number[]]
    expect(league).toBe('SL1')
    expect([...weeks].sort((a, b) => a - b)).toEqual([4, 5, 6])
  })

  it('off by default — no caller raises alerts unless it says it is a screen', async () => {
    await scanPendingSleeperTrades(args)
    expect(h.trigger).not.toHaveBeenCalled()
  })

  it('nothing pending, nothing triggered', async () => {
    h.transactions.mockImplementation(async () => [])
    await scanPendingSleeperTrades({ ...args, alertOnNewOffers: true })
    expect(h.trigger).not.toHaveBeenCalled()
  })

  it('🛑 the page never waits on it: a trigger that never settles does not hold the scan', async () => {
    h.trigger.mockImplementation(() => new Promise(() => {}))
    const scan = await scanPendingSleeperTrades({ ...args, alertOnNewOffers: true })
    expect(scan.scanned).toBe(true)
  })
})
