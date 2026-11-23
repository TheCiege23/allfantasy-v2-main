import { NextRequest, NextResponse } from "next/server"
import { getStripeClient, getStripeWebhookSecret } from "@/lib/stripe-client"
import { prisma } from "@/lib/prisma"
import Stripe from "stripe"
import {
  getMonetizationCatalogItemBySku,
  type MonetizationSku,
} from "@/lib/monetization/catalog"
import { verifyClientReferenceSkuPurchase } from "@/lib/monetization/clientReferencePurchaseGuard"
import { parseStripeCheckoutClientReferenceId } from "@/lib/monetization/StripeCheckoutLinkRegistry"
import { TokenSpendService } from "@/lib/tokens/TokenSpendService"
import { syncUserProfileFromSubscriptions } from "@/lib/subscription/syncBridge"
import {
  grantMonthlyCreditsFromInvoice,
  invoiceSubscriptionId,
  markSubscriptionAsExpired,
  markSubscriptionPastDue,
  refreshSubscriptionPeriod,
  resolveUserIdFromStripeCustomerId,
  updateSubscriptionFromStripeEvent,
  upsertSubscriptionPlanForCatalogItem,
} from "@/lib/subscription/webhookHandlers"
import { isFullRefund, reverseSubscriptionForPayment } from "@/lib/subscription/paymentReversal"
import { cancelAndRefundCheckout, refuseCheckoutForRestrictedBillingState } from "@/lib/subscription/paidStateRefusal"
import { isSupportGuestCheckoutSession } from "@/lib/monetization/supportGuestCheckout"
import { lockAccountForCardBillingState } from "@/lib/geo/accountGeoLockServer"
import { persistLeagueEntryFeeFromStripeSession } from "@/lib/league-finance/leagueFinanceService"
import { buildSubscriptionMetaEvent, buildSubscriptionPurchaseMetaEvent } from "@/lib/monetization/meta"
import { recordFunnelEvent } from "@/lib/analytics/recordFunnelEvent"
import { MONETIZATION } from "@/lib/analytics/eventNames"
import { normalizeEntrySource } from "@/lib/monetization/upgradeEntrySource"
import { isTrialStartInvoice, readTrialDays, trialEndsAt } from "@/lib/monetization/freeTrial"
import { trackMetaServerEvent } from "@/lib/meta-capi"
import { onPaymentFailed, onPaymentRecovered, onSubscriptionCanceled, wasPastDue } from "@/lib/billing/retentionWebhook"
import { redeemCouponFromWebhook } from "@/lib/promotions/sponsorCoupon"
import { assertLeagueEntryFeeProcessingEnabled } from "@/lib/monetization/leagueEntryFeeKillSwitch"

export const runtime = "nodejs"

const SUPPORTED_PURCHASE_TYPES = new Set(["subscription", "tokens"])
const FINANCE_PURCHASE_TYPES = new Set(["league_entry_fee"])
/*
 * How long a "processing" row blocks Stripe's retries (409) before a retry may take
 * the event over. It only has to outlast a delivery that is GENUINELY still running —
 * this handler finishes in seconds — so ten minutes is generous.
 *
 * 🛑 THIS WAS 24 HOURS, AND THAT TURNED ONE CRASH INTO A DAY WITHOUT THE PLAN. A
 * container swap mid-request (every push to main redeploys this service) leaves the
 * row at "processing"; every retry inside the window then got a 409, so a customer who
 * had paid waited up to a day for their plan or tokens. The window guarded nothing a
 * replay could hurt: an "error" row is already reprocessed on Stripe's very next retry
 * with no wait at all, so every step below must be — and is — safe to run twice
 * (token grants keyed by session, monthly credits by invoice, dues by session, period
 * updates are sets, reversals check what is already reversed).
 */
