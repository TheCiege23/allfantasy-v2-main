import 'server-only'

import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { recordFunnelEvent } from '@/lib/analytics/recordFunnelEvent'
import { MONETIZATION } from '@/lib/analytics/eventNames'
import { invoiceSubscriptionId } from '@/lib/subscription/webhookHandlers'
import { BILLING_PORTAL_HREF, formatBillingDate, paymentFailedNotice } from './retention'

/**
 * The webhook half of the retention work (rules and words in `./retention.ts`). Each is called from
 * `app/api/stripe/webhook/route.ts` AFTER the subscription row is written, and NEVER THROWS: a notice
 * or an analytics row failing must never fail Stripe's delivery, which would make Stripe retry the
 * whole event.
 */

type Deps = { db?: typeof prisma; notify?: typeof dispatchNotification; record?: typeof recordFunnelEvent }

async function alreadyRecorded(db: typeof prisma, event: string, userId: string, key: string, value: string): Promise<boolean> {
  const row = await db.analyticsEvent
    .findFirst({ where: { event, userId, meta: { path: [key], equals: value } }, select: { id: true } })
    .catch(() => null)
  return Boolean(row)
}

/**
 * A card failed. Stripe raises `invoice.payment_failed` on EVERY retry of the same invoice, so both the
 * notice (`dedupePrefix`) and the analytics row are once per invoice.
 */
export async function onPaymentFailed(invoice: Stripe.Invoice, userId: string, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? prisma
  const notify = deps.notify ?? dispatchNotification
  const record = deps.record ?? recordFunnelEvent
  try {
    const invoiceId = invoice.id
    if (!invoiceId) return
    const subId = invoiceSubscriptionId(invoice)
    const row = subId
      ? await db.userSubscription.findFirst({ where: { userId, stripeSubscriptionId: subId }, select: { gracePeriodEnd: true } }).catch(() => null)
      : null
    const notice = paymentFailedNotice(row?.gracePeriodEnd ? formatBillingDate(row.gracePeriodEnd) : null)
    await notify({
      userIds: [userId],
      category: 'system_account',
      productType: 'app',
      type: 'billing_payment_failed',
      title: notice.title,
      body: notice.body,
      actionHref: BILLING_PORTAL_HREF,
      actionLabel: 'Update card',
      severity: 'high',
      dedupePrefix: `billing-payment-failed:${invoiceId}`,
      skipChannels: { sms: true },
    }).catch(() => null)
    if (!(await alreadyRecorded(db, MONETIZATION.PAYMENT_FAILED, userId, 'invoice_id', invoiceId))) {
      await record({
        event: MONETIZATION.PAYMENT_FAILED,
        userId,
        getCookie: () => undefined,
        meta: { invoice_id: invoiceId, subscription_id: subId ?? null, attempt: invoice.attempt_count ?? null },
      })
    }
  } catch (error) {
    console.warn('[retention] payment-failed notice failed', error instanceof Error ? error.message : error)
  }
}

/**
 * Read BEFORE the paid invoice refreshes the row: was this subscription past due? The refresh writes
 * `active`, after which the question can no longer be answered.
 */
export async function wasPastDue(invoice: Stripe.Invoice, userId: string, db: typeof prisma = prisma): Promise<boolean> {
  try {
    const subId = invoiceSubscriptionId(invoice)
    if (!subId) return false
    const row = await db.userSubscription.findFirst({ where: { userId, stripeSubscriptionId: subId }, select: { status: true } })
    return String(row?.status ?? '').toLowerCase() === 'past_due'
  } catch {
    return false
  }
}

/** A payment went through on a subscription that was past due: the card was fixed. Once per invoice. */
export async function onPaymentRecovered(invoice: Stripe.Invoice, userId: string, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? prisma
  const record = deps.record ?? recordFunnelEvent
  try {
    const invoiceId = invoice.id
    if (!invoiceId) return
    if (await alreadyRecorded(db, MONETIZATION.PAYMENT_RECOVERED, userId, 'invoice_id', invoiceId)) return
    await record({
      event: MONETIZATION.PAYMENT_RECOVERED,
      userId,
      getCookie: () => undefined,
      meta: { invoice_id: invoiceId, subscription_id: invoiceSubscriptionId(invoice) ?? null },
    })
  } catch (error) {
    console.warn('[retention] payment-recovered event failed', error instanceof Error ? error.message : error)
  }
}

/**
 * A subscription ended. Recorded once per subscription; `was_trial` says it ended inside its free
 * trial (nothing was ever charged). The win-back note itself goes three days later, from the hourly
 * pass, so a change of heart in the meantime gets nothing.
 */
export async function onSubscriptionCanceled(sub: Stripe.Subscription, userId: string, deps: Deps = {}): Promise<void> {
  const db = deps.db ?? prisma
  const record = deps.record ?? recordFunnelEvent
  try {
    if (await alreadyRecorded(db, MONETIZATION.SUBSCRIPTION_CANCELED, userId, 'subscription_id', sub.id)) return
    const raw = sub as unknown as Record<string, number | null | undefined>
    const endedSec = raw.ended_at ?? raw.canceled_at ?? null
    const trialEndSec = raw.trial_end ?? null
    const wasTrial = typeof trialEndSec === 'number' && typeof endedSec === 'number' && endedSec <= trialEndSec
    await record({
      event: MONETIZATION.SUBSCRIPTION_CANCELED,
      userId,
      getCookie: () => undefined,
      meta: { subscription_id: sub.id, was_trial: wasTrial },
    })
  } catch (error) {
    console.warn('[retention] cancellation event failed', error instanceof Error ? error.message : error)
  }
}
