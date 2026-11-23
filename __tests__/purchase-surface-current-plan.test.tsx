import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * 2026-11-23: /pro, /upgrade, /commissioner-upgrade and /all-access (MonetizationPurchaseSurface) sold a
 * plan to the person already paying for it — an App Store AF Pro purchase reloaded /pro still reading
 * "Subscribe in app". The exact SKU held now reads "Current plan"; the lanes AF Supreme bundles read
 * "Included in your AF Supreme"; everything else stays buyable.
 */

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/upgrade',
  redirect: vi.fn(),
}))
vi.mock('@/lib/monetization/checkout-client', () => ({ resolveCheckoutUrl: vi.fn() }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({
  usePostPurchaseSync: () => ({ state: { phase: 'idle', message: '' }, isSyncing: false, retrySync: vi.fn() }),
}))
vi.mock('@/lib/geo/useGeoRestriction', () => ({
  useGeoRestriction: () => ({ isPaidBlocked: false, loading: false, stateName: null, stateCode: null }),
}))
vi.mock('@/components/tokens/TokenBalanceWidget', () => ({ TokenBalanceWidget: () => null }))

const ents = { heldSkus: [] as string[], hasSupreme: false }
vi.mock('@/hooks/useEntitlements', () => ({ useEntitlements: () => ents }))

import MonetizationPurchaseSurface from '@/components/monetization/MonetizationPurchaseSurface'
import { GET as catalogGET } from '@/app/api/monetization/catalog/route'

beforeEach(async () => {
  const body = await (await catalogGET()).text()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))
  try { window.sessionStorage.clear(); window.localStorage.clear() } catch {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  ents.heldSkus = []
  ents.hasSupreme = false
})

const renderSurface = () => render(<MonetizationPurchaseSurface pagePath="/upgrade" title="t" subtitle="s" />)

describe('MonetizationPurchaseSurface — plans the viewer already holds', () => {
  it('shows "Current plan" on the exact SKU held and keeps the other interval and plans buyable', async () => {
    ents.heldSkus = ['af_pro_monthly']
    renderSurface()
    expect((await screen.findByTestId('pricing-current-af_pro_monthly')).textContent).toContain('Current plan')
    expect(screen.queryByTestId('pricing-subscription-cta-af_pro_monthly')).toBeNull()
    expect(screen.getByTestId('pricing-subscription-cta-af_pro_yearly')).toBeTruthy()
    expect(screen.getByTestId('pricing-subscription-cta-af_commissioner_monthly')).toBeTruthy()
  })

  it('marks AF Pro and AF Commissioner as included for an AF Supreme holder', async () => {
    ents.heldSkus = ['af_supreme_monthly']
    ents.hasSupreme = true
    renderSurface()
    expect((await screen.findByTestId('pricing-current-af_supreme_monthly')).textContent).toContain('Current plan')
    expect(screen.getByTestId('pricing-included-af_pro_monthly').textContent).toContain('Included in your AF Supreme')
    expect(screen.getByTestId('pricing-included-af_commissioner_yearly')).toBeTruthy()
    expect(screen.queryByTestId('pricing-subscription-cta-af_pro_monthly')).toBeNull()
  })

  it('sells everything to a viewer with no plan', async () => {
    renderSurface()
    expect(await screen.findByTestId('pricing-subscription-cta-af_pro_monthly')).toBeTruthy()
    expect(screen.queryByText('Current plan')).toBeNull()
  })
})
