import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  assertNoLeagueSettlementIntent,
  isMonetizationComplianceError,
} from "@/lib/monetization/compliance-guardrails"
import {
  getMonetizationCatalogItemBySku,
  type MonetizationSku,
} from "@/lib/monetization/catalog"
import { resolveSafeReturnPath } from "@/lib/monetization/checkout-urls"
import { buildStripeCheckoutSessionForSku } from "@/lib/monetization/StripeCheckoutSession"
import { enforcePaidSubscriptionGeo } from "@/lib/geo/enforcePaidSubscriptionGeo"
import { buildSubscriptionMetaEvent } from "@/lib/monetization/meta"
import { trackMetaServerEvent } from "@/lib/meta-capi"
import {
  validateCouponForUser,
  createPendingRedemption,
  calculateDiscountedAmounts,
  findSponsorCoupon,
} from "@/lib/promotions/sponsorCoupon"

type CheckoutSubscriptionBody = {
  sku?: string
  returnPath?: string
  /** Optional sponsor/promo code entered by user at checkout (e.g. "WassupFred") */
  couponCode?: string
}

export async function POST(req: Request) {
  try {
    const geoBlock = await enforcePaidSubscriptionGeo(req)
    if (geoBlock) return geoBlock

    const session = (await getServerSession(authOptions as any)) as
      | { user?: { id?: string; email?: string | null } }
      | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = (await req.json()) as CheckoutSubscriptionBody
    const sku = String(body?.sku ?? "").trim()
    if (!sku) {
      return NextResponse.json({ error: "Missing sku" }, { status: 400 })
    }

    assertNoLeagueSettlementIntent(sku, {
      route: "/api/monetization/checkout/subscription",
      purchaseType: "subscription",
      sku,
    })

    const item = getMonetizationCatalogItemBySku(sku as MonetizationSku)
    if (!item || item.type !== "subscription") {
      return NextResponse.json({ error: "Invalid subscription sku" }, { status: 400 })
    }

    // ── Coupon validation (server-side, client discount never trusted) ──────
    let resolvedCouponCode: string | null = null
    let couponDiscountPercent = 0
    let discountInfo: { discountAmountCents: number; totalCents: number } | null = null
    const rawCouponCode = String(body?.couponCode ?? "").trim()
    if (rawCouponCode) {
      const validation = await validateCouponForUser({
        userId: session.user.id,
        rawCode: rawCouponCode,
        productType: "subscription",
      })
      if (validation.valid) {
        resolvedCouponCode = validation.normalizedCode
        couponDiscountPercent = validation.discountPercent
        const subtotalCents = Math.round(item.amountUsd * 100)
        discountInfo = calculateDiscountedAmounts(subtotalCents, couponDiscountPercent)

        const coupon = findSponsorCoupon(validation.normalizedCode)
        if (coupon) {
          await createPendingRedemption({
            userId: session.user.id,
            normalizedCode: coupon.normalizedCode,
            displayCode: coupon.displayCode,
            sponsorName: coupon.sponsorName,
            campaignName: coupon.campaignName,
            discountPercent: coupon.discountPercent,
            appliesTo: "subscription",
            productKey: item.sku,
            amountSubtotalCents: Math.round(item.amountUsd * 100),
            discountAmountCents: discountInfo.discountAmountCents,
            amountTotalCents: discountInfo.totalCents,
          }).catch((err) =>
            console.error("[checkout/subscription] createPendingRedemption failed:", err)
          )
        }
      }
    }

    const returnPath = resolveSafeReturnPath(body?.returnPath, "/pricing")
    // Canonical checkout: charge is derived from the catalog price id
    // (STRIPE_PRICE_AF_*), guaranteeing charged == displayed catalog price.
    const checkout = await buildStripeCheckoutSessionForSku({
      sku: item.sku,
      userId: session.user.id,
      userEmail: session.user.email ?? null,
      returnPath,
      couponCode: resolvedCouponCode,
    })
    if (!checkout || checkout.purchaseType !== "subscription") {
      return NextResponse.json(
        {
          error:
            "Checkout is temporarily unavailable for this subscription plan. Please try again shortly.",
        },
        { status: 503 }
      )
    }

    const metaEvent = buildSubscriptionMetaEvent("InitiateCheckout", item, {
      sourceId: `subscription:${session.user.id}:${item.sku}`,
    })
    await trackMetaServerEvent({
      eventName: metaEvent.eventName,
      eventId: metaEvent.eventId,
      customData: metaEvent.customData,
      email: session.user.email ?? null,
      userId: session.user.id,
      request: req,
      source: "subscription_checkout_start",
    }).catch((metaError) => {
      console.warn("[monetization checkout] Meta InitiateCheckout failed:", metaError)
      return null
    })

    return NextResponse.json({
      url: checkout.url,
      sku: item.sku,
      purchaseType: "subscription",
      metaEvent,
      ...(resolvedCouponCode
        ? {
            couponApplied: true,
            couponCode: resolvedCouponCode,
            discountPercent: couponDiscountPercent,
            discountAmountCents: discountInfo?.discountAmountCents ?? null,
          }
        : { couponApplied: false }),
    })
  } catch (error) {
    if (isMonetizationComplianceError(error)) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      )
    }
    console.error("POST /api/monetization/checkout/subscription error:", error)
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 })
  }
}
