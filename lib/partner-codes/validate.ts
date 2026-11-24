import 'server-only'
import { prisma } from '@/lib/prisma'
import type { MonetizationCatalogItem } from '@/lib/monetization/catalog'
import { isPartnerCodesEnabled } from './flags'
import { findPartnerCode, loadPartnerSettings } from './service'
import { discountedMonthlyCents, yearlyDiscountCents } from './money'

export type PartnerCouponPreview =
  | { valid: true; displayCode: string; normalizedCode: string; discountPercent: number; appliedLabel: string; subtotalCents: number | null; discountAmountCents: number | null; totalCents: number | null }
  | { valid: false; reason: 'own_code' | 'already_used' | 'inactive' | 'not_applicable' }

/**
 * The checkout coupon box asks /api/coupons/validate; when a code is not a
 * sponsor code this answers for commissioner codes. Preview only — nothing is
 * written until checkout. Returns null when it is not a partner code at all.
 */
export async function previewPartnerCoupon(args: { userId: string | null; rawCode: string; item: MonetizationCatalogItem | null }): Promise<PartnerCouponPreview | null> {
  if (!isPartnerCodesEnabled()) return null
  const code = await findPartnerCode(args.rawCode)
  if (!code) return null
  if (code.status !== 'active') return { valid: false, reason: 'inactive' }
  if (args.userId && code.ownerUserId === args.userId) return { valid: false, reason: 'own_code' }
  if (args.userId) {
    const existing = await prisma.partnerReferral.findUnique({ where: { userId: args.userId }, select: { partnerCodeId: true, firstPaidAt: true } })
    if (existing && (existing.partnerCodeId !== code.id || existing.firstPaidAt)) return { valid: false, reason: 'already_used' }
  }
  const s = await loadPartnerSettings()
  let subtotalCents: number | null = null
  let discountAmountCents: number | null = null
  let appliedLabel = `${s.discountPercent}% off your first ${s.discountMonths} months`
  if (args.item) {
    if (args.item.type !== 'subscription') return { valid: false, reason: 'not_applicable' }
    subtotalCents = Math.round(args.item.amountUsd * 100)
    if (args.item.interval === 'year') {
      discountAmountCents = yearlyDiscountCents(subtotalCents, s)
      appliedLabel = `$${(discountAmountCents / 100).toFixed(2)} off your first year`
    } else {
      discountAmountCents = subtotalCents - discountedMonthlyCents(subtotalCents, s)
    }
  }
  return {
    valid: true,
    displayCode: code.code,
    normalizedCode: code.codeNormalized,
    discountPercent: s.discountPercent,
    appliedLabel,
    subtotalCents,
    discountAmountCents,
    totalCents: subtotalCents != null && discountAmountCents != null ? subtotalCents - discountAmountCents : null,
  }
}
