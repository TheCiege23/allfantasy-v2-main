// @vitest-environment node
/**
 * 🛑 AF SUPREME INCLUDES AF LEGACY (owner's decision 2026-11-27). Every place that derives "what Supreme
 * covers" must agree with SUPREME_INCLUDED_PLAN_IDS, and a Supreme buyer must never hit a Legacy lock —
 * the draft-room AI explanation (`draft_prep`), the War Room, and every /af-legacy tool.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { SUPREME_INCLUDED_PLAN_IDS, hasFeatureAccessForPlans, expandPlansWithBundle } from '@/lib/subscription/feature-access'
import { WAR_ROOM_FEATURES } from '@/lib/subscription/feature-access'
import { ENTITLEMENTS } from '@/lib/monetization/entitlements'
import { SUPREME_BUNDLED_FAMILIES, pickSwitchSources } from '@/lib/monetization/supremeSwitch'
import { duplicatePlanReason } from '@/lib/monetization/stripeCustomerForUser'
import { pricingCardStatus } from '@/lib/core-app/pricingAccount'
import type { SubscriptionFeatureId } from '@/lib/subscription/types'

describe('Supreme = Pro + Commissioner + Legacy, everywhere it is derived', () => {
  it('SUPREME_INCLUDED_PLAN_IDS', () => {
    expect([...SUPREME_INCLUDED_PLAN_IDS].sort()).toEqual(['commissioner', 'pro', 'war_room'])
    expect(expandPlansWithBundle(['supreme']).sort()).toEqual(['commissioner', 'pro', 'supreme', 'war_room'])
  })

  it('the in-place Supreme switch takes a Legacy subscription too', () => {
    expect([...SUPREME_BUNDLED_FAMILIES].sort()).toEqual(['af_commissioner', 'af_pro', 'af_war_room'])
    const picked = pickSwitchSources([{ id: 'r', stripeSubscriptionId: 's', sku: 'af_war_room_monthly', live: true }])
    expect(picked.map((p) => p.family)).toEqual(['af_war_room'])
  })

  it('buying Legacy on top of Supreme is refused as a double charge', () => {
    expect(duplicatePlanReason(new Set(['af_supreme']), 'af_war_room')).toBe('has_supreme')
  })

  it('the pricing page marks the Legacy lane included for a Supreme member', () => {
    expect(pricingCardStatus('af_war_room', { planIds: ['supreme'] } as never)).toBe('included')
  })
})

describe('a Supreme buyer never hits a Legacy lock', () => {
  const legacyKeys: SubscriptionFeatureId[] = [
    ...WAR_ROOM_FEATURES,
    ...(Object.values(ENTITLEMENTS) as Array<{ key: SubscriptionFeatureId; requiredPlan: string[] }>)
      .filter((e) => e.requiredPlan.includes('af_war_room'))
      .map((e) => e.key),
  ]

  it('covers the named ones (draft_prep, the War Room keys)', () => {
    for (const k of ['draft_prep', 'draft_strategy_build', 'war_room_dynasty_projections', 'war_room_draft_strategy', 'legacy_trade_hub'] as const) {
      expect(legacyKeys).toContain(k)
    }
    expect(legacyKeys.length).toBeGreaterThan(15)
  })

  it('every AF Legacy key opens for Supreme', () => {
    const locked = legacyKeys.filter((k) => !hasFeatureAccessForPlans(['supreme'], 'active', k))
    expect(locked).toEqual([])
  })

  it('[control] and still not for Pro or Commissioner alone', () => {
    expect(hasFeatureAccessForPlans(['pro'], 'active', 'draft_prep')).toBe(false)
    expect(hasFeatureAccessForPlans(['commissioner'], 'active', 'draft_prep')).toBe(false)
  })
})
