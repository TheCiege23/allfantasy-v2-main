import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import {
  getMonetizationCatalogItemBySku,
  type MonetizationSku,
} from "@/lib/monetization/catalog"
import { getIncludedPremiumCreditsForSubscription } from "@/lib/tokens/subscription-policy"
import type { SubscriptionPlanId } from "@/lib/subscription/types"
import { TokenSpendService } from "@/lib/tokens/TokenSpendService"

const GRACE_DAYS = 7

function addDays(base: Date, days: number): Date {
  const d = new Date(base)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

export async function resolveUserIdFromStripeCustomerId(
  customerId: string | null | undefined
): Promise<string | null> {
  if (!customerId || typeof customerId !== "string") return null
  const row = await prisma.userSubscription.findFirst({
    where: { stripeCustomerId: customerId },
    select: { userId: true },
    orderBy: { updatedAt: "desc" },
  })
  return row?.userId ?? null
}

/** Map Stripe subscription.status to our persisted DB status string. */
export function mapStripeSubscriptionStatus(stripeStatus: Stripe.Subscription.Status): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return stripeStatus === "trialing" ? "trialing" : "active"
    case "past_due":
    case "unpaid":
      return "past_due"
    case "canceled":
      return "canceled"
    case "incomplete_expired":
      return "expired"
    case "paused":
      return "paused"
    case "incomplete":
      return "incomplete"
    default:
      return String(stripeStatus)
  }
}

/**
 * Stripe API 2024+ typings may omit legacy top-level period fields on Subscription.
 * Read via loose record access (runtime still sends unix seconds on webhooks).
 */
function subscriptionPeriods(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const raw = sub as unknown as Record<string, unknown>
  const startSec = raw.current_period_start
  const endSec = raw.current_period_end
  return {
    start: typeof startSec === "number" ? new Date(startSec * 1000) : null,
    end: typeof endSec === "number" ? new Date(endSec * 1000) : null,
  }
}

function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null
  }
  const sub = inv.subscription
  if (typeof sub === "string") return sub
  if (sub && typeof sub !== "string") return sub.id
  return null
}

