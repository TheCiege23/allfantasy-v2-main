// @vitest-environment jsdom
/**
 * The Black Friday → Cyber Monday banner and sale prices (lib/monetization/holidaySale.ts).
 * Pins: nothing outside the window; inside it, "50% off your first year" with the regular price
 * struck through beside the half price on /pricing; hidden in the iOS app (data-hide-in-ios-app) and
 * in the Android app (a Trusted Web Activity), which sell at the store's price.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

const twa = vi.hoisted(() => ({ on: false }))
vi.mock('@/lib/platform/isTrustedWebActivity', () => ({ isTrustedWebActivity: () => twa.on }))
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

import { HolidaySaleStrip } from '@/components/launch/HolidaySaleStrip'
import { PricingV4, type PricingPlan } from '@/components/core-app/screens/PricingV4'

const DURING = new Date('2026-11-28T17:00:00.000Z')
const AFTER = new Date('2026-12-01T05:00:01.000Z')

const PLANS: PricingPlan[] = [
  {
    planFamily: 'af_pro', name: 'AF Pro', description: 'AF Pro description',
    monthlySku: 'af_pro_monthly', monthlyPrice: 9.99, yearlySku: 'af_pro_yearly', yearlyPrice: 79.99,
    savings: null,
  },
]

beforeEach(() => {
  process.env.HOLIDAY_SALE_IN_TESTS = '1'
  twa.on = false
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete process.env.HOLIDAY_SALE_IN_TESTS
})

describe('the sale banner', () => {
  it('says 50% off your first year with a countdown and a link to the plans, and hides in the iOS app', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: DURING })
    render(<HolidaySaleStrip surface="landing" />)
    const strip = screen.getByTestId('holiday-sale-landing')
    expect(within(strip).getByText('50% off your first year')).toBeTruthy()
    expect(within(strip).getByText('Black Friday')).toBeTruthy()
    expect(within(strip).getByRole('timer').getAttribute('aria-label')).toBe('2 days, 12 hours and 0 minutes left')
    expect(within(strip).getByRole('link', { name: 'See the deal' }).getAttribute('href')).toBe('/pricing')
    expect(strip.hasAttribute('data-hide-in-ios-app')).toBe(true)
  })

  it('renders nothing after Monday', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: AFTER })
    const { container } = render(<HolidaySaleStrip surface="landing" />)
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing in the Android app', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: DURING })
    twa.on = true
    const { container } = render(<HolidaySaleStrip surface="core" />)
    expect(container.innerHTML).toBe('')
  })
})

describe('/pricing during the sale', () => {
  it('opens on yearly and shows the half price beside the struck-through regular one', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: DURING })
    render(<PricingV4 plans={PLANS} packs={[]} savingsHeadline={null} />)
    expect(screen.getByTestId('holiday-sale-pricing')).toBeTruthy()
    const price = screen.getByTestId('pricing-sale-price-af_pro_yearly')
    expect(price.textContent).toBe('$40$79.99')
    expect(within(price).getByText('$79.99').tagName).toBe('S')
    expect(screen.getByText('50% off your first year, then $79.99/yr')).toBeTruthy()
    // The checkout button, whose test id the monetization e2e suite drives, is untouched.
    expect(screen.getByTestId('pricing-subscription-cta-af_pro_yearly')).toBeTruthy()
  })

  it('shows regular prices and no banner once the sale is over', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: AFTER })
    render(<PricingV4 plans={PLANS} packs={[]} savingsHeadline={null} />)
    expect(screen.queryByTestId('holiday-sale-pricing')).toBeNull()
    expect(screen.queryByTestId('pricing-sale-price-af_pro_monthly')).toBeNull()
    expect(screen.getByRole('heading', { name: 'AF Pro Monthly' })).toBeTruthy()
  })
})
