import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

/*
 * Settings › Billing inside the iOS app (2026-10-03): "Manage" opens Apple's own subscription sheet
 * through the StoreKit bridge, never the Stripe portal link. On the web nothing changes.
 */

const h = vi.hoisted(() => ({ appleApp: false, manage: vi.fn(async () => undefined) }))

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
vi.mock('@/hooks/useEntitlements', () => ({
  useEntitlements: () => ({
    loading: false,
    error: null,
    hasAnyPaid: true,
    hasSupreme: true,
    isAdminBypassAccount: false,
    snapshot: { status: 'active', currentPeriodEnd: null },
  }),
}))
vi.mock('@/components/tokens/TokenBalanceWidget', () => ({ TokenBalanceWidget: () => null }))
vi.mock('@/lib/monetization/apple-iap-client', () => ({
  isAppleApp: () => h.appleApp,
  manageAppleSubscriptions: h.manage,
}))
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { BillingSettingsSection } from '@/app/settings/components/sections/BillingSettingsSection'

beforeEach(() => {
  h.appleApp = false
  h.manage.mockReset()
  h.manage.mockImplementation(async () => undefined)
})
afterEach(() => cleanup())

describe('Billing › manage subscription', () => {
  it('on the web: the Stripe portal link, and no App Store button', () => {
    render(<BillingSettingsSection />)
    expect(screen.getByTestId('settings-billing-manage').getAttribute('href')).toBe('/api/subscription/billing-portal')
    expect(screen.queryByTestId('settings-billing-manage-apple')).toBeNull()
  })

  it("in the iOS app: Apple's subscription sheet, and no Stripe link", async () => {
    h.appleApp = true
    render(<BillingSettingsSection />)
    const btn = await screen.findByTestId('settings-billing-manage-apple')
    expect(screen.queryByTestId('settings-billing-manage')).toBeNull()
    fireEvent.click(btn)
    expect(h.manage).toHaveBeenCalledTimes(1)
  })

  it('says where to go when the sheet cannot open', async () => {
    h.appleApp = true
    h.manage.mockImplementation(async () => {
      throw new Error('bridge missing')
    })
    render(<BillingSettingsSection />)
    fireEvent.click(await screen.findByTestId('settings-billing-manage-apple'))
    expect((await screen.findByTestId('settings-billing-apple-error')).textContent).toMatch(/Subscriptions/)
  })
})
