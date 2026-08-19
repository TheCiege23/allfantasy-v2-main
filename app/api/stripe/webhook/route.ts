import { NextRequest, NextResponse } from "next/server"
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe-client"
import { prisma } from "@/lib/prisma"
import Stripe from "stripe"
import {
  getMonetizationCatalogItemBySku,
  type MonetizationSku,
} from "@/lib/monetization/catalog"
import { parseStripeCheckoutClientReferenceId } from "@/lib/monetization/StripeCheckoutLinkRegistry"
import { TokenSpendService } from "@/lib/tokens/TokenSpendService"
import { syncUserProfileFromSubscriptions } from "@/lib/subscription/syncBridge"
import {
  grantMonthlyCreditsFromInvoice,
  markSubscriptionAsExpired,
  markSubscriptionPastDue,
  refreshSubscriptionPeriod,
  resolveUserIdFromStripeCustomerId,
  updateSubscriptionFromStripeEvent,
} from "@/lib/subscription/webhookHandlers"
import { persistLeagueEntryFeeFromStripeSession } from "@/lib/league-finance/leagueFinanceService"
import { buildSubscriptionPurchaseMetaEvent } from "@/lib/monetization/meta"
import { trackMetaServerEvent } from "@/lib/meta-capi"
import { redeemCouponFromWebhook } from "@/lib/promotions/sponsorCoupon"

export const runtime = "nodejs"

const SUPPORTED_PURCHASE_TYPES = new Set(["subscription", "tokens"])
const FINANCE_PURCHASE_TYPES = new Set(["league_entry_fee"])
// 24-hour window prevents the same event from being processed twice if Stripe
// retries after a crash. The idempotency key on TokenLedger handles double-grants,
// but the DB period-update calls also need to be shielded from duplicate execution.
const PROCESSING_EVENT_STALE_MS = 24 * 60 * 60 * 1000
const LEGACY_PURCHASE_TYPES = new Set([
  "donate",
  "donation",
  "support_donation",
  "lab",
  "bracket_lab_pass",
  "first_bracket_fee",
  "unlimited_unlock",
])

function normalizePurchaseType(value: string | undefined): string | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  return normalized.length > 0 ? normalized : null
}

function resolveCheckoutPurchaseType(session: Stripe.Checkout.Session): string | null {
  const metadata = (session.metadata ?? {}) as Record<string, string | undefined>
  const fromClientReference = parseStripeCheckoutClientReferenceId(session.client_reference_id)
  return (
    normalizePurchaseType(metadata.purchaseType) ??
    normalizePurchaseType(metadata.purchase_type) ??
    normalizePurchaseType(metadata.paymentType) ??
    normalizePurchaseType(fromClientReference?.purchaseType)
  )
}

function resolveCheckoutContext(
  session: Stripe.Checkout.Session
): { userId: string; sku: MonetizationSku; couponCode?: string | null } | null {
  const metadata = (session.metadata ?? {}) as Record<string, string | undefined>
  const metadataUserId = metadata.userId?.trim()
  const metadataSku = metadata.sku?.trim().toLowerCase()
  const metadataCouponCode = metadata.couponCode?.trim() || metadata.coupon_code?.trim() || null
  if (metadataUserId && metadataSku) {
    return {
      userId: metadataUserId,
      sku: metadataSku as MonetizationSku,
      couponCode: metadataCouponCode,
    }
  }

  const fromClientReference = parseStripeCheckoutClientReferenceId(session.client_reference_id)
  if (!fromClientReference) return null
  return {
    userId: fromClientReference.userId,
    sku: fromClientReference.sku,
    couponCode: fromClientReference.couponCode,
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message.slice(0, 2000)
  return String(error ?? "Unknown webhook error").slice(0, 2000)
}

function isFreshProcessingEvent(existing: {
  status?: string | null
  updatedAt?: Date | string | null
  createdAt?: Date | string | null
}) {
  if (existing.status !== "processing") return false
  const timestamp = existing.updatedAt ?? existing.createdAt
  const time = timestamp ? new Date(timestamp).getTime() : Number.NaN
  if (!Number.isFinite(time)) return true
  return Date.now() - time < PROCESSING_EVENT_STALE_MS
}

/**
 * Thrown when a webhook event cannot be fulfilled due to a permanent data
 * problem (e.g. missing client_reference_id, unrecognised SKU).  Unlike a
 * transient DB error, retrying this event will never succeed, so the handler
 * marks it "error" in the DB for admin visibility but returns HTTP 200 to
 * Stripe to prevent an endless 3-day retry storm.
 */
class NonRetryableWebhookError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NonRetryableWebhookError"
  }
}

