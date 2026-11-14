/**
 * /pricing's account layer (Plans board, 2026-11-05): a signed-in viewer sees which plan they are on,
 * its renewal and their tokens, and their card is marked — while the checkout buttons, whose test ids
 * the monetization e2e suite drives, are untouched. A visitor or a failed read sees none of it.
 */
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'

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

import { PricingV4, type PricingPlan } from '@/components/core-app/screens/PricingV4'
import { pricingCardStatus, type PricingAccount } from '@/lib/core-app/pricingAccount'

afterEach(() => cleanup())

const plan = (planFamily: string, name: string, price: number): PricingPlan => ({
  planFamily, name, description: `${name} description`,
  monthlySku: `${planFamily}_monthly`, monthlyPrice: price, yearlySku: null, yearlyPrice: null, savings: null,
})
const PLANS = [plan('af_pro', 'AF Pro', 9.99), plan('af_commissioner', 'AF Commissioner', 4.99), plan('af_supreme', 'AF Supreme', 14.99)]

const cardOf = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name} Monthly$`) }).closest('section') as HTMLElement

describe('pricingCardStatus', () => {
  it('marks the held plan, the lanes Supreme includes, and Free only for a planless viewer', () => {
    const supreme: PricingAccount = { planIds: ['supreme'], planName: 'AF Supreme', renewsAt: null, tokenBalance: null }
    expect(pricingCardStatus('af_supreme', supreme)).toBe('yours')
    expect(pricingCardStatus('af_pro', supreme)).toBe('included')
    expect(pricingCardStatus('af_commissioner', supreme)).toBe('included')
    expect(pricingCardStatus('free', supreme)).toBeNull()
    const free: PricingAccount = { planIds: [], planName: null, renewsAt: null, tokenBalance: 3 }
    expect(pricingCardStatus('free', free)).toBe('yours')
    expect(pricingCardStatus('af_pro', free)).toBeNull()
    expect(pricingCardStatus('af_pro', null)).toBeNull()
  })
})

describe('PricingV4 account layer', () => {
  it('names the plan, its renewal and tokens, marks the card, and leaves its checkout button alone', () => {
    const account: PricingAccount = { planIds: ['commissioner'], planName: 'AF Commissioner', renewsAt: '2026-12-14T12:00:00.000Z', tokenBalance: 120 }
    render(<PricingV4 plans={PLANS} packs={[]} savingsHeadline={null} signedIn account={account} />)
    const banner = screen.getByTestId('pricing-account')
    expect(within(banner).getByText('You’re on AF Commissioner')).toBeTruthy()
    expect(within(banner).getByText(/Renews Dec 14, 2026 · 120 tokens left/)).toBeTruthy()
    expect(within(banner).getByRole('link', { name: 'Manage billing' }).getAttribute('href')).toBe('/settings?tab=billing')

    expect(within(cardOf('AF Commissioner')).getByText('Your plan')).toBeTruthy()
    expect(within(cardOf('AF Pro')).queryByText('Your plan')).toBeNull()
    const cta = screen.getByTestId('pricing-subscription-cta-af_commissioner_monthly') as HTMLButtonElement
    expect(cta.disabled).toBe(false)
  })

  it('a free viewer is told so, has no billing to manage, and the Free card is theirs', () => {
    render(<PricingV4 plans={PLANS} packs={[]} savingsHeadline={null} signedIn account={{ planIds: [], planName: null, renewsAt: null, tokenBalance: 5 }} />)
    const banner = screen.getByTestId('pricing-account')
    expect(within(banner).getByText('You’re on the free plan')).toBeTruthy()
    expect(within(banner).queryByRole('link', { name: 'Manage billing' })).toBeNull()
    expect(within(screen.getByRole('heading', { name: 'Free' }).closest('section') as HTMLElement).getByText('Your plan')).toBeTruthy()
  })

  it('a Supreme holder sees Pro and Commissioner as included', () => {
    render(<PricingV4 plans={PLANS} packs={[]} savingsHeadline={null} signedIn account={{ planIds: ['supreme'], planName: 'AF Supreme', renewsAt: null, tokenBalance: null }} />)
    expect(within(cardOf('AF Pro')).getByText('Included in AF Supreme')).toBeTruthy()
    expect(within(cardOf('AF Supreme')).getByText('Your plan')).toBeTruthy()
  })

  it('a visitor (no account) gets no banner and no plan chips', () => {
    render(<PricingV4 plans={PLANS} packs={[]} savingsHeadline={null} />)
    expect(screen.queryByTestId('pricing-account')).toBeNull()
    expect(screen.queryByText('Your plan')).toBeNull()
  })
})

describe('PricingV4 phone header', () => {
  it('a visitor gets Sign in and Start free outside the menu, and the menu reaches home, commissioners and the demo', () => {
    const { container } = render(<PricingV4 plans={PLANS} packs={[]} savingsHeadline={null} />)
    const bar = container.querySelector('.af-pr-mobile-actions') as HTMLElement
    const signIn = within(bar).getByTestId('pricing-mobile-sign-in')
    const primary = within(bar).getByTestId('pricing-mobile-primary')
    expect(signIn.getAttribute('href')).toBe('/login')
    expect(primary.getAttribute('href')).toBe('/signup')
    expect(primary.textContent).toBe('Start free')
    expect(signIn.closest('details')).toBeNull()
    expect(primary.closest('details')).toBeNull()
    const menu = [...bar.querySelectorAll('details a')].map((a) => a.getAttribute('href'))
    expect(menu).toEqual(['/', '/commissioners', '/demo'])
  })

  it('a signed-in viewer gets Back to app and no Sign in', () => {
    const { container } = render(<PricingV4 plans={PLANS} packs={[]} savingsHeadline={null} signedIn />)
    const bar = container.querySelector('.af-pr-mobile-actions') as HTMLElement
    expect(within(bar).getByTestId('pricing-mobile-primary').getAttribute('href')).toBe('/core')
    expect(within(bar).queryByTestId('pricing-mobile-sign-in')).toBeNull()
    expect(container.querySelector('a[href="/login"]')).toBeNull()
  })
})
