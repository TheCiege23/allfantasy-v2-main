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
import {
  normalizeCouponCode,
  validateCouponForUser,
  createPendingRedemption,
  calculateDiscountedAmounts,
  findSponsorCoupon,
} from "@/lib/promotions/sponsorCoupon"

type CheckoutTokensBody = {
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

    const body = (await req.json()) as CheckoutTokensBody
    const sku = String(body?.sku ?? "").trim()
    if (!sku) {
      return NextResponse.json({ error: "Missing sku" }, { status: 400 })
    }

    assertNoLeagueSettlementIntent(sku, {
      route: "/api/monetization/checkout/tokens",
      purchaseType: "tokens",
      sku,
    })

    const item = getMonetizationCatalogItemBySku(sku as MonetizationSku)
    if (!item || item.type !== "token_pack") {
      return NextResponse.json({ error: "Invalid token pack sku" }, { status: 400 })
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
        productType: "token_pack",
      })
      if (validation.valid) {
        resolvedCouponCode = validation.normalizedCode
        couponDiscountPercent = validation.discountPercent
        const subtotalCents = Math.round(item.amountUsd * 100)
        discountInfo = calculateDiscountedAmounts(subtotalCents, couponDiscountPercent)

        // Create pending redemption (idempotent — safe to call multiple times)
        const coupon = findSponsorCoupon(validation.normalizedCode)
        if (coupon) {
          await createPendingRedemption({
            userId: session.user.id,
            normalizedCode: coupon.normalizedCode,
            displayCode: coupon.displayCode,
            sponsorName: coupon.sponsorName,
            campaignName: coupon.campaignName,
            discountPercent: coupon.discountPercent,
            appliesTo: "token_pack",
            productKey: item.sku,
            amountSubtotalCents: Math.round(item.amountUsd * 100),
            discountAmountCents: discountInfo.discountAmountCents,
            amountTotalCents: discountInfo.totalCents,
          }).catch((err) =>
            console.error("[checkout/tokens] createPendingRedemption failed:", err)
          )
        }
      }
      // Silently ignore invalid coupons — user still completes checkout without discount
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
    if (!checkout || checkout.purchaseType !== "tokens") {
      return NextResponse.json(
        {
          error: "Checkout is temporarily unavailable for this token pack. Please try again shortly.",
        },
        { status: 503 }
      )
    }

    return NextResponse.json({
      url: checkout.url,
      sku: item.sku,
      tokenAmount: item.tokenAmount ?? 0,
      purchaseType: "tokens",
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
    console.error("POST /api/monetization/checkout/tokens error:", error)
    return NextResponse.json({ error: "Checkout failed" }, { status: 500 })
  }
}
