import 'server-only'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { invoiceSubscriptionId, resolveUserIdFromStripeCustomerId } from '@/lib/subscription/webhookHandlers'
import { getMonetizationCatalog } from '@/lib/monetization/catalog'
import { isPartnerCodesEnabled } from './flags'
import { loadPartnerSettings } from './service'
import {
  commissionBasisCents,
  planAccrual,
  planReversal,
  reversalMillicents,
  withinCommissionCap,
  type LedgerSlice,
} from './money'
import { paymentEarnsCommission } from './meters'
import { flagReasons, SHARED_CARD_LIMIT } from './fraud'

/**
 * Commissioner Partner Codes — what a Stripe event does to the ledger.
 *
 * Called from app/api/stripe/webhook/route.ts AFTER billing has handled the
 * event, and never allowed to break billing: see onPartnerStripeEvent.
 *
 * Twice-delivered events are safe at two levels: the webhook's own event table
 * skips a processed event id, and every ledger row is unique on
 * (source, sourceRef, installment), with `seenPaymentRefs` guarding the counters.
 */

function idOf(ref: unknown): string | null {
  if (typeof ref === 'string') return ref || null
  if (ref && typeof ref === 'object' && typeof (ref as { id?: unknown }).id === 'string') return (ref as { id: string }).id
  return null
}

/** Stripe price id → plan family + interval, read from the catalog's price env vars. */
function planForPrice(priceId: string): { planFamily: string | null; interval: 'month' | 'year' | null } | undefined {
  for (const item of getMonetizationCatalog().subscriptions) {
    if (process.env[item.stripePriceEnvVar]?.trim() === priceId) return { planFamily: item.planFamily, interval: item.interval }
  }
  return undefined
}

type ChargeFacts = { chargeId: string | null; feeCents: number; cardFingerprint: string | null }

/** The Stripe fee and card fingerprint behind an invoice (clover API: via invoice payments). */
async function chargeFactsForInvoice(stripe: Stripe, invoiceId: string): Promise<ChargeFacts> {
  const payments = await stripe.invoicePayments.list({ invoice: invoiceId, limit: 10 })
  for (const p of payments.data) {
    const raw = p as unknown as { status?: string; payment?: { type?: string; payment_intent?: unknown; charge?: unknown } }
    if (raw.status && raw.status !== 'paid') continue
    let chargeId = idOf(raw.payment?.charge)
    const piId = idOf(raw.payment?.payment_intent)
    if (!chargeId && piId) {
      const pi = await stripe.paymentIntents.retrieve(piId)
      chargeId = idOf(pi.latest_charge)
    }
    if (!chargeId) continue
    const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] })
    const bt = charge.balance_transaction as Stripe.BalanceTransaction | string | null
    const feeCents = bt && typeof bt === 'object' ? bt.fee : 0
    const fingerprint = charge.payment_method_details?.card?.fingerprint ?? null
    return { chargeId, feeCents, cardFingerprint: fingerprint }
  }
  return { chargeId: null, feeCents: 0, cardFingerprint: null }
}

async function invoiceIdForPaymentIntent(stripe: Stripe, paymentIntentId: string | null): Promise<string | null> {
  if (!paymentIntentId) return null
  const payments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    limit: 1,
  })
  return idOf(payments.data[0]?.invoice)
}

// ---------------------------------------------------------------------------
// A paid invoice
// ---------------------------------------------------------------------------

