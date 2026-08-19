/**
 * AF_GATE0 §3.4 / §6 — the unified entitlement gate returns "free" for trial/free users on
 * free features and a LOCKED result for paid features. Derives a real paid feature from the
 * live monetization matrix so the test can't drift from the catalog.
 */
import { describe, it, expect } from 'vitest'
import { canAccess } from '@/lib/access/canAccess'
import { listPremiumFeatureMonetizationMatrix } from '@/lib/monetization/feature-monetization-matrix'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

const paidEntry = listPremiumFeatureMonetizationMatrix()[0]

describe('canAccess — the single AF_GATE0 entitlement seam', () => {
  it('treats a feature with no required plan as free for a guest/trial visitor', () => {
    const result = canAccess('__nonexistent_free_feature__' as SubscriptionFeatureId, {
      isAuthenticated: false,
    })
    expect(result.allowed).toBe(true)
    expect(result.locked).toBe(false)
    expect(result.reason).toBe('free-feature')
    expect(result.tier).toBe('guest')
  })

  it('locks a paid feature for a guest with a "sign up free" CTA (never a dead end)', () => {
    expect(paidEntry).toBeDefined()
    const result = canAccess(paidEntry.key, { isAuthenticated: false, returnTo: '/dashboard/universal' })
    expect(result.allowed).toBe(false)
    expect(result.locked).toBe(true)
    expect(result.tier).toBe('guest')
    expect(result.reason).toBe('requires-signup')
    expect(result.ctaLabel).toBe('Sign up free')
    expect(result.ctaHref).toContain('/signup')
    expect(result.ctaHref).toContain('next=')
    expect(result.requiredPlan).toBe(paidEntry.requiredPlanId)
  })

  it('locks a paid feature for a signed-in FREE user with an upgrade CTA', () => {
    const result = canAccess(paidEntry.key, { isAuthenticated: true, plans: [], status: 'none' })
    expect(result.allowed).toBe(false)
    expect(result.locked).toBe(true)
    expect(result.tier).toBe('free')
    expect(result.reason).toBe('requires-upgrade')
    expect(result.ctaHref).not.toContain('/signup')
  })

  it('allows a paid feature for a user who holds the required plan', () => {
    const result = canAccess(paidEntry.key, {
      isAuthenticated: true,
      plans: [paidEntry.requiredPlanId],
      status: 'active',
    })
    expect(result.allowed).toBe(true)
    expect(result.locked).toBe(false)
    expect(result.reason).toBe('entitled')
    expect(result.tier).toBe('paid')
  })

  it('does not grant a paid feature when the subscription is expired', () => {
    const result = canAccess(paidEntry.key, {
      isAuthenticated: true,
      plans: [paidEntry.requiredPlanId],
      status: 'expired',
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('requires-upgrade')
  })
})
