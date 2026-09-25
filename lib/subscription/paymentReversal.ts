/**
 * A payment taken back — a FULL refund or a chargeback — ends the plan it paid for.
 *
 * Owner's rule (2026-09-24): end access immediately AND cancel the subscription in Stripe, so a
 * refunded or disputing customer is never billed again. A PARTIAL refund changes nothing: it is a
 * goodwill credit, not a reversal. Keeping someone on after refunding them in full is a manual
 * resubscribe or grant, on purpose.
 *
 * ⚠ ACCESS ENDS FIRST, THEN BILLING. The row is closed before Stripe is asked to cancel, so a failed
 * cancel can never leave a refunded customer holding the plan. A failed cancel THROWS — the webhook
 * marks the event as errored, Stripe retries, and both steps are idempotent.
 *
 * ⚠ THE CHARGE DOES NOT NAME ITS INVOICE ON THE LIVE ENDPOINT'S VERSION. 2025-05-28.basil removed
 * `Charge.invoice`, so the subscription is reached payment_intent → invoice payment → invoice →
 * subscription (`invoiceSubscriptionId` already reads basil's `parent.subscription_details`). A
 * payment with no invoice is a one-time purchase (a token pack), which has no subscription to end.
 */
import type Stripe from 'stripe'

import { prisma } from '@/lib/prisma'
import { invoiceSubscriptionId, resolveUserIdFromStripeCustomerId } from '@/lib/subscription/webhookHandlers'
import { syncUserProfileFromSubscriptions } from '@/lib/subscription/syncBridge'

export type ReversalReason = 'refund' | 'dispute'

/** Stripe sets `refunded` only once the whole amount has gone back; anything less is partial. */
export function isFullRefund(charge: { refunded?: boolean | null; amount: number; amount_refunded: number }): boolean {
  return charge.refunded === true || (charge.amount > 0 && charge.amount_refunded >= charge.amount)
}

function idOf(ref: unknown): string | null {
  if (typeof ref === 'string') return ref || null
  if (ref && typeof ref === 'object' && typeof (ref as { id?: unknown }).id === 'string') return (ref as { id: string }).id
  return null
}

/** The subscription a payment paid for, or null for a one-time purchase. */
export async function subscriptionIdForPaymentIntent(stripe: Stripe, paymentIntentId: string): Promise<string | null> {
  const payments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    limit: 1,
  })
  const invoiceId = idOf(payments.data[0]?.invoice)
  if (!invoiceId) return null
  const invoice = await stripe.invoices.retrieve(invoiceId)
  return invoiceSubscriptionId(invoice)
}

export async function reverseSubscriptionForPayment(input: {
  stripe: Stripe
  reason: ReversalReason
  paymentIntentId: string | null
  customerId: string | null
  /** The charge or dispute id, recorded on the row. */
  sourceId: string
  now?: Date
}): Promise<{ outcome: 'revoked' | 'no_subscription'; subscriptionId: string | null }> {
  const now = input.now ?? new Date()
  const subscriptionId = input.paymentIntentId
    ? await subscriptionIdForPaymentIntent(input.stripe, input.paymentIntentId)
    : null
  if (!subscriptionId) return { outcome: 'no_subscription', subscriptionId: null }

  // 1. Access ends now.
  const row = await prisma.userSubscription.findFirst({
    where: { stripeSubscriptionId: subscriptionId },
    select: { userId: true },
  })
  await prisma.userSubscription.updateMany({
    where: { stripeSubscriptionId: subscriptionId },
    data: {
      status: 'canceled',
      canceledAt: now,
      expiresAt: now,
      gracePeriodEnd: null,
      metadata: { lastStripeEvent: input.reason === 'refund' ? 'charge.refunded' : 'charge.dispute.created', revokedFor: input.reason, revokedBy: input.sourceId },
    },
  })
  const userId = row?.userId ?? (await resolveUserIdFromStripeCustomerId(input.customerId))
  if (userId) await syncUserProfileFromSubscriptions(userId)

  // 2. Billing stops — unless Stripe has already ended it.
  const sub = await input.stripe.subscriptions.retrieve(subscriptionId).catch((error: { code?: string }) => {
    if (error?.code === 'resource_missing') return null
    throw error
  })
  if (sub && sub.status !== 'canceled' && sub.status !== 'incomplete_expired') {
    await input.stripe.subscriptions.cancel(subscriptionId, { invoice_now: false, prorate: false })
  }

  return { outcome: 'revoked', subscriptionId }
}
