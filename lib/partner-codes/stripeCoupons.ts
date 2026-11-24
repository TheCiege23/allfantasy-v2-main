import 'server-only'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import type { PartnerSettings } from './settings'
import { yearlyDiscountCents } from './money'

/**
 * The Stripe coupons behind the friend discount, built from the live settings.
 *
 *  monthly plans: percent_off = discountPercent, duration "repeating", discountMonths
 *  yearly plans:  amount_off per price (prorated or full year), duration "once"
 *
 * Coupon ids carry the settings in their name, so changing a setting makes a NEW
 * coupon — Stripe coupons are immutable, and a subscriber already on the old one
 * keeps exactly what they were shown.
 */
export function monthlyCouponId(s: PartnerSettings): string {
  return `af_partner_m_${s.discountPercent}pct_${s.discountMonths}mo`
}

export function yearlyCouponId(priceId: string, amountOffCents: number): string {
  return `af_partner_y_${priceId}_${amountOffCents}c`.slice(0, 200)
}

async function ensureCoupon(stripe: Stripe, id: string, params: Stripe.CouponCreateParams): Promise<string> {
  try {
    await stripe.coupons.retrieve(id)
    return id
  } catch (error) {
    if ((error as { code?: string })?.code !== 'resource_missing') throw error
  }
  try {
    await stripe.coupons.create({ ...params, id })
  } catch (error) {
    // Two checkouts racing to create the same coupon: the loser's create fails, the coupon exists.
    if ((error as { code?: string })?.code !== 'resource_already_exists') throw error
  }
  return id
}

export async function ensurePartnerCoupon(args: {
  stripe: Stripe
  settings: PartnerSettings
  interval: 'month' | 'year'
  priceId: string
  annualPriceCents: number
}): Promise<string | null> {
  const { stripe, settings } = args
  if (settings.discountPercent <= 0) return null
  if (args.interval === 'month') {
    const id = monthlyCouponId(settings)
    await ensureCoupon(stripe, id, {
      percent_off: settings.discountPercent,
      duration: 'repeating',
      duration_in_months: settings.discountMonths,
      name: `Partner code: ${settings.discountPercent}% off ${settings.discountMonths} months`,
      metadata: { af_partner_codes: '1' },
    })
    await prisma.partnerProgramSettings.update({ where: { id: 'singleton' }, data: { stripeMonthlyCouponId: id } }).catch(() => null)
    return id
  }
  const amountOff = yearlyDiscountCents(args.annualPriceCents, settings)
  if (amountOff <= 0) return null
  const id = yearlyCouponId(args.priceId, amountOff)
  await ensureCoupon(stripe, id, {
    amount_off: amountOff,
    currency: 'usd',
    duration: 'once',
    name: `Partner code: $${(amountOff / 100).toFixed(2)} off the first year`,
    metadata: { af_partner_codes: '1', price: args.priceId },
  })
  return id
}
