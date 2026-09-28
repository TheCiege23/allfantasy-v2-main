import type Stripe from "stripe"
import { prisma } from "@/lib/prisma"
import {
  getMonetizationCatalog,
  getMonetizationCatalogItemBySku,
  type MonetizationCatalogItem,
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

function unixSecondsToDate(value: unknown): Date | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000) : null
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id
  }
  return null
}

/**
 * The subscription's CURRENT service period.
 *
 * 🛑 API `2025-03-31.basil` MOVED `current_period_start/end` OFF THE SUBSCRIPTION
 * AND ONTO EACH SUBSCRIPTION ITEM. The live webhook endpoint is on
 * `2025-05-28.basil` (measured 2026-09-24), so the top-level fields are simply
 * absent. This used to read only the top level, under a comment claiming the
 * runtime "still sends unix seconds on webhooks" — it does not — and
 * `customer.subscription.updated` then wrote `currentPeriodEnd = null`, which
 * `resolveSubscriptionStatus` reads as ACTIVE FOREVER.
 *
 * Top level first (older API versions still send it), then the items: earliest
 * start, latest end.
 */
export function subscriptionPeriods(sub: Stripe.Subscription): { start: Date | null; end: Date | null } {
  const raw = sub as unknown as Record<string, unknown>
  let start = unixSecondsToDate(raw.current_period_start)
  let end = unixSecondsToDate(raw.current_period_end)
  if (start && end) return { start, end }

  const items = (sub.items?.data ?? []) as unknown as Array<Record<string, unknown>>
  for (const item of items) {
    const itemStart = unixSecondsToDate(item.current_period_start)
    const itemEnd = unixSecondsToDate(item.current_period_end)
    if (itemStart && (!start || itemStart < start)) start = itemStart
    if (itemEnd && (!end || itemEnd > end)) end = itemEnd
  }
  return { start, end }
}

/**
 * The subscription an invoice bills for.
 *
 * ⚠ Same basil move as above: `Invoice.subscription` became
 * `invoice.parent.subscription_details.subscription`. Reading only the old field
 * returned null on every live invoice, so the handlers fell back to matching on
 * the CUSTOMER — which updates every subscription row that customer has.
 */
export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = invoice as unknown as Record<string, any>
  const legacy = idOf(raw.subscription)
  if (legacy) return legacy
  const fromParent = idOf(raw.parent?.subscription_details?.subscription)
  if (fromParent) return fromParent
  for (const line of (raw.lines?.data ?? []) as Array<Record<string, any>>) {
    const fromLine =
      idOf(line.parent?.subscription_item_details?.subscription) ?? idOf(line.subscription)
    if (fromLine) return fromLine
  }
  return null
}

/**
 * End of the service period a subscription invoice PAYS FOR.
 *
 * 🛑 NOT `invoice.period_end`. Stripe documents that field as looking BACK one
 * period on a subscription invoice: on a renewal it is the moment the NEW period
 * began, and on the first invoice it equals the creation time. Writing it as
 * `currentPeriodEnd` made `resolveSubscriptionStatus` read every renewing
 * subscriber as expired the instant their payment succeeded — and, depending on
 * which event landed last, brand-new buyers too.
 *
 * The line items carry the real service period. Returns null when there are none,
 * and callers must then LEAVE the stored period alone rather than guess.
 */
export function invoiceServicePeriodEnd(invoice: Stripe.Invoice): Date | null {
  const raw = invoice as unknown as Record<string, any>
  let end: Date | null = null
  for (const line of (raw.lines?.data ?? []) as Array<Record<string, any>>) {
    const lineEnd = unixSecondsToDate(line.period?.end)
    if (lineEnd && (!end || lineEnd > end)) end = lineEnd
  }
  return end
}

/**
 * Which catalog SKU a Stripe subscription is billing right now.
 *
 * Needed because a plan switch (Pro → Supreme in the billing portal) arrives as
 * `customer.subscription.updated` with a new price and nothing else — and the
 * handler used to copy only status and period, so the user kept the OLD plan.
 * Prefers `price.metadata.af_sku` (set on every price `create-stripe-prices.ts`
 * made), then matches the price id against the `STRIPE_PRICE_AF_*` env vars.
 */