export async function recordPartnerInvoicePaid(stripe: Stripe, invoice: Stripe.Invoice): Promise<string> {
  const amountPaid = invoice.amount_paid ?? 0
  if (amountPaid <= 0) return 'zero_amount' // trial starts, 100%-off invoices
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return 'not_subscription'
  const customerId = idOf(invoice.customer)
  const userId = customerId ? await resolveUserIdFromStripeCustomerId(customerId) : null
  if (!userId) return 'no_user'

  const referral = await prisma.partnerReferral.findUnique({
    where: { userId },
    include: { partnerCode: { select: { id: true, cashUnlockedAt: true, ownerUserId: true } } },
  })
  if (!referral) return 'not_referred'
  if (referral.seenPaymentRefs.includes(invoice.id!)) return 'duplicate'

  const settings = await loadPartnerSettings()
  const facts = await chargeFactsForInvoice(stripe, invoice.id!)
  const paidAt = new Date(((invoice.status_transitions?.paid_at ?? invoice.created) || Date.now() / 1000) * 1000)

  const line = invoice.lines?.data?.[0] as unknown as { pricing?: { price_details?: { price?: unknown } }; price?: unknown } | undefined
  const priceId = idOf(line?.pricing?.price_details?.price) ?? idOf(line?.price)
  const plan = priceId ? planForPrice(priceId) : undefined
  const interval: 'month' | 'year' = plan?.interval === 'year' ? 'year' : 'month'

  // Shared-card check, now that there is a card.
  let extraFlags: string[] = []
  if (facts.cardFingerprint && !referral.cardFingerprint) {
    const sameCardOnCode = await prisma.partnerReferral.count({
      where: { partnerCodeId: referral.partnerCodeId, cardFingerprint: facts.cardFingerprint, NOT: { id: referral.id } },
    })
    extraFlags = flagReasons({ sameCardOnCode: sameCardOnCode + 1 >= SHARED_CARD_LIMIT ? SHARED_CARD_LIMIT : 0, matchesOwnerCard: false, sameIpLast24h: 0, isDisposableEmail: false, matchesOwnerIp: false })
  }
  const flags = Array.from(new Set([...referral.flagReasons, ...extraFlags]))
  const nextStatus = flags.length && referral.status !== 'rejected' ? 'flagged' : referral.status === 'churned' ? 'pending' : referral.status

  await prisma.partnerReferral.update({
    where: { id: referral.id },
    data: {
      seenPaymentRefs: { push: invoice.id! },
      paidInvoiceCount: { increment: 1 },
      firstPaidAt: referral.firstPaidAt ?? paidAt,
      currentlyPaying: true,
      churnedAt: null,
      platform: 'web',
      plan: plan?.planFamily ?? referral.plan,
      interval,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      cardFingerprint: referral.cardFingerprint ?? facts.cardFingerprint,
      flagReasons: flags,
      status: nextStatus,
    },
  })

  if (referral.status === 'rejected') return 'rejected'
  if (!paymentEarnsCommission(paidAt, referral.partnerCode.cashUnlockedAt)) return 'before_cash_unlocked'
  if (!withinCommissionCap(referral.commissionMonths, settings)) return 'past_cap'

  const basis = commissionBasisCents({ grossCents: amountPaid, feeCents: facts.feeCents, refundCents: 0 }, settings)
  const slices = planAccrual({ interval, basisCents: basis, paidAt, settings })
  if (!slices.length) return 'nothing_to_accrue'
  const now = Date.now()
  await prisma.partnerCommissionEntry.createMany({
    data: slices.map((s) => ({
      partnerCodeId: referral.partnerCodeId,
      referralId: referral.id,
      source: 'stripe',
      sourceRef: invoice.id!,
      installment: s.installment,
      periodMonth: s.periodMonth,
      earnedAt: s.earnedAt,
      grossCents: s.installment === 0 ? amountPaid : 0,
      feeCents: s.installment === 0 ? facts.feeCents : 0,
      basisCents: s.installment === 0 ? basis : 0,
      commissionMillicents: s.commissionMillicents,
      status: s.earnedAt.getTime() <= now ? 'accrued' : 'scheduled',
    })),
    skipDuplicates: true,
  })
  await prisma.partnerReferral.update({
    where: { id: referral.id },
    data: { commissionMonths: { increment: interval === 'year' ? 12 : 1 } },
  })
  return 'accrued'
}

// ---------------------------------------------------------------------------
// Refunds and disputes
// ---------------------------------------------------------------------------

/**
 * Bring an invoice's reversal up to `targetReverse` millicents. Stripe sends
 * charge.refunded with the CUMULATIVE refunded amount, so this computes what is
 * already undone and applies only the difference — a second partial refund, or
 * the same event twice, never double-reverses.
 */