export async function updateSubscriptionFromStripeEvent(
  sub: Stripe.Subscription,
  userId: string
): Promise<void> {
  const stripeSubscriptionId = sub.id
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : null
  const status = mapStripeSubscriptionStatus(sub.status)
  const { start: currentPeriodStart, end: currentPeriodEnd } = subscriptionPeriods(sub)

  const existing = await prisma.userSubscription.findUnique({
    where: { stripeSubscriptionId },
    select: { id: true, userId: true },
  })

  if (existing) {
    if (existing.userId !== userId) return
    await prisma.userSubscription.update({
      where: { stripeSubscriptionId },
      data: {
        status,
        stripeCustomerId: stripeCustomerId ?? undefined,
        currentPeriodStart,
        currentPeriodEnd,
        metadata: { lastStripeEvent: "customer.subscription.updated" },
      },
    })
    return
  }

  const fallback = await prisma.userSubscription.findFirst({
    where: {
      userId,
      ...(stripeCustomerId ? { stripeCustomerId } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: { id: true },
  })

  if (!fallback) return

  await prisma.userSubscription.update({
    where: { id: fallback.id },
    data: {
      stripeSubscriptionId,
      status,
      stripeCustomerId: stripeCustomerId ?? undefined,
      currentPeriodStart,
      currentPeriodEnd,
      metadata: { lastStripeEvent: "customer.subscription.updated" },
    },
  })
}

export async function markSubscriptionAsExpired(
  sub: Stripe.Subscription,
  userId: string
): Promise<void> {
  const now = new Date()
  const stripeSubscriptionId = sub.id
  const raw = sub as unknown as Record<string, unknown>
  const endedSec = raw.ended_at
  const canceledSec = raw.canceled_at
  const ended =
    typeof endedSec === "number"
      ? new Date(endedSec * 1000)
      : typeof canceledSec === "number"
        ? new Date(canceledSec * 1000)
        : now
  const canceledAt =
    typeof canceledSec === "number" ? new Date(canceledSec * 1000) : now

  const res = await prisma.userSubscription.updateMany({
    where: {
      userId,
      stripeSubscriptionId,
    },
    data: {
      status: "canceled",
      canceledAt,
      expiresAt: ended,
      currentPeriodEnd: subscriptionPeriods(sub).end ?? ended,
      metadata: { lastStripeEvent: "customer.subscription.deleted" },
    },
  })

  if (res.count === 0 && typeof sub.customer === "string") {
    await prisma.userSubscription.updateMany({
      where: {
        userId,
        stripeCustomerId: sub.customer,
      },
      data: {
        status: "canceled",
        canceledAt,
        expiresAt: ended,
        metadata: { lastStripeEvent: "customer.subscription.deleted" },
      },
    })
  }
}

export async function markSubscriptionPastDue(
  invoice: Stripe.Invoice,
  userId: string
): Promise<void> {
  const now = new Date()
  const gracePeriodEnd = addDays(now, GRACE_DAYS)
  const subId = invoiceSubscriptionId(invoice)

  if (subId) {
    await prisma.userSubscription.updateMany({
      where: { userId, stripeSubscriptionId: subId },
      data: {
        status: "past_due",
        gracePeriodEnd,
        metadata: { lastStripeEvent: "invoice.payment_failed", invoiceId: invoice.id },
      },
    })
    return
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : null
  await prisma.userSubscription.updateMany({
    where: {
      userId,
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
    data: {
      status: "past_due",
      gracePeriodEnd,
      metadata: { lastStripeEvent: "invoice.payment_failed", invoiceId: invoice.id },
    },
  })
}

export async function refreshSubscriptionPeriod(
  invoice: Stripe.Invoice,
  userId: string
): Promise<void> {
  const subId = invoiceSubscriptionId(invoice)

  const inv = invoice as unknown as Record<string, unknown>
  const periodEndRaw = inv.period_end
  const periodEndSec = typeof periodEndRaw === "number" ? periodEndRaw : null
  const currentPeriodEnd =
    periodEndSec != null ? new Date(periodEndSec * 1000) : null

  if (subId) {
    await prisma.userSubscription.updateMany({
      where: { userId, stripeSubscriptionId: subId },
      data: {
        status: "active",
        gracePeriodEnd: null,
        ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
        metadata: {
          lastStripeEvent: "invoice.payment_succeeded",
          invoiceId: invoice.id,
          billingReason: invoice.billing_reason ?? null,
        },
      },
    })
    return
  }

  const customerId = typeof invoice.customer === "string" ? invoice.customer : null
  await prisma.userSubscription.updateMany({
    where: {
      userId,
      ...(customerId ? { stripeCustomerId: customerId } : {}),
    },
    data: {
      status: "active",
      gracePeriodEnd: null,
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
      metadata: {
        lastStripeEvent: "invoice.payment_succeeded",
        invoiceId: invoice.id,
      },
    },
  })
}

/**
 * Grant included subscription credits after a successful billing cycle.
 *
 * Resolves the user's plan from the invoice's Stripe subscription ID,
 * looks up the configured monthly/yearly credit amount for that plan, and calls
 * `TokenSpendService.grantMonthlySubscriptionCredits`.
 *
 * Safe to call speculatively — the idempotency key `subscription_credit:{invoiceId}`
 * guarantees exactly-once delivery on Stripe retries.  Returns early without
 * throwing if the subscription/plan cannot be resolved.
 */
export async function grantMonthlyCreditsFromInvoice(
  invoice: Stripe.Invoice,
  userId: string
): Promise<void> {
  const invoiceId = invoice.id
  const billingReason = invoice.billing_reason ?? "subscription_cycle"

  // Extract the Stripe subscription ID that generated this invoice
  const inv = invoice as unknown as Record<string, unknown>
  const subId = typeof inv.subscription === "string" ? inv.subscription : null
  if (!subId) return

  // Look up the user's DB subscription to get the plan SKU
  const sub = await (prisma as any).userSubscription.findFirst({
    where: { userId, stripeSubscriptionId: subId },
    select: { sku: true },
  })
  if (!sub?.sku) return

  // Map SKU → plan family → policy.
  // Catalog planFamily uses "af_" prefix (e.g. "af_pro") but SubscriptionPlanId
  // uses the bare form ("pro").  Strip the prefix for the policy lookup.
  const item = getMonetizationCatalogItemBySku(sub.sku as MonetizationSku)
  if (!item || item.type !== "subscription" || !item.planFamily) return
  if (item.interval !== "month" && item.interval !== "year") return

  const planId = item.planFamily.replace(/^af_/, "") as SubscriptionPlanId
  const tokenAmount = getIncludedPremiumCreditsForSubscription({
    planId,
    interval: item.interval,
  })
  if (!tokenAmount || tokenAmount <= 0) return

  const service = new TokenSpendService()
  await service.grantMonthlySubscriptionCredits({
    userId,
    tokenAmount,
    planFamily: item.planFamily,
    invoiceId,
    billingReason: String(billingReason),
  })
}
