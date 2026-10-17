import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/*
 * When Stripe cannot open a portal session, /api/subscription/billing-portal redirects to
 * /settings?tab=billing&billing=portal_error — and the Billing tab must then SAY so, or the user
 * lands back where they started with no idea the click failed.
 */

const params = vi.hoisted(() => ({ value: new URLSearchParams() }))

vi.mock('next/navigation', () => ({ useSearchParams: () => params.value }))
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
vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

import { BillingSettingsSection } from '@/app/settings/components/sections/BillingSettingsSection'

afterEach(() => cleanup())

describe('Billing tab after a failed portal open', () => {
  it('explains the failure when the route redirected here with billing=portal_error', () => {
    params.value = new URLSearchParams('tab=billing&billing=portal_error')
    render(<BillingSettingsSection />)
    expect(screen.getByTestId('settings-billing-portal-error').textContent).toMatch(/couldn.t open the billing portal/i)
    // The way back in is still offered.
    expect(screen.getByTestId('settings-billing-manage').getAttribute('href')).toBe('/api/subscription/billing-portal')
  })

  it('shows nothing extra on a normal visit', () => {
    params.value = new URLSearchParams('tab=billing')
    render(<BillingSettingsSection />)
    expect(screen.queryByTestId('settings-billing-portal-error')).toBeNull()
  })
})