async function reverseInvoiceCommission(invoiceId: string, refundRef: string, fraction: number, markReferral: 'refunded' | 'flagged' | null, flag?: string) {
  const entries = await prisma.partnerCommissionEntry.findMany({ where: { source: 'stripe', sourceRef: invoiceId } })
  if (!entries.length) {
    // No commission was earned on it, but the referral still stops counting.
    if (markReferral) await markReferralForInvoice(invoiceId, markReferral, flag)
    return 'no_commission'
  }
  const earned = entries.reduce((a, e) => a + e.commissionMillicents, 0)
  const target = Math.round(earned * Math.min(1, fraction))
  const cancelled = entries.filter((e) => e.status === 'reversed').reduce((a, e) => a + e.commissionMillicents, 0)
  const clawbacks = await prisma.partnerCommissionEntry.findMany({
    where: { source: 'adjustment', sourceRef: { startsWith: `${invoiceId}:` } },
    select: { commissionMillicents: true },
  })
  const clawed = -clawbacks.reduce((a, e) => a + e.commissionMillicents, 0)
  const delta = target - cancelled - clawed
  if (delta > 0) {
    const slices: LedgerSlice[] = entries.map((e) => ({
      id: e.id,
      installment: e.installment,
      status: e.payoutId ? 'paid' : (e.status as LedgerSlice['status']),
      commissionMillicents: e.commissionMillicents,
    }))
    const plan = planReversal(slices, delta)
    const first = entries[0]
    await prisma.$transaction([
      prisma.partnerCommissionEntry.updateMany({ where: { id: { in: plan.cancelIds } }, data: { status: 'reversed' } }),
      ...(plan.clawbackMillicents < 0
        ? [prisma.partnerCommissionEntry.upsert({
            where: { source_sourceRef_installment: { source: 'adjustment', sourceRef: `${invoiceId}:${refundRef}`, installment: 0 } },
            create: {
              partnerCodeId: first.partnerCodeId,
              referralId: first.referralId,
              source: 'adjustment',
              sourceRef: `${invoiceId}:${refundRef}`,
              periodMonth: new Date().toISOString().slice(0, 7),
              earnedAt: new Date(),
              commissionMillicents: plan.clawbackMillicents,
              status: 'clawback',
            },
            update: {},
          })]
        : []),
    ])
  }
  if (markReferral) await markReferralForInvoice(invoiceId, markReferral, flag)
  return delta > 0 ? 'reversed' : 'already_reversed'
}

async function markReferralForInvoice(invoiceId: string, status: 'refunded' | 'flagged', flag?: string) {
  const ref = await prisma.partnerReferral.findFirst({ where: { seenPaymentRefs: { has: invoiceId } } })
  if (!ref) return
  await prisma.partnerReferral.update({
    where: { id: ref.id },
    data: {
      status: ref.status === 'rejected' ? 'rejected' : status,
      currentlyPaying: false,
      flagReasons: flag && !ref.flagReasons.includes(flag) ? [...ref.flagReasons, flag] : ref.flagReasons,
    },
  })
}

export async function recordPartnerChargeRefunded(stripe: Stripe, charge: Stripe.Charge): Promise<string> {
  const invoiceId = await invoiceIdForPaymentIntent(stripe, idOf(charge.payment_intent))
  if (!invoiceId) return 'not_invoice'
  const fraction = charge.amount > 0 ? charge.amount_refunded / charge.amount : 0
  // A refund ref that changes with each cumulative amount, so each new partial refund is its own row.
  return reverseInvoiceCommission(invoiceId, `refund:${charge.id}:${charge.amount_refunded}`, fraction, fraction >= 1 ? 'refunded' : null)
}

export async function recordPartnerDispute(stripe: Stripe, dispute: Stripe.Dispute): Promise<string> {
  const invoiceId = await invoiceIdForPaymentIntent(stripe, idOf(dispute.payment_intent))
  if (!invoiceId) return 'not_invoice'
  return reverseInvoiceCommission(invoiceId, `dispute:${dispute.id}`, 1, 'refunded', 'chargeback')
}

export async function recordPartnerSubscriptionEnded(sub: Stripe.Subscription): Promise<string> {
  const res = await prisma.partnerReferral.updateMany({
    where: { stripeSubscriptionId: sub.id, status: { in: ['pending', 'qualified'] } },
    data: { currentlyPaying: false, status: 'churned', churnedAt: new Date() },
  })
  // A yearly plan's remaining scheduled slices stay: that year was paid and kept.
  return res.count ? 'churned' : 'not_referred'
}

/**
 * The webhook's one entry point. Runs after billing has handled the event.
 * 🛑 It never throws: a partner-ledger problem must not turn a successful
 * billing event into a 500 that Stripe retries for three days. Failures are
 * logged; the ledger's unique keys make a later replay safe.
 */
export async function onPartnerStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<string | null> {
  if (!isPartnerCodesEnabled()) return null
  try {
    switch (event.type) {
      case 'invoice.payment_succeeded':
        return await recordPartnerInvoicePaid(stripe, event.data.object as Stripe.Invoice)
      case 'charge.refunded':
        return await recordPartnerChargeRefunded(stripe, event.data.object as Stripe.Charge)
      case 'charge.dispute.created':
        return await recordPartnerDispute(stripe, event.data.object as Stripe.Dispute)
      case 'customer.subscription.deleted':
        return await recordPartnerSubscriptionEnded(event.data.object as Stripe.Subscription)
      default:
        return null
    }
  } catch (error) {
    console.error('[partner-codes] webhook side effect failed', { eventId: event.id, type: event.type, message: (error as Error)?.message })
    return 'error'
  }
}