function addBillingInterval(base: Date, interval: "month" | "year"): Date {
  const next = new Date(base)
  if (interval === "year") {
    next.setUTCFullYear(next.getUTCFullYear() + 1)
  } else {
    next.setUTCMonth(next.getUTCMonth() + 1)
  }
  return next
}

async function persistSubscriptionEntitlementFromCheckout(
  session: Stripe.Checkout.Session,
  context: { userId: string; sku: MonetizationSku } | null
): Promise<void> {
  if (!context?.userId || !context?.sku) return

  const item = getMonetizationCatalogItemBySku(context.sku)
  if (!item || item.type !== "subscription" || !item.planFamily || !item.interval) return

  const plans = (prisma as any).subscriptionPlan
  const subscriptions = (prisma as any).userSubscription
  if (!plans || !subscriptions) return

  const now = new Date()
  const currentPeriodEnd = addBillingInterval(now, item.interval)
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : null

  const plan = await plans.upsert({
    where: { code: item.planFamily },
    update: {
      name: item.title.replace(" Monthly", "").replace(" Yearly", ""),
      description: item.description,
      isBundle: item.planFamily === "af_supreme",
      isActive: true,
      metadata: {
        sku: item.sku,
        interval: item.interval,
        amountUsd: item.amountUsd,
      },
    },
    create: {
      code: item.planFamily,
      name: item.title.replace(" Monthly", "").replace(" Yearly", ""),
      description: item.description,
      isBundle: item.planFamily === "af_supreme",
      isActive: true,
      metadata: {
        sku: item.sku,
        interval: item.interval,
        amountUsd: item.amountUsd,
      },
    },
    select: { id: true },
  })

  const baseData = {
    userId: context.userId,
    subscriptionPlanId: plan.id,
    status: "active",
    source: "stripe",
    sku: item.sku,
    stripeCustomerId:
      typeof session.customer === "string" ? session.customer : null,
    stripeCheckoutSessionId: session.id,
    currentPeriodStart: now,
    currentPeriodEnd,
    gracePeriodEnd: null,
    canceledAt: null,
    expiresAt: null,
    metadata: {
      purchaseType: "subscription",
      stripeSessionMode: session.mode ?? "subscription",
    },
  }

  if (stripeSubscriptionId) {
    await subscriptions.upsert({
      where: { stripeSubscriptionId },
      update: baseData,
      create: {
        ...baseData,
        stripeSubscriptionId,
      },
    })
    return
  }

  const existingByCheckout = await subscriptions.findFirst({
    where: { stripeCheckoutSessionId: session.id },
    select: { id: true },
  })
  if (existingByCheckout?.id) {
    await subscriptions.update({
      where: { id: existingByCheckout.id },
      data: baseData,
    })
    return
  }

  await subscriptions.upsert({
    where: { stripeCheckoutSessionId: session.id },
    update: baseData,
    create: baseData,
  })
}

async function persistTokenPurchaseFromCheckout(
  session: Stripe.Checkout.Session,
  context: { userId: string; sku: MonetizationSku } | null
): Promise<void> {
  // Missing context means client_reference_id was absent or malformed AND no
  // metadata fallback.  This is a permanent data problem — retrying won't fix
  // it — so we throw NonRetryableWebhookError to mark the event as "error" in
  // the DB (admin-visible) without triggering Stripe's retry loop.
  if (!context?.userId || !context?.sku) {
    throw new NonRetryableWebhookError(
      `token_grant_skipped:missing_context session=${session.id} ` +
        `hasUserId=${!!context?.userId} hasSku=${!!context?.sku}`
    )
  }

  const item = getMonetizationCatalogItemBySku(context.sku)
  if (!item || item.type !== "token_pack") {
    throw new NonRetryableWebhookError(
      `token_grant_skipped:invalid_sku sku=${context.sku} ` +
        `itemType=${item?.type ?? "not_found"} session=${session.id}`
    )
  }

  const service = new TokenSpendService()
  await service.grantTokensFromPackagePurchase({
    userId: context.userId,
    packageSku: item.sku,
    sourceType: "stripe_checkout",
    sourceId: session.id,
    idempotencyKey: `stripe_checkout:${session.id}:${item.sku}`,
    description: `Stripe purchase: ${item.title}`,
    metadata: {
      checkoutSessionId: session.id,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
      purchaseType: "tokens",
      sku: item.sku,
      tokenAmount: item.tokenAmount ?? null,
    },
  })
}

