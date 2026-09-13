import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `trade_reversed` must reach a real category and severity in the notification engine.
 *
 * Same method as counter-notification-mapping.test.ts, for the same reason: the maps are module-private,
 * so this reads what the dispatcher actually receives. The compiler forces the keys to exist; it does not
 * force the RIGHT values, and a wrong category silently routes the notice to a toggle the user never set.
 */

const { mockDispatch } = vi.hoisted(() => ({ mockDispatch: vi.fn() }))

vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: mockDispatch,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { ingest, tradeEvent } from '@/lib/notification-engine'

const reversedEvent = () =>
  tradeEvent({
    userIds: ['u-a', 'u-b'],
    leagueId: 'league-1',
    type: 'trade_reversed' as never,
    tradeId: 'trade-1',
    title: 'Your trade was reversed',
  })

describe('trade_reversed is wired into the notification engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDispatch.mockResolvedValue(undefined)
  })

  it('[control] an unmapped event type IS reported as unknown — the check can fail', async () => {
    const res = await ingest({ type: 'not_a_real_event_type' as never, title: 'x', userIds: ['u-a'], leagueId: 'league-1' })
    expect(res).toMatchObject({ dispatched: false, reason: 'unknown_event_type' })
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('🛑 routes to trade_accept_reject — the toggle for "what became of my trade"', async () => {
    /*
     * Deliberately not a new category, for the reason the engine records against trade_countered: a fresh
     * category needs a default for every existing settings row, and "silently off" is the failure this
     * notice exists to fix.
     */
    const res = await ingest(reversedEvent())
    expect(res.dispatched).toBe(true)
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'trade_reversed', category: 'trade_accept_reject', userIds: ['u-a', 'u-b'] }),
    )
  })

  it('🛑 severity HIGH — a roster changed without its manager doing anything', async () => {
    await ingest(reversedEvent())
    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ severity: 'high' }))
  })

  it('carries the trade id and points at the league trades tab', async () => {
    await ingest(reversedEvent())
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        actionHref: '/league/league-1?tab=trades',
        meta: expect.objectContaining({ tradeId: 'trade-1' }),
      }),
    )
  })
})
