import { describe, expect, it } from 'vitest'
import {
  resolveCheckoutBillingPeriod,
  resolvePostPurchasePhase,
  verifyChargedAmount,
} from '@/lib/subscription/billingTruth'

const NOW = new Date('2026-07-22T12:00:00.000Z')

describe('resolveCheckoutBillingPeriod — renewal dates are observed, not fabricated', () => {
  it('uses Stripe\'s real billing period when available (observed)', () => {
    const period = resolveCheckoutBillingPeriod({
      stripeSubscription: {
        current_period_start: Math.floor(NOW.getTime() / 1000),
        // Stripe anchored the period to 17 days, not a clean month — the truth wins.
        current_period_end: Math.floor(NOW.getTime() / 1000) + 17 * 24 * 3600,
      },
      now: NOW,
      interval: 'month',
    })
    expect(period.periodSource).toBe('stripe_subscription')
    expect(period.provenance).toBe('observed')
    expect(period.currentPeriodEnd.getTime()).toBe(NOW.getTime() + 17 * 24 * 3600 * 1000)
  })

  it('falls back to a derived now+interval estimate and says so', () => {
    const period = resolveCheckoutBillingPeriod({ stripeSubscription: null, now: NOW, interval: 'month' })
    expect(period.periodSource).toBe('derived_estimate')
    expect(period.provenance).toBe('derived')
    expect(period.currentPeriodEnd.toISOString()).toBe('2026-08-22T12:00:00.000Z')
  })

  it('treats a subscription without a real period end as derived, never observed', () => {
    const period = resolveCheckoutBillingPeriod({
      stripeSubscription: { current_period_start: null, current_period_end: null },
      now: NOW,
      interval: 'year',
    })
    expect(period.provenance).toBe('derived')
    expect(period.currentPeriodEnd.toISOString()).toBe('2027-07-22T12:00:00.000Z')
  })
})

describe('verifyChargedAmount — displayed price vs actual charge', () => {
  it('passes when the subtotal matches the catalog price', () => {
    const check = verifyChargedAmount({ expectedAmountUsd: 9.99, amountSubtotalCents: 999, amountTotalCents: 999 })
    expect(check.matchesCatalog).toBe(true)
    expect(check.provenance).toBe('observed')
  })

  it('flags a Payment Link that charged a different list price (the drift bug)', () => {
    const check = verifyChargedAmount({ expectedAmountUsd: 9.99, amountSubtotalCents: 799, amountTotalCents: 799 })
    expect(check.matchesCatalog).toBe(false)
  })

  it('does not flag a legitimate promo discount as drift (subtotal matches, total lower)', () => {
    const check = verifyChargedAmount({
      expectedAmountUsd: 9.99,
      amountSubtotalCents: 999,
      amountTotalCents: 799,
      discountCents: 200,
    })
    expect(check.matchesCatalog).toBe(true)
    expect(check.discountCents).toBe(200)
  })

  it('reports UNAVAILABLE (null), never a fabricated pass, when Stripe supplied no amounts', () => {
    const check = verifyChargedAmount({ expectedAmountUsd: 9.99 })
    expect(check.matchesCatalog).toBeNull()
    expect(check.provenance).toBe('unavailable')
  })
})

describe('resolvePostPurchasePhase — success requires evidence', () => {
  const noEvidence = { subscription: false, tokens: false }

  it('server-verified session is success', () => {
    expect(resolvePostPurchasePhase({ syncStatus: 'synced', evidence: noEvidence })).toBe('success')
  })

  it('a bare ?success=1 with no session and no evidence is PENDING, never success', () => {
    expect(resolvePostPurchasePhase({ syncStatus: 'no_session', evidence: noEvidence })).toBe('pending')
  })

  it('session-less return upgrades to success when webhook evidence exists for the user', () => {
    expect(
      resolvePostPurchasePhase({ syncStatus: 'no_session', evidence: { subscription: true, tokens: false } }),
    ).toBe('success')
    expect(
      resolvePostPurchasePhase({ syncStatus: 'no_session', evidence: { subscription: false, tokens: true } }),
    ).toBe('success')
  })

  it('a session still awaiting its webhook is pending', () => {
    expect(resolvePostPurchasePhase({ syncStatus: 'pending', evidence: noEvidence })).toBe('pending')
  })
})
