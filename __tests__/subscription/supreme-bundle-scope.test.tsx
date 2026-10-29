import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useEntitlements } from '@/hooks/useEntitlements'
import { hasFeatureAccessForPlans } from '@/lib/subscription/feature-access'
import { listPremiumFeatureMonetizationMatrix } from '@/lib/monetization/feature-monetization-matrix'
import { ENTITLEMENTS } from '@/lib/monetization/entitlements'
import { resolveTokenChargeDecisionForEntitlement } from '@/lib/tokens/subscription-policy'
import { buildDevAdminEntitlementSnapshot } from '@/lib/dev-admin/access'

afterEach(() => vi.unstubAllGlobals())

describe('Supreme advertised bundle', () => {
  it('includes Pro and Commissioner features while Legacy remains explicit', () => {
    const entries = listPremiumFeatureMonetizationMatrix()
      .filter(e => ['pro', 'commissioner', 'war_room'].includes(e.requiredPlanId))
    expect(entries.some(e => e.requiredPlanId === 'war_room')).toBe(true)
    for (const entry of entries) {
      expect(hasFeatureAccessForPlans(['supreme'], 'active', entry.key), entry.key)
        .toBe(entry.requiredPlanId !== 'war_room')
      expect(hasFeatureAccessForPlans(['supreme', 'war_room'], 'active', entry.key), entry.key).toBe(true)
    }
  })

  it('does not grant catalog-only Legacy features through an explicit Supreme entry', () => {
    const entries = Object.values(ENTITLEMENTS).filter(e => e.key.startsWith('war_room_'))
    expect(entries).toHaveLength(4)
    for (const entry of entries) {
      expect(entry.requiredPlan, entry.key).toEqual(['af_war_room'])
      expect(hasFeatureAccessForPlans(['supreme'], 'active', entry.key), entry.key).toBe(false)
      expect(hasFeatureAccessForPlans(['war_room'], 'active', entry.key), entry.key).toBe(true)
    }
  })

  it('keeps Legacy subscription eligibility separate in token pricing', () => {
    const entitlement = { plans: ['supreme' as const], status: 'active' as const,
      currentPeriodEnd: null, gracePeriodEnd: null }
    expect(resolveTokenChargeDecisionForEntitlement({ entitlement,
      ruleCode: 'ai_war_room_multi_step_planning', baseTokenCost: 200 }).subscriptionEligible).toBe(false)
    expect(resolveTokenChargeDecisionForEntitlement({ entitlement: { ...entitlement, plans: ['supreme', 'war_room'] },
      ruleCode: 'ai_war_room_multi_step_planning', baseTokenCost: 200 }).subscriptionEligible).toBe(true)
  })

  it('preserves owner/admin access through explicit plan grants', () => {
    const snapshot = buildDevAdminEntitlementSnapshot()
    expect(hasFeatureAccessForPlans(snapshot.plans, snapshot.status, 'draft_strategy_build')).toBe(true)
    expect(hasFeatureAccessForPlans(snapshot.plans, snapshot.status, 'commissioner_automation')).toBe(true)
    expect(snapshot.plans).toContain('war_room')
  })

  it.each([false, true])('client Legacy flag follows the explicit plan (present=%s)', async (legacy) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ entitlement: {
      plans: legacy ? ['supreme', 'war_room'] : ['supreme'], status: 'active',
      currentPeriodEnd: null, gracePeriodEnd: null,
    } }) }))
    const hook = renderHook(() => useEntitlements())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    expect(hook.result.current.hasPro).toBe(true)
    expect(hook.result.current.hasCommissioner).toBe(true)
    expect(hook.result.current.hasWarRoom).toBe(legacy)
    hook.unmount()
  })
})