function resolveStripeCheckoutEmail(session: Stripe.Checkout.Session): string | null {
  return (
    session.customer_details?.email ??
    session.customer_email ??
    (typeof session.metadata?.email === "string" ? session.metadata.email : null) ??
    null
  )
}

async function trackSubscriptionPurchaseFromCheckout(
  session: Stripe.Checkout.Session,
  context: { userId: string; sku: MonetizationSku } | null
): Promise<void> {
  if (!context?.userId || !context.sku) return
  const item = getMonetizationCatalogItemBySku(context.sku)
  if (!item || item.type !== "subscription") return

  const metaEvent = buildSubscriptionPurchaseMetaEvent(item, session.id)
  await trackMetaServerEvent({
    eventName: metaEvent.eventName,
    eventId: metaEvent.eventId,
    customData: metaEvent.customData,
    email: resolveStripeCheckoutEmail(session),
    userId: context.userId,
    eventSourceUrl:
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      process.env.NEXT_PUBLIC_APP_URL?.trim() ||
      "https://allfantasy.ai/pricing",
    source: "stripe_webhook_checkout_completed",
  }).catch((metaError) => {
    console.warn("[stripe webhook] Meta Purchase failed:", metaError)
  })
}

async function routeCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<string | null> {
  const purchaseType = resolveCheckoutPurchaseType(session)
  const checkoutContext = resolveCheckoutContext(session)

  if (!purchaseType) {
    console.warn("[stripe webhook] checkout.session.completed missing purchaseType metadata", {
      sessionId: session.id,
    })
    return null
  }

  if (SUPPORTED_PURCHASE_TYPES.has(purchaseType)) {
    if (purchaseType === "subscription") {
      await persistSubscriptionEntitlementFromCheckout(session, checkoutContext)
      if (checkoutContext?.userId) {
        await syncUserProfileFromSubscriptions(checkoutContext.userId)
      }
      await trackSubscriptionPurchaseFromCheckout(session, checkoutContext)
    } else if (purchaseType === "tokens") {
      await persistTokenPurchaseFromCheckout(session, checkoutContext)
    }

    // ── Sponsor coupon redemption ─────────────────────────────────────
    // If a coupon code was embedded in client_reference_id, mark it redeemed.
    // This is idempotent — if already redeemed it silently no-ops.
    if (checkoutContext?.userId && checkoutContext.couponCode) {
      redeemCouponFromWebhook({
        userId: checkoutContext.userId,
        normalizedCode: checkoutContext.couponCode,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        stripeSubscriptionId:
          typeof session.subscription === "string" ? session.subscription : null,
        amountSubtotalCents: session.amount_subtotal ?? null,
        discountAmountCents:
          session.amount_subtotal != null && session.amount_total != null
            ? session.amount_subtotal - session.amount_total
            : null,
        amountTotalCents: session.amount_total ?? null,
      }).catch((err) =>
        console.error("[stripe webhook] redeemCouponFromWebhook failed (non-fatal):", err)
      )
    }

    return purchaseType
  }

  if (FINANCE_PURCHASE_TYPES.has(purchaseType)) {
    if (purchaseType === "league_entry_fee") {
      await persistLeagueEntryFeeFromStripeSession(session)
    }
    return purchaseType
  }

  if (LEGACY_PURCHASE_TYPES.has(purchaseType)) {
    // Transitional values are intentionally tolerated for backward compatibility.
    return purchaseType
  }

  console.warn("[stripe webhook] unknown purchaseType ignored safely", {
    purchaseType,
    sessionId: session.id,
  })
  return purchaseType
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get("stripe-signature")
    if (!signature) {
      return NextResponse.json(
        { error: "Missing stripe-signature header" },
        { status: 400 }
      )
    }

    const body = await req.text()
    const stripe = getStripeClient()
    const webhookSecret = getStripeWebhookSecret()

    let event: Stripe.Event

    try {
      event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
    } catch (err: any) {
      return NextResponse.json(
        { error: `Webhook signature verification failed: ${err.message}` },
        { status: 400 }
      )
    }

    const events = (prisma as any).stripeWebhookEvent
    const existing = await events.findUnique({
      where: { eventId: event.id },
      select: { status: true, createdAt: true, updatedAt: true },
    })

    if (existing?.status === "processed") {
      return NextResponse.json({ received: true, duplicate: true })
    }

    if (existing?.status === "processing" && isFreshProcessingEvent(existing)) {
      return NextResponse.json(
        { received: false, retry: true, status: "processing" },
        { status: 409 }
      )
    }

    if (existing?.status === "error" || existing?.status === "processing") {
      await events.update({
        where: { eventId: event.id },
        data: { status: "processing", error: null, type: event.type },
      })
    } else {
      try {
        await events.create({
          data: {
            eventId: event.id,
            type: event.type,
            status: "processing",
          },
        })
      } catch (createError: any) {
        if (createError?.code === "P2002") {
          return NextResponse.json(
            { received: false, retry: true, status: "processing" },
            { status: 409 }
          )
        }
        throw createError
      }
    }

    let purchaseType: string | null = null

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object as Stripe.Checkout.Session
          purchaseType = await routeCheckoutSessionCompleted(session)
          break
        }
        case "customer.subscription.updated": {
          const updatedSub = event.data.object as Stripe.Subscription
          const customerId =
            typeof updatedSub.customer === "string" ? updatedSub.customer : null
          const userId = customerId ? await resolveUserIdFromStripeCustomerId(customerId) : null
          if (userId) {
            await updateSubscriptionFromStripeEvent(updatedSub, userId)
            await syncUserProfileFromSubscriptions(userId)
          }
          break
        }
        case "customer.subscription.deleted": {
          const deletedSub = event.data.object as Stripe.Subscription
          const customerId =
            typeof deletedSub.customer === "string" ? deletedSub.customer : null
          const userId = customerId ? await resolveUserIdFromStripeCustomerId(customerId) : null
          if (userId) {
            await markSubscriptionAsExpired(deletedSub, userId)
            await syncUserProfileFromSubscriptions(userId)
          }
          break
        }
        case "invoice.payment_failed": {
          const invoice = event.data.object as Stripe.Invoice
          const customerId = typeof invoice.customer === "string" ? invoice.customer : null
          const userId = customerId ? await resolveUserIdFromStripeCustomerId(customerId) : null
          if (userId) {
            await markSubscriptionPastDue(invoice, userId)
            await syncUserProfileFromSubscriptions(userId)
          }
          break
        }
        case "invoice.payment_succeeded": {
          const invoice = event.data.object as Stripe.Invoice
          const reason = invoice.billing_reason
          if (reason === "subscription_cycle" || reason === "subscription_create") {
            const customerId = typeof invoice.customer === "string" ? invoice.customer : null
            const userId = customerId ? await resolveUserIdFromStripeCustomerId(customerId) : null
            if (userId) {
              await refreshSubscriptionPeriod(invoice, userId)
              await syncUserProfileFromSubscriptions(userId)
              await grantMonthlyCreditsFromInvoice(invoice, userId)
            }
          }
          break
        }
        default:
          break
      }

      await events.update({
        where: { eventId: event.id },
        data: {
          status: "processed",
          purchaseType,
          processedAt: new Date(),
          error: null,
        },
      })
    } catch (processingError) {
      await events
        .update({
          where: { eventId: event.id },
          data: {
            status: "error",
            purchaseType,
            processedAt: new Date(),
            error: toErrorMessage(processingError),
          },
        })
        .catch(() => null)

      // Permanent fulfillment failures (bad/missing client_reference_id, unknown
      // SKU) must NOT cause HTTP 500 — Stripe would retry for 3 days with zero
      // chance of success.  We have already marked the event "error" in the DB
      // so the admin health endpoint can surface it.  Return 200 to Stripe.
      if (processingError instanceof NonRetryableWebhookError) {
        console.error("[stripe webhook] non-retryable fulfillment error — event marked error in DB, no Stripe retry:", processingError.message)
        return NextResponse.json({
          received: true,
          eventType: event.type,
          purchaseType,
          fulfillmentError: processingError.message,
        })
      }

      throw processingError
    }

    return NextResponse.json({ received: true, eventType: event.type, purchaseType })
  } catch (err: any) {
    console.error("[stripe webhook] error:", err)
    return NextResponse.json(
      { error: err?.message || "Webhook handler failed" },
      { status: 500 }
    )
  }
}