const PROCESSING_EVENT_STALE_MS = 10 * 60 * 1000
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
): {
  userId: string
  sku: MonetizationSku
  couponCode?: string | null
  /** "metadata" is set server-side at session creation; "client_reference" is buyer-controlled. */
  source: "metadata" | "client_reference"
} | null {
  const metadata = (session.metadata ?? {}) as Record<string, string | undefined>
  const metadataUserId = metadata.userId?.trim()
  const metadataSku = metadata.sku?.trim().toLowerCase()
  const metadataCouponCode = metadata.couponCode?.trim() || metadata.coupon_code?.trim() || null
  if (metadataUserId && metadataSku) {
    return {
      userId: metadataUserId,
      sku: metadataSku as MonetizationSku,
      couponCode: metadataCouponCode,
      source: "metadata",
    }
  }

  const fromClientReference = parseStripeCheckoutClientReferenceId(session.client_reference_id)
  if (!fromClientReference) return null
  return {
    userId: fromClientReference.userId,
    sku: fromClientReference.sku,
    couponCode: fromClientReference.couponCode,
    source: "client_reference",
  }
}

/**
 * The SKU in a buyer-controlled client_reference_id only stands if the session
 * bought that SKU's catalog price (lib/monetization/clientReferencePurchaseGuard).
 * A mismatch is refused as non-retryable — it lands in the admin error list
 * instead of a retry storm — and is never granted on the claim alone.
 */
