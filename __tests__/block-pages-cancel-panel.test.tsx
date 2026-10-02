import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * Both block pages offer a subscriber the cancel button (owner's calls, 2026-10-02): the billing
 * portal is refused there, so without it a subscriber in a restricted or fully blocked state had no
 * way to stop being charged. A visitor with no live subscription sees nothing extra.
 */

const subs = vi.hoisted(() => ({ value: { hasStripe: false, hasApple: false } }))
vi.mock('@/lib/account/liveSubscriptions', () => ({ liveSubscriptions: async () => subs.value }))

import GeoBlockedPage from '@/app/geo-blocked/page'
import PaidRestrictedPage from '@/app/paid-restricted/page'

afterEach(() => cleanup())

const PAGES = [
  ['/geo-blocked (fully blocked state)', () => GeoBlockedPage({ searchParams: Promise.resolve({ state: 'WA' }) })],
  ['/geo-blocked (locked account)', () => GeoBlockedPage({ searchParams: Promise.resolve({ reason: 'account' }) })],
  ['/paid-restricted (paid-block state)', () => PaidRestrictedPage({ searchParams: Promise.resolve({ state: 'NV' }) })],
  ['/paid-restricted (card lock)', () => PaidRestrictedPage({ searchParams: Promise.resolve({ reason: 'billing' }) })],
] as const

describe('the cancel button on the block pages', () => {
  for (const [name, page] of PAGES) {
    it(`${name}: a Stripe subscriber can cancel`, async () => {
      subs.value = { hasStripe: true, hasApple: false }
      render(await page())
      expect(screen.getByTestId('paid-restricted-cancel-start')).toBeTruthy()
    })

    it(`${name}: no subscription, no panel`, async () => {
      subs.value = { hasStripe: false, hasApple: false }
      render(await page())
      expect(screen.queryByTestId('paid-restricted-cancel')).toBeNull()
    })
  }

  it('an App Store subscriber is told where to cancel', async () => {
    subs.value = { hasStripe: false, hasApple: true }
    render(await GeoBlockedPage({ searchParams: Promise.resolve({ state: 'WA' }) }))
    expect(screen.getByTestId('paid-restricted-cancel-apple').textContent).toMatch(/iPhone Settings/)
  })
})
