// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A payment taken back ends the plan it paid for and stops billing (lib/subscription/paymentReversal.ts).
 * Owner's rule, 2026-09-24: a FULL refund or a chargeback → access ends now and the Stripe subscription
 * is cancelled; a partial refund changes nothing.
 */

const order = vi.hoisted(() => [] as string[])
const db = vi.hoisted(() => ({
  userSubscription: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}))
const sync = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/subscription/syncBridge', () => ({ syncUserProfileFromSubscriptions: sync }))

import { isFullRefund, reverseSubscriptionForPayment } from '@/lib/subscription/paymentReversal'

const NOW = new Date('2026-10-20T12:00:00.000Z')

function stripeMock(over: { invoice?: unknown; subStatus?: string; retrieveError?: { code: string }; cancelError?: Error } = {}) {
  return {
    invoicePayments: {
      list: vi.fn(async () => ({ data: 'invoice' in over ? (over.invoice ? [{ invoice: over.invoice }] : []) : [{ invoice: 'in_1' }] })),
    },
    invoices: {
      // The live endpoint's version (basil) names the subscription under parent.subscription_details.
      retrieve: vi.fn(async () => ({ id: 'in_1', parent: { subscription_details: { subscription: 'sub_1' } } })),
    },
    subscriptions: {
      retrieve: vi.fn(async () => {
        if (over.retrieveError) throw over.retrieveError
        return { id: 'sub_1', status: over.subStatus ?? 'active' }
      }),
      cancel: vi.fn(async () => {
        order.push('stripe.cancel')
        if (over.cancelError) throw over.cancelError
        return { id: 'sub_1', status: 'canceled' }
      }),
    },
  }
}

const reverse = (stripe: ReturnType<typeof stripeMock>, reason: 'refund' | 'dispute' = 'refund') =>
  reverseSubscriptionForPayment({ stripe: stripe as never, reason, paymentIntentId: 'pi_1', customerId: 'cus_1', sourceId: 'ch_1', now: NOW })

beforeEach(() => {
  order.length = 0
  db.userSubscription.findFirst.mockReset()
  db.userSubscription.updateMany.mockReset()
  sync.mockReset()
  db.userSubscription.findFirst.mockResolvedValue({ userId: 'u1' })
  db.userSubscription.updateMany.mockImplementation(async () => {
    order.push('db.revoke')
    return { count: 1 }
  })
})

describe('isFullRefund', () => {
  it('full when Stripe says refunded, or the whole amount went back', () => {
    expect(isFullRefund({ refunded: true, amount: 999, amount_refunded: 999 })).toBe(true)
    expect(isFullRefund({ refunded: false, amount: 999, amount_refunded: 999 })).toBe(true)
  })
  it('🛑 a partial refund is not a reversal', () => {
    expect(isFullRefund({ refunded: false, amount: 999, amount_refunded: 100 })).toBe(false)
    expect(isFullRefund({ refunded: false, amount: 0, amount_refunded: 0 })).toBe(false)
  })
})

describe('reverseSubscriptionForPayment', () => {
  it('finds the subscription through payment → invoice payment → invoice (basil), ends access, then stops billing', async () => {
    const stripe = stripeMock()
    const out = await reverse(stripe)
    expect(out).toEqual({ outcome: 'revoked', subscriptionId: 'sub_1' })
    expect(stripe.invoicePayments.list).toHaveBeenCalledWith({ payment: { type: 'payment_intent', payment_intent: 'pi_1' }, limit: 1 })
    expect(db.userSubscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: 'sub_1' },
      data: {
        status: 'canceled',
        canceledAt: NOW,
        expiresAt: NOW,
        gracePeriodEnd: null,
        metadata: { lastStripeEvent: 'charge.refunded', revokedFor: 'refund', revokedBy: 'ch_1' },
      },
    })
    expect(sync).toHaveBeenCalledWith('u1')
    expect(stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_1', { invoice_now: false, prorate: false })
  })

  it('🛑 access ends BEFORE billing is touched — a failed cancel still leaves them without the plan, and throws so Stripe retries', async () => {
    const stripe = stripeMock({ cancelError: new Error('stripe down') })
    await expect(reverse(stripe)).rejects.toThrow('stripe down')
    expect(order).toEqual(['db.revoke', 'stripe.cancel'])
  })

  it('does not cancel again what Stripe has already ended (a retry, or a cancel-with-refund from the Dashboard)', async () => {
    const stripe = stripeMock({ subStatus: 'canceled' })
    await reverse(stripe)
    expect(db.userSubscription.updateMany).toHaveBeenCalled()
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('a subscription Stripe no longer has is not an error', async () => {
    const stripe = stripeMock({ retrieveError: { code: 'resource_missing' } })
    await expect(reverse(stripe)).resolves.toMatchObject({ outcome: 'revoked' })
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('a chargeback is recorded as one', async () => {
    await reverse(stripeMock(), 'dispute')
    expect(db.userSubscription.updateMany.mock.calls[0]![0].data.metadata).toEqual({
      lastStripeEvent: 'charge.dispute.created',
      revokedFor: 'dispute',
      revokedBy: 'ch_1',
    })
  })

  it('a payment with no invoice (a token pack) has no subscription to end — nothing is written or cancelled', async () => {
    const stripe = stripeMock({ invoice: null })
    const out = await reverse(stripe)
    expect(out).toEqual({ outcome: 'no_subscription', subscriptionId: null })
    expect(db.userSubscription.updateMany).not.toHaveBeenCalled()
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('no payment intent → nothing to map', async () => {
    const stripe = stripeMock()
    const out = await reverseSubscriptionForPayment({ stripe: stripe as never, reason: 'refund', paymentIntentId: null, customerId: 'cus_1', sourceId: 'ch_1', now: NOW })
    expect(out.outcome).toBe('no_subscription')
    expect(stripe.invoicePayments.list).not.toHaveBeenCalled()
  })
})