async function assertClientReferenceSkuWasPaidFor(
  session: Stripe.Checkout.Session,
  sku: MonetizationSku
): Promise<void> {
  const verdict = await verifyClientReferenceSkuPurchase(getStripeClient(), session, sku)
  if (!verdict.ok) {
    throw new NonRetryableWebhookError(`${verdict.reason} — refusing to grant`)
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

  const subscriptions = (prisma as any).userSubscription
  if (!subscriptions) return

  const now = new Date()
  /*
   * An AF Pro free trial (lib/monetization/freeTrial.ts) is TRIALING until it ends, not active for a
   * month: that is what the MRR estimate, the admin counts and the period end must all say. The
   * plan is fully unlocked either way — the entitlement resolver treats trialing as active.
   */
  const trialDays = checkoutTrialDays(session)
  const currentPeriodEnd = trialDays > 0 ? trialEndsAt(now, trialDays) : addBillingInterval(now, item.interval)
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : null

  const plan = await upsertSubscriptionPlanForCatalogItem(item)
  if (!plan) return

  const baseData = {
    userId: context.userId,
    subscriptionPlanId: plan.id,
    status: trialDays > 0 ? "trialing" : "active",
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
      ...(trialDays > 0 ? { trialDays } : {}),
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

/** Resolve a one-time payment back to its authoritative Checkout Session, never charge metadata. */
async function reverseTokenPurchaseForPayment(
  stripe: Stripe, paymentIntentId: string | null, sourceId: string, reason: 'refund' | 'dispute'
): Promise<boolean> {
  if (!paymentIntentId) return false
  const sessions = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 100 })
  if (sessions.has_more) throw new Error('Payment has too many checkout sessions to reconcile safely')
  let reversed = false
  for (const session of sessions.data) {
    if (session.mode !== 'payment') continue
    const context = resolveCheckoutContext(session)
    const item = context && getMonetizationCatalogItemBySku(context.sku)
    if (!context || !item || item.type !== 'token_pack') continue
    if (context.source === 'client_reference') {
      const verified = await verifyClientReferenceSkuPurchase(stripe, session, context.sku)
      if (!verified.ok) throw new Error(`Token reversal refused: ${verified.reason}`)
    }
    await new TokenSpendService().reversePackagePurchase({
      purchaseKey: `stripe_checkout:${session.id}:${item.sku}`, userId: context.userId,
      packageSku: item.sku, sourceType: 'stripe_checkout', sourceId, reason,
    })
    reversed = true
  }
  return reversed
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

  /*
   * A trial start is NOT a purchase: telling Meta "Purchase" for a $0 trial teaches the ad optimiser to
   * buy people who never pay. It gets StartTrial; the Purchase is sent when the first real charge lands
   * (recordTrialConversion, on the invoice).
   */
  const metaEvent = checkoutTrialDays(session) > 0
    ? buildSubscriptionMetaEvent("StartTrial", item, { sourceId: `stripe_trial:${session.id}`, deterministic: true, orderId: session.id })
    : buildSubscriptionPurchaseMetaEvent(item, session.id)
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

/**
 * The funnel's `monetization.paid_conversion_confirmed` (2026-11-15): webhook-confirmed, after the
 * paid-state refusal check, carrying the surface that sent the buyer (`metadata.entrySource`, set by
 * the checkout route). Stripe can deliver one event more than once, so the row carries the session id
 * and the admin funnel counts distinct sessions. No cookies here — this is Stripe calling, not the buyer.
 */
async function recordPaidConversion(
  session: Stripe.Checkout.Session,
  context: { userId: string; sku: MonetizationSku } | null,
): Promise<void> {
  if (!context?.userId || !context.sku) return
  const metadata = (session.metadata ?? {}) as Record<string, string | undefined>
  const trialDays = checkoutTrialDays(session)
  await recordFunnelEvent({
    // A trial start is counted as one, never as a paid conversion — that comes with the first charge.
    event: trialDays > 0 ? MONETIZATION.TRIAL_STARTED : MONETIZATION.PAID_CONVERSION_CONFIRMED,
    userId: context.userId,
    getCookie: () => undefined,
    meta: {
      sku: context.sku,
      entry_source: normalizeEntrySource(metadata.entrySource) ?? "unknown",
      stripe_session_id: session.id,
      ...(trialDays > 0 ? { trial_days: trialDays } : {}),
    },
  })
}

/** The trial a completed checkout started: only when the session says so AND nothing was charged. */
function checkoutTrialDays(session: Stripe.Checkout.Session): number {
  const metadata = (session.metadata ?? {}) as Record<string, string | undefined>
  const days = readTrialDays(metadata.trialDays)
  return days > 0 && session.payment_status === "no_payment_required" ? days : 0
}

/**
 * A trial that just became a paying subscription (2026-11-15): the first invoice with money on it for
 * a subscription that started as a trial. Recorded ONCE per subscription — a renewal a month later is
 * a renewal, not a conversion — as the paid conversion, with the surface that started it, and Meta gets
 * its Purchase now rather than at the $0 start.
 */
async function recordTrialConversion(invoice: Stripe.Invoice, userId: string): Promise<void> {
  if (invoice.billing_reason !== "subscription_cycle" || !((invoice.amount_paid ?? 0) > 0)) return
  const raw = invoice as unknown as Record<string, any>
  const subMeta = (raw.parent?.subscription_details?.metadata ?? raw.subscription_details?.metadata ?? {}) as Record<string, string | undefined>
  if (readTrialDays(subMeta.trialDays) <= 0) return
  const subscriptionId = invoiceSubscriptionId(invoice)
  if (!subscriptionId) return
  const key = `sub:${subscriptionId}`
  const already = await prisma.analyticsEvent
    .findFirst({
      where: { event: MONETIZATION.PAID_CONVERSION_CONFIRMED, userId, meta: { path: ["stripe_session_id"], equals: key } },
      select: { id: true },
    })
    .catch(() => null)
  if (already) return
  const sku = typeof subMeta.sku === "string" ? subMeta.sku.trim().toLowerCase() : ""
  await recordFunnelEvent({
    event: MONETIZATION.PAID_CONVERSION_CONFIRMED,
    userId,
    getCookie: () => undefined,
    meta: { sku: sku || "unknown", entry_source: normalizeEntrySource(subMeta.entrySource) ?? "unknown", stripe_session_id: key, from_trial: true },
  })
  const item = sku ? getMonetizationCatalogItemBySku(sku as MonetizationSku) : null
  if (item && item.type === "subscription") {
    const metaEvent = buildSubscriptionMetaEvent("Purchase", item, { sourceId: `stripe_trial_conversion:${subscriptionId}`, deterministic: true, orderId: subscriptionId })
    await trackMetaServerEvent({
      eventName: metaEvent.eventName,
      eventId: metaEvent.eventId,
      customData: metaEvent.customData,
      userId,
      source: "stripe_webhook_trial_converted",
    }).catch((metaError) => {
      console.warn("[stripe webhook] Meta trial Purchase failed:", metaError)
    })
  }
}

async function routeCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<string | null> {
  const purchaseType = resolveCheckoutPurchaseType(session)
  let checkoutContext = resolveCheckoutContext(session)

  if (!purchaseType) {
    console.warn("[stripe webhook] checkout.session.completed missing purchaseType metadata", {
      sessionId: session.id,
    })
    return null
  }

  if (SUPPORTED_PURCHASE_TYPES.has(purchaseType)) {
    /*
     * ⚠ A COMPLETED SESSION IS NOT A PAID ONE. With a delayed payment method (bank
     * debit and the like) Checkout completes with payment_status "unpaid" and the
     * money arrives days later — or never. Granting here handed out the plan or the
     * tokens before the funds cleared. Wait for
     * checkout.session.async_payment_succeeded, which routes back through this same
     * function once payment_status is "paid"; every grant below is idempotent, so the
     * second pass is safe. "no_payment_required" (a 100%-off code, a trial) is paid enough.
     */
    if (session.payment_status === "unpaid") {
      console.info("[stripe webhook] checkout completed unpaid — awaiting async payment", {
        sessionId: session.id,
        purchaseType,
      })
      return purchaseType
    }

    /*
     * 🛑 THE PAID-STATE CARD CHECK, BEFORE ANYTHING IS GRANTED. A card whose
     * billing address is in a restricted state gets no plan, no tokens, no Meta
     * Purchase and no coupon redemption — the payment is refunded, the
     * subscription cancelled and the account locked out of paid checkout
     * (lib/subscription/paidStateRefusal). After the unpaid return above on
     * purpose: a delayed payment is checked when it actually settles, which comes
     * back through this function.
     */
    const refusal = await refuseCheckoutForRestrictedBillingState(session, checkoutContext?.userId ?? null, {
      stripe: getStripeClient(),
      lockAccount: lockAccountForCardBillingState,
    })
    if (refusal) return `refused_paid_state:${refusal.stateCode}`

    if (checkoutContext?.source === "client_reference") {
      await assertClientReferenceSkuWasPaidFor(session, checkoutContext.sku)
    }

    /*
     * The no-account support checkout (lib/monetization/supportGuestCheckout): there is no
     * userId yet, so the account comes from the email typed on Stripe's page — found, or made
     * now. After the paid-state refusal on purpose: a refused card makes no account.
     */
    let supportGuestBuyer: import("@/lib/monetization/supportGuestAccount").SupportGuestBuyer | null = null
    if (!checkoutContext && purchaseType === "subscription" && isSupportGuestCheckoutSession(session)) {
      const { resolveSupportGuestBuyer, supportGuestDuplicateReason } = await import("@/lib/monetization/supportGuestAccount")
      const { SUPPORT_GUEST_SKU } = await import("@/lib/monetization/supportGuestCheckout")
      supportGuestBuyer = await resolveSupportGuestBuyer(session)
      if (!supportGuestBuyer) {
        throw new NonRetryableWebhookError("support checkout completed without a buyer email — refusing to grant")
      }
      // Someone already paying for this plan who pays again by mistake gets the second charge back.
      if (!supportGuestBuyer.created && (await supportGuestDuplicateReason(supportGuestBuyer.userId, session))) {
        await cancelAndRefundCheckout(getStripeClient(), session, "support_duplicate")
        const { sendSupportWelcomeEmail } = await import("@/lib/monetization/supportGuestEmail")
        await sendSupportWelcomeEmail(supportGuestBuyer, { checkoutSessionId: session.id, duplicate: true })
        return "refused_support_duplicate"
      }
      checkoutContext = { userId: supportGuestBuyer.userId, sku: SUPPORT_GUEST_SKU, couponCode: null, source: "metadata" }
    }

    if (purchaseType === "subscription") {
      await persistSubscriptionEntitlementFromCheckout(session, checkoutContext)
      if (checkoutContext?.userId) {
        await syncUserProfileFromSubscriptions(checkoutContext.userId)
      }
      await trackSubscriptionPurchaseFromCheckout(session, checkoutContext)
      await recordPaidConversion(session, checkoutContext)
      if (supportGuestBuyer) {
        // After the plan is recorded, so the thank-you page and the email can never run ahead of it.
        const { sendSupportWelcomeEmail } = await import("@/lib/monetization/supportGuestEmail")
        await sendSupportWelcomeEmail(supportGuestBuyer, { checkoutSessionId: session.id })
      }
    } else if (purchaseType === "tokens") {
      await persistTokenPurchaseFromCheckout(session, checkoutContext)
      if (checkoutContext?.userId && session.payment_status === "paid" && (session.amount_total ?? 0) > 0) {
        await recordFunnelEvent({
          event: MONETIZATION.TOKEN_PURCHASE_CONFIRMED,
          userId: checkoutContext.userId,
          getCookie: () => undefined,
          meta: {
            sku: checkoutContext.sku,
            entry_source: normalizeEntrySource(session.metadata?.entrySource) ?? "unknown",
            stripe_session_id: session.id,
          },
        })
      }
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
      /*
       * 🛑 GATING THE ROUTE ALONE WOULD NOT HAVE STOPPED THIS.
       *
       * A Checkout session created before the kill switch closed can still be
       * paid afterwards, and Stripe would deliver the event here — writing
       * `LeagueDues` and incrementing a league treasury balance for a feature
       * the published terms say does not exist. Creation and fulfillment are
       * separate doors and both have to be shut.
       *
       * ⚠ THIS THROWS RATHER THAN RETURNING QUIETLY, ON PURPOSE. The catch
       * around this call marks the ledger row `error` with this message and
       * still answers Stripe 200, so there is no three-day retry storm and the
       * refusal is visible to the admin health endpoint. A silent no-op would
       * leave a real charge with no record anywhere.
       *
       * ⚠ MONEY MAY HAVE MOVED. Stripe has taken the customer's funds by the
       * time this event fires. Refusing to write our side means the charge needs
       * a human decision — refund, or fulfil manually after a legal sign-off.
       * The session id is in the message so it can be found.
       */
      assertLeagueEntryFeeProcessingEnabled(`stripe session ${session.id}`)
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
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
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
            // Retention (lib/billing/retention.ts): recorded now; the win-back note follows in three days.
            await onSubscriptionCanceled(deletedSub, userId)
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
            // Retention: tell them now (once per invoice, however often Stripe retries). Never throws.
            await onPaymentFailed(invoice, userId)
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
              // Read BEFORE the refresh writes `active`: a paid invoice on a past-due row is a recovered card.
              const recovering = await wasPastDue(invoice, userId)
              await refreshSubscriptionPeriod(invoice, userId)
              if (recovering) await onPaymentRecovered(invoice, userId)
              await syncUserProfileFromSubscriptions(userId)
              await grantMonthlyCreditsFromInvoice(invoice, userId)
              await recordTrialConversion(invoice, userId)
            }
          }
          break
        }
        /*
         * A payment taken back ends the plan it paid for AND stops billing — owner's rule,
         * 2026-09-24 (lib/subscription/paymentReversal.ts). A partial refund is a credit, not a
         * reversal, and changes nothing. `purchaseType` records the outcome for the admin view.
         */
        case "charge.refunded": {
          const charge = event.data.object as Stripe.Charge
          if (!isFullRefund(charge)) {
            purchaseType = "refund_partial"
            break
          }
          const reversal = await reverseSubscriptionForPayment({
            stripe,
            reason: "refund",
            paymentIntentId:
              typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null,
            customerId: typeof charge.customer === "string" ? charge.customer : charge.customer?.id ?? null,
            sourceId: charge.id,
          })
          const tokenReversed = reversal.outcome === "no_subscription" && await reverseTokenPurchaseForPayment(
            stripe, typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id ?? null,
            charge.id, 'refund')
          purchaseType = reversal.outcome === "revoked" ? "refund_revoked" : tokenReversed ? "refund_tokens_revoked" : "refund_no_subscription"
          break
        }
        case "charge.dispute.created": {
          const dispute = event.data.object as Stripe.Dispute
          const reversal = await reverseSubscriptionForPayment({
            stripe,
            reason: "dispute",
            paymentIntentId:
              typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id ?? null,
            customerId: null,
            sourceId: dispute.id,
          })
          const tokenReversed = reversal.outcome === "no_subscription" && await reverseTokenPurchaseForPayment(
            stripe, typeof dispute.payment_intent === 'string' ? dispute.payment_intent : dispute.payment_intent?.id ?? null,
            dispute.id, 'dispute')
          purchaseType = reversal.outcome === "revoked" ? "dispute_revoked" : tokenReversed ? "dispute_tokens_revoked" : "dispute_no_subscription"
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
