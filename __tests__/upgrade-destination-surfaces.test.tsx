import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * The pages behind every upgrade link (lib/monetization/upgradeDestination.ts):
 * /pricing forwards a plan link to that plan's checkout, /upgrade reads every
 * spelling of a plan, the AF Legacy page can finally take a payment, the tournament
 * and survivor locks stop sending buyers to /settings, and a checkout started on a
 * focused plan comes back to that plan.
 */

const nav = vi.hoisted(() => ({
  search: new URLSearchParams(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`)
  }),
}))
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.search,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/upgrade',
  redirect: nav.redirect,
}))

const checkout = vi.hoisted(() => vi.fn(async (_req: unknown) => ({ ok: false as const, error: 'stopped in test' })))
vi.mock('@/lib/monetization/checkout-client', () => ({ resolveCheckoutUrl: checkout }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, isSyncing: false, retrySync: vi.fn() }),
}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({
  useGeoRestriction: () => ({ isPaidBlocked: false, loading: false, stateName: null, stateCode: null }),
}))
vi.mock('@/components/tokens/TokenBalanceWidget', () => ({ TokenBalanceWidget: () => null }))

import PricingPage from '@/app/pricing/page'
import UpgradePage from '@/app/upgrade/page'
import WarRoomPage from '@/app/war-room/page'
import { PremiumFeatureLock } from '@/components/tournament/PremiumFeatureLock'
import { SurvivorPremiumCommandCenterPanel } from '@/components/survivor/SurvivorPremiumCommandCenterPanel'
import { getMonetizationCatalog, getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'
import { upgradePathForPlan } from '@/lib/monetization/upgradeDestination'
import { SURVIVOR_PREMIUM_COMMAND_TILES } from '@/lib/survivor/survivor-premium-access'

function usd(sku: Parameters<typeof getMonetizationCatalogItemBySku>[0]): string {
  const amount = getMonetizationCatalogItemBySku(sku)?.amountUsd
  if (amount == null) throw new Error(`catalog has no ${sku}`)
  return `$${amount.toFixed(2)}`
}

beforeEach(() => {
  nav.search = new URLSearchParams()
  nav.redirect.mockClear()
  checkout.mockClear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/pricing', () => {
  it('🛑 a link naming a plan is sent to that plan’s checkout', () => {
    expect(() => PricingPage({ searchParams: { plan: 'af-commissioner', feature: 'commissioner-waiver-ai' } })).toThrow(
      'NEXT_REDIRECT /upgrade?plan=commissioner&feature=commissioner-waiver-ai',
    )
    expect(() => PricingPage({ searchParams: { highlight: 'af-pro', intent: 'world-cup' } })).toThrow(
      'NEXT_REDIRECT /upgrade?plan=pro&highlight=af-pro&intent=world-cup',
    )
  })

  it('a bare /pricing, or one with no plan in it, is still the grid', () => {
    for (const searchParams of [undefined, {}, { from: 'wc-chimmy' }, { msg: 'no_subscription' }, { checkout: 'success' }]) {
      const el = PricingPage({ searchParams })
      expect(el).toBeTruthy()
    }
    expect(nav.redirect).not.toHaveBeenCalled()
  })
})

describe('/upgrade', () => {
  it('reads the hyphenated spellings the World Cup and waiver locks use', () => {
    expect(UpgradePage({ searchParams: { plan: 'af-pro' } }).props.focusPlanFamily).toBe('af_pro')
    expect(UpgradePage({ searchParams: { plan: 'af-commissioner' } }).props.focusPlanFamily).toBe('af_commissioner')
    expect(UpgradePage({ searchParams: { plan: 'war_room' } }).props.focusPlanFamily).toBe('af_war_room')
    expect(UpgradePage({ searchParams: { plan: ['supreme'] } }).props.focusPlanFamily).toBe('af_supreme')
    expect(UpgradePage({}).props.focusPlanFamily).toBeNull()
  })

  it('🛑 a checkout started on a focused plan comes back to that plan, not to the bare page', async () => {
    const subs = getMonetizationCatalog().subscriptions.map((s) => ({ ...s, stripePriceConfigured: true }))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const body = String(input).includes('/api/monetization/catalog')
          ? {
              catalog: { subscriptions: subs, tokenPacks: [], all: subs },
              fancredBoundary: { version: 't', short: '', long: '', checklist: [] },
            }
          : {}
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
      }),
    )
    try {
      window.sessionStorage.clear()
    } catch {}
    nav.search = new URLSearchParams('plan=war_room&feature=draft_prep&checkout=cancelled')

    render(UpgradePage({ searchParams: { plan: 'war_room' } }))

    const cta = await screen.findByTestId('pricing-subscription-cta-af_war_room_monthly')
    // The plan the link named is the first card.
    expect(screen.getAllByTestId(/^pricing-plan-card-/)[0]!.getAttribute('data-testid')).toBe('pricing-plan-card-af_war_room')

    fireEvent.click(cta)
    await waitFor(() => expect(checkout).toHaveBeenCalledTimes(1))
    expect(checkout.mock.calls[0]![0]).toMatchObject({
      sku: 'af_war_room_monthly',
      returnPath: '/upgrade?plan=war_room&feature=draft_prep',
    })
  })
})

describe('/war-room (the AF Legacy page)', () => {
  it('🛑 can take a payment: a buy button to AF Legacy checkout, at the catalog’s prices', () => {
    render(<WarRoomPage />)
    const buy = screen.getByTestId('war-room-get-legacy')
    expect(buy.getAttribute('href')).toBe('/upgrade?plan=war_room&from=war-room-page')
    expect(screen.getByTestId('war-room-hero-get-legacy').getAttribute('href')).toBe(buy.getAttribute('href'))

    const section = screen.getByTestId('war-room-buy-section')
    expect(section.textContent).toContain(usd('af_war_room_monthly'))
    expect(section.textContent).toContain(usd('af_war_room_yearly'))
    // Sold as AF Legacy, never as "war room".
    expect(section.textContent).not.toMatch(/war[ _-]?room/i)
  })
})

describe('locks that used to send buyers to /settings', () => {
  it('the tournament lock goes to the checkout for the plan it names', () => {
    render(<PremiumFeatureLock requiredPlan="af_commissioner" featureLabel="Commissioner automation suite" />)
    expect(screen.getByRole('link', { name: 'View plans' }).getAttribute('href')).toBe('/upgrade?plan=commissioner')
  })

  it('every locked survivor tile goes to the checkout for its own plan', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })))
    render(<SurvivorPremiumCommandCenterPanel leagueId="lg-1" plan={null} tokensRemaining={null} />)
    const hrefs = screen.getAllByRole('link', { name: 'Upgrade' }).map((a) => a.getAttribute('href'))
    const expected = SURVIVOR_PREMIUM_COMMAND_TILES.map((t) => upgradePathForPlan(t.requiredPlan))
    expect(hrefs).toEqual(expected)
    expect(new Set(hrefs).size).toBeGreaterThan(1)
  })
})