export function resolveSubscriptionSkuFromStripe(
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env
): MonetizationSku | null {
  const subscriptionItems = getMonetizationCatalog().subscriptions
  for (const item of (sub.items?.data ?? []) as Stripe.SubscriptionItem[]) {
    const price = item.price
    if (!price) continue
    const tagged = price.metadata?.af_sku?.trim().toLowerCase()
    if (tagged && subscriptionItems.some((catalogItem) => catalogItem.sku === tagged)) {
      return tagged as MonetizationSku
    }
    const byEnv = subscriptionItems.find(
      (catalogItem) => env[catalogItem.stripePriceEnvVar]?.trim() === price.id
    )
    if (byEnv) return byEnv.sku
  }
  return null
}

/** Upsert the `SubscriptionPlan` row a catalog subscription SKU belongs to. */
export async function upsertSubscriptionPlanForCatalogItem(
  item: MonetizationCatalogItem
): Promise<{ id: string } | null> {
  const plans = (prisma as any).subscriptionPlan
  if (!plans || !item.planFamily || !item.interval) return null
  const data = {
    name: item.title.replace(" Monthly", "").replace(" Yearly", ""),
    description: item.description,
    isBundle: item.planFamily === "af_supreme",
    isActive: true,
    metadata: {
      sku: item.sku,
      interval: item.interval,
      amountUsd: item.amountUsd,
    },
  }
  return plans.upsert({
    where: { code: item.planFamily },
    update: data,
    create: { code: item.planFamily, ...data },
    select: { id: true },
  })
}

export async function updateSubscriptionFromStripeEvent(
  sub: Stripe.Subscription,
  userId: string
): Promise<void> {
  const stripeSubscriptionId = sub.id
  const stripeCustomerId = typeof sub.customer === "string" ? sub.customer : null
  const status = mapStripeSubscriptionStatus(sub.status)
  const { start: currentPeriodStart, end: currentPeriodEnd } = subscriptionPeriods(sub)

  // A missing period is "unknown", never "clear it": a null end reads as active
  // forever, so an event that cannot tell us the period must not erase the one we have.
  const periodPatch = {
    ...(currentPeriodStart ? { currentPeriodStart } : {}),
    ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
  }

  // A plan switch changes the price and nothing else — follow it.
  const sku = resolveSubscriptionSkuFromStripe(sub)
  const catalogItem = sku ? getMonetizationCatalogItemBySku(sku) : null
  const plan = catalogItem ? await upsertSubscriptionPlanForCatalogItem(catalogItem) : null
  const planPatch = plan && catalogItem ? { sku: catalogItem.sku, subscriptionPlanId: plan.id } : {}

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
        ...periodPatch,
        ...planPatch,
        metadata: { lastStripeEvent: "customer.subscription.updated" },
      },
    })
    return
  }

  // ⚠ Only adopt a row that has NO subscription id yet (the checkout-created row
  // this event raced ahead of). The fallback used to take the customer's most recent
  // row of ANY kind and overwrite its subscription id — once one Stripe customer can
  // hold two plans, that rewrites the OTHER plan's row and orphans it.
  const fallback = await prisma.userSubscription.findFirst({
    where: {
      userId,
      stripeSubscriptionId: null,
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
      ...periodPatch,
      ...planPatch,
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

  // ⚠ Never touch a CANCELED row from this customer-wide fallback: past_due plus a
  // fresh grace period resolves to "grace", which re-grants a plan the user cancelled.
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null
  await prisma.userSubscription.updateMany({
    where: {
      userId,
      status: { not: "canceled" },
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
  // The line items' service period — NOT invoice.period_end, which looks back a
  // period (see invoiceServicePeriodEnd).
  const currentPeriodEnd = invoiceServicePeriodEnd(invoice)

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

  // ⚠ Same guard as markSubscriptionPastDue: a customer-wide fallback must not
  // flip a cancelled row back to active.
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null
  await prisma.userSubscription.updateMany({
    where: {
      userId,
      status: { not: "canceled" },
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
  const subId = invoiceSubscriptionId(invoice)
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
