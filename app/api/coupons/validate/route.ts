import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  normalizeCouponCode,
  validateCouponForUser,
  calculateDiscountedAmounts,
  type CouponAppliesTo,
} from "@/lib/promotions/sponsorCoupon"
import { getMonetizationCatalogItemBySku, type MonetizationSku } from "@/lib/monetization/catalog"
import { previewPartnerCoupon } from "@/lib/partner-codes/validate"

/**
 * POST /api/coupons/validate
 *
 * Validates a promotional coupon code for the current user + product.
 * Returns discount details and price preview without creating any DB rows.
 * Actual redemption is created at checkout start and confirmed via webhook.
 *
 * Body:
 *   code        — raw user-typed code (any casing/spacing)
 *   productType — "token_pack" | "subscription"
 *   sku         — the MonetizationSku to price-preview (optional)
 */
export async function POST(req: Request) {
  try {
    const session = (await getServerSession(authOptions as any)) as
      | { user?: { id?: string } }
      | null

    const userId = session?.user?.id ?? null

    let body: { code?: string; productType?: string; sku?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
    }

    const rawCode = String(body?.code ?? "").trim()
    if (!rawCode) {
      return NextResponse.json({ error: "Missing code" }, { status: 400 })
    }

    const productType = String(body?.productType ?? "").trim() as CouponAppliesTo
    if (productType !== "token_pack" && productType !== "subscription") {
      return NextResponse.json(
        { error: "productType must be token_pack or subscription" },
        { status: 400 }
      )
    }

    const normalizedCode = normalizeCouponCode(rawCode)
    const result = await validateCouponForUser({ userId, rawCode, productType })

    // Commissioner Partner Codes (lib/partner-codes/validate.ts): a code that is not a sponsor code may
    // be a commissioner's. Subscriptions only; off unless PARTNER_CODES_ENABLED=1.
    if (!result.valid && result.reason === "not_found" && productType === "subscription") {
      const skuForPartner = String(body?.sku ?? "").trim()
      const partner = await previewPartnerCoupon({
        userId,
        rawCode,
        item: skuForPartner ? getMonetizationCatalogItemBySku(skuForPartner as MonetizationSku) : null,
      })
      if (partner?.valid) {
        return NextResponse.json({ ...partner, sponsorName: null, stripePrefillCode: "", alreadyUsed: false, partner: true })
      }
      if (partner) {
        return NextResponse.json({ valid: false, normalizedCode, reason: partner.reason, alreadyUsed: partner.reason === "already_used" })
      }
    }

    if (!result.valid) {
      const statusMap: Record<string, number> = {
        requires_auth: 401,
        already_used: 200, // 200 so UI can show the "already used" state cleanly
        not_found: 200,
        not_applicable: 200,
        inactive: 200,
      }
      return NextResponse.json(
        {
          valid: false,
          normalizedCode,
          reason: result.reason,
          alreadyUsed: result.alreadyUsed,
        },
        { status: statusMap[result.reason] ?? 200 }
      )
    }

    // Price preview (optional, only if sku is provided)
    let subtotalCents: number | null = null
    let discountAmountCents: number | null = null
    let totalCents: number | null = null

    const skuRaw = String(body?.sku ?? "").trim()
    if (skuRaw) {
      const item = getMonetizationCatalogItemBySku(skuRaw as MonetizationSku)
      if (item) {
        subtotalCents = Math.round(item.amountUsd * 100)
        const amounts = calculateDiscountedAmounts(subtotalCents, result.discountPercent)
        discountAmountCents = amounts.discountAmountCents
        totalCents = amounts.totalCents
      }
    }

    return NextResponse.json({
      valid: true,
      normalizedCode: result.normalizedCode,
      displayCode: result.displayCode,
      discountPercent: result.discountPercent,
      sponsorName: result.sponsorName,
      stripePrefillCode: result.stripePrefillCode,
      alreadyUsed: false,
      subtotalCents,
      discountAmountCents,
      totalCents,
    })
  } catch (err) {
    console.error("[/api/coupons/validate] error:", err)
    return NextResponse.json({ error: "Validation failed" }, { status: 500 })
  }
}
