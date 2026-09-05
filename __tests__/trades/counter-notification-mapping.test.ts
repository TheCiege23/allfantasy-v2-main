import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `trade_countered` must reach a real category and severity in the notification
 * engine. Both live in module-private `Record`s (`EVENT_CATEGORY_MAP`,
 * `DEFAULT_SEVERITY`) that nothing exports, so this asserts them through the one
 * runtime signal that observes them: `ingest` returns
 * `{ dispatched: false, reason: 'unknown_event_type' }` for a type absent from the
 * category map, and otherwise hands category + severity to the dispatcher.
 *
 * ⚠ WHY NOT A SOURCE-TEXT ASSERTION. Grepping the file for
 * `trade_countered: 'trade_accept_reject'` would pass on a line inside a comment,
 * a different map, or dead code. Reading the value the dispatcher actually
 * receives cannot.
 *
 * ⚠ THE COMPILER ALREADY FORCES THE KEYS TO EXIST — both maps are
 * `Record<NotificationEventType, …>`, so adding the union member without adding
 * both entries fails typecheck. It does NOT force them to be the RIGHT values,
 * and a wrong category silently routes the notice to a settings toggle the user
 * did not intend. That is what these assert.
 */

const { mockDispatch } = vi.hoisted(() => ({ mockDispatch: vi.fn() }))

vi.mock('@/lib/notifications/NotificationDispatcher', () => ({
  dispatchNotification: mockDispatch,
}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { ingest, tradeEvent } from '@/lib/notification-engine'

const LEAGUE_ID = 'league-1'
const USER_ID = 'user-countered'

describe('trade_countered is wired into the notification engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDispatch.mockResolvedValue(undefined)
  })

  it('[control] an unmapped event type IS reported as unknown — the check can fail', async () => {
    /*
     * Without this, every assertion below would also pass against an engine that
     * had silently stopped consulting the map at all. A green check that has never
     * gone red is not evidence.
     */
    const res = await ingest({
      // deliberately not a NotificationEventType
      type: 'not_a_real_event_type' as never,
      title: 'x',
      userIds: [USER_ID],
      leagueId: LEAGUE_ID,
    })

    expect(res.dispatched).toBe(false)
    expect(res.reason).toBe('unknown_event_type')
    expect(mockDispatch).not.toHaveBeenCalled()
  })

  it('🛑 routes to trade_accept_reject — the toggle for "what happened to my offer"', async () => {
    const res = await ingest(
      tradeEvent({
        userIds: [USER_ID],
        leagueId: LEAGUE_ID,
        type: 'trade_countered',
        tradeId: 'trade-new',
        title: 'Your trade offer was countered',
      }),
    )

    expect(res.reason).not.toBe('unknown_event_type')
    expect(res.dispatched).toBe(true)
    expect(mockDispatch).toHaveBeenCalledTimes(1)
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'trade_countered', category: 'trade_accept_reject' }),
    )
  })

  it('🛑 severity HIGH, matching accepted rather than rejected', async () => {
    /*
     * A rejection is over and needs nothing from the recipient. A counter is a live
     * offer against a 48h expiry — the one trade outcome that becomes a loss if it
     * goes unseen. Demoting this to 'medium' would be invisible in every other test.
     */
    await ingest(
      tradeEvent({
        userIds: [USER_ID],
        leagueId: LEAGUE_ID,
        type: 'trade_countered',
        tradeId: 'trade-new',
        title: 'Your trade offer was countered',
      }),
    )

    expect(mockDispatch).toHaveBeenCalledWith(expect.objectContaining({ severity: 'high' }))
  })

  it('carries the trade id in meta, so the notice can address a specific offer', async () => {
    await ingest(
      tradeEvent({
        userIds: [USER_ID],
        leagueId: LEAGUE_ID,
        type: 'trade_countered',
        tradeId: 'trade-new',
        title: 'Your trade offer was countered',
      }),
    )

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ meta: expect.objectContaining({ tradeId: 'trade-new' }) }),
    )
  })

  it('trade_proposed routes to its own category — the second event that fired nowhere', async () => {
    /*
     * `trade_proposals` has existed as a settings category with a label the whole
     * time; the AF-native trade engine simply never fired an event mapped to it.
     * Asserted here so the pair stay distinguishable: routing both to one category
     * would make the two toggles indistinguishable to a user.
     */
    const res = await ingest(
      tradeEvent({
        userIds: [USER_ID],
        leagueId: LEAGUE_ID,
        type: 'trade_proposed',
        tradeId: 'trade-new',
        title: 'New trade offer',
      }),
    )

    expect(res.dispatched).toBe(true)
    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'trade_proposed', category: 'trade_proposals' }),
    )
  })
})
