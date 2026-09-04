/**
 * R7 — the fatigue budget, the one piece of "one outbox, four transports, one fatigue budget"
 * that did not exist.
 *
 * ⚠ MEASURED BEFORE BUILDING: the outbox works (it sent a notification the day this was
 * written), all four transports are implemented, and push is wired across four prompting
 * surfaces. `ChimmyAlertEngine` has cooldown/dedup — "not the same alert twice" — which is a
 * different question from "not more than N a day, whatever they are", and covers only Chimmy
 * alerts. No per-user volume cap existed anywhere.
 *
 * 🛑 THE SAFETY PROPERTY THESE TESTS EXIST TO PIN: an unrecognised event type is NEVER
 * suppressed. The relay drains oldest-first, so a naive cap would let a morning marketing batch
 * eat the day's budget and drop the afternoon "your waiver claim won" — suppressing exactly the
 * notification the user was waiting for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  prisma: { notificationOutbox: { count: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))

import {
  decideFatigue,
  isFatigueEligible,
  FATIGUE_MAX_PER_WINDOW,
} from '@/lib/notifications/fatigueBudget'

beforeEach(() => {
  vi.resetAllMocks()
  h.prisma.notificationOutbox.count.mockResolvedValue(0)
})

describe('R7 · what the budget may touch', () => {
  it('bulk marketing is eligible', () => {
    expect(isFatigueEligible('admin_marketing_broadcast')).toBe(true)
    expect(isFatigueEligible('admin_marketing_test')).toBe(true)
  })

  /**
   * 🛑 THE CORE GUARD. These are the real event types observed in `notification_outbox`. If any
   * becomes eligible, a user can miss a claim result because they received too much marketing.
   */
  it('🛑 transactional events are NOT eligible', () => {
    expect(isFatigueEligible('WAIVER_CLAIM_WON')).toBe(false)
    expect(isFatigueEligible('WAIVER_PROCESSING_COMPLETE')).toBe(false)
    expect(isFatigueEligible('af_trade_proposed')).toBe(false)
    expect(isFatigueEligible('af_trade_awaiting_commissioner')).toBe(false)
  })

  it('🛑 an UNKNOWN event type is exempt — the fail-safe default', () => {
    expect(isFatigueEligible('some_event_invented_next_year')).toBe(false)
    expect(isFatigueEligible('')).toBe(false)
    expect(isFatigueEligible(null)).toBe(false)
    expect(isFatigueEligible(undefined)).toBe(false)
  })
})

describe('R7 · the decision', () => {
  const bulk = { userId: 'u1', eventType: 'admin_marketing_broadcast' }

  it('allows while under the cap', async () => {
    h.prisma.notificationOutbox.count.mockResolvedValue(FATIGUE_MAX_PER_WINDOW - 1)
    expect((await decideFatigue(bulk)).suppress).toBe(false)
  })

  it('🛑 suppresses at the cap, with an auditable reason', async () => {
    h.prisma.notificationOutbox.count.mockResolvedValue(FATIGUE_MAX_PER_WINDOW)
    const d = await decideFatigue(bulk)
    expect(d.suppress).toBe(true)
    expect(d.reason).toMatch(/fatigue budget/i)
    expect(d.reason).toMatch(new RegExp(String(FATIGUE_MAX_PER_WINDOW)))
  })

  it('🛑 a transactional row is never suppressed, however loud the user has been', async () => {
    h.prisma.notificationOutbox.count.mockResolvedValue(9_999)
    const d = await decideFatigue({ userId: 'u1', eventType: 'WAIVER_CLAIM_WON' })
    expect(d.suppress).toBe(false)
    // …and it must not even ASK, since the answer cannot matter.
    expect(h.prisma.notificationOutbox.count).not.toHaveBeenCalled()
  })

  it('a row with no userId is not suppressed and costs no query', async () => {
    const d = await decideFatigue({ userId: null, eventType: 'admin_marketing_broadcast' })
    expect(d.suppress).toBe(false)
    expect(h.prisma.notificationOutbox.count).not.toHaveBeenCalled()
  })

  /**
   * ⚠ FAILS OPEN, like every other guard in this relay. A budget that cannot measure has no
   * business refusing — the worst case must be that the cap does not apply for one pass, never
   * that a user goes silent.
   */
  it('🛑 fails OPEN when the count cannot be read', async () => {
    h.prisma.notificationOutbox.count.mockRejectedValue(new Error('db down'))
    const d = await decideFatigue(bulk)
    expect(d.suppress).toBe(false)
  })

  /**
   * Counting every row would invert the protection: a busy waiver day would consume the bulk
   * budget and marketing would be dropped for the wrong reason. The two populations stay apart.
   */
  it('counts only SENT, in-window, eligible rows for that user', async () => {
    h.prisma.notificationOutbox.count.mockResolvedValue(0)
    await decideFatigue(bulk, new Date('2026-09-03T12:00:00.000Z'))

    const where = h.prisma.notificationOutbox.count.mock.calls[0][0].where
    expect(where.userId).toBe('u1')
    expect(where.status).toBe('sent')
    expect(where.sentAt.gte).toEqual(new Date('2026-09-02T12:00:00.000Z'))
    expect(where.eventType.in).toContain('admin_marketing_broadcast')
    expect(where.eventType.in).not.toContain('WAIVER_CLAIM_WON')
  })
})
