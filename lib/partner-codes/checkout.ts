import 'server-only'
import { getStripeClient } from '@/lib/stripe-client'
import { getMonetizationStripePriceIdForSku, type MonetizationCatalogItem } from '@/lib/monetization/catalog'
import { isPartnerCodesEnabled } from './flags'
import { attachReferral, loadPartnerSettings, partnerDiscountEligibility } from './service'
import { ensurePartnerCoupon } from './stripeCoupons'
import { REFUSAL_COPY } from './fraud'

export type PartnerCheckout =
  | { kind: 'none' }
  | { kind: 'refused'; message: string }
  | { kind: 'discount'; couponId: string | null; partnerCodeId: string; code: string }

/**
 * Called by the web subscription checkout route. Attaches the buyer to a code
 * (one they typed, else the /join cookie) and returns the friend-discount coupon
 * for their FIRST subscription. Web only — the iOS shell never reaches checkout.
 */
export async function resolvePartnerCheckout(args: {
  userId: string
  email: string | null
  typedCode: string | null
  cookieCode: string | null
  ip: string | null
  item: MonetizationCatalogItem
}): Promise<PartnerCheckout> {
  if (!isPartnerCodesEnabled()) return { kind: 'none' }
  if (args.item.type !== 'subscription' || !args.item.interval) return { kind: 'none' }

  for (const [raw, fromTyping] of [[args.typedCode, true], [args.cookieCode, false]] as const) {
    if (!raw?.trim()) continue
    const res = await attachReferral({ userId: args.userId, rawCode: raw, email: args.email, ip: args.ip })
    if (res.ok) break
    // A typed code that is a real partner code but can't be used gets a clear message.
    // An unknown typed code stays the sponsor-coupon route's business; a stale cookie is ignored.
    if (fromTyping && res.reason !== 'unknown_code') return { kind: 'refused', message: REFUSAL_COPY[res.reason] }
  }

  const eligible = await partnerDiscountEligibility(args.userId)
  if (!eligible) return { kind: 'none' }
  const priceId = getMonetizationStripePriceIdForSku(args.item.sku)
  if (!priceId) return { kind: 'none' }
  const couponId = await ensurePartnerCoupon({
    stripe: getStripeClient(),
    settings: await loadPartnerSettings(),
    interval: args.item.interval,
    priceId,
    annualPriceCents: Math.round(args.item.amountUsd * 100),
  })
  return { kind: 'discount', couponId, partnerCodeId: eligible.partnerCodeId, code: eligible.code }
}
