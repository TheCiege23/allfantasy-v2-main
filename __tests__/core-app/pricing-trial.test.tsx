/**
 * The AF Pro free trial on /pricing (2026-11-15): offered on the AF Pro card to an account the server
 * says is eligible, with its terms said before the click — and never in a store build.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

const native = vi.hoisted(() => ({ nativeApp: false }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/pricing',
  redirect: vi.fn(),
}))
vi.mock('@/lib/monetization/checkout-client', () => ({ resolveCheckoutUrl: vi.fn(async () => ({ ok: false as const, error: 'stopped in test' })) }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, isSyncing: false, retrySync: vi.fn() }),
}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({
  useGeoRestriction: () => ({ isPaidBlocked: false, loading: false, stateName: null, stateCode: null }),
}))
vi.mock('@/components/tokens/TokenBalanceWidget', () => ({ TokenBalanceWidget: () => null }))
vi.mock('@/lib/monetization/native-iap-client', async (orig) => ({
  ...(await orig<typeof import('@/lib/monetization/native-iap-client')>()),
  useNativeIapPrices: () => ({ nativeApp: native.nativeApp, prices: {}, needsUpdate: false, playApp: false, error: null }),
}))

import { PricingV4, type PricingPlan } from '@/components/core-app/screens/PricingV4'

const plan = (planFamily: string, name: string, monthly: number, yearly: number): PricingPlan => ({
  planFamily,
  name,
  description: `${name} description`,
  monthlySku: `${planFamily}_monthly`,
  monthlyPrice: monthly,
  yearlySku: `${planFamily}_yearly`,
  yearlyPrice: yearly,
  savings: null,
})
const PLANS = [plan('af_pro', 'AF Pro', 9.99, 79.99), plan('af_commissioner', 'AF Commissioner', 14.99, 129.99)]

const eligibility = (body: unknown) => {
  const f = vi.fn(async () => ({ ok: true, json: async () => body }))
  vi.stubGlobal('fetch', f)
  return f
}

beforeEach(() => {
  native.nativeApp = false
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/pricing — the AF Pro free trial', () => {
  it('an eligible account is offered the trial on AF Pro only, with its terms', async () => {
    eligibility({ days: 7, skus: ['af_pro_monthly', 'af_pro_yearly'], eligible: true })
    render(<PricingV4 plans={PLANS} packs={[]} signedIn />)
    await waitFor(() => expect(screen.getByTestId('pricing-subscription-cta-af_pro_monthly').textContent).toBe('Start your 7-day free trial'))
    expect(screen.getByTestId('pricing-trial-af_pro_monthly').textContent).toBe(
      'Free for 7 days, then $9.99 a month. Cancel before the trial ends and you won’t be charged.',
    )
    expect(screen.getByTestId('pricing-subscription-cta-af_commissioner_monthly').textContent).toBe('Choose AF Commissioner')
    expect(screen.queryByTestId('pricing-trial-af_commissioner_monthly')).toBeNull()
  })

  it('signed out: the button is unchanged and the card says new members get the trial', async () => {
    eligibility({ days: 7, skus: ['af_pro_monthly', 'af_pro_yearly'], eligible: null })
    render(<PricingV4 plans={PLANS} packs={[]} />)
    await waitFor(() => expect(screen.getByTestId('pricing-trial-af_pro_monthly').textContent).toBe('New members get 7 days free.'))
    expect(screen.getByTestId('pricing-subscription-cta-af_pro_monthly').textContent).toBe('Choose AF Pro')
  })

  it('not eligible: nothing is said', async () => {
    const f = eligibility({ days: 0, skus: [], eligible: false })
    render(<PricingV4 plans={PLANS} packs={[]} signedIn />)
    await waitFor(() => expect(f).toHaveBeenCalled())
    expect(screen.queryByTestId('pricing-trial-af_pro_monthly')).toBeNull()
    expect(screen.getByTestId('pricing-subscription-cta-af_pro_monthly').textContent).toBe('Choose AF Pro')
  })

  it('🛑 a store build never asks and never shows it', async () => {
    native.nativeApp = true
    const f = eligibility({ days: 7, skus: ['af_pro_monthly'], eligible: true })
    render(<PricingV4 plans={PLANS} packs={[]} signedIn />)
    await new Promise((r) => setTimeout(r, 20))
    expect(f.mock.calls.some((c) => String(c[0]).includes('trial-eligibility'))).toBe(false)
    expect(screen.queryByTestId('pricing-trial-af_pro_monthly')).toBeNull()
  })
})
