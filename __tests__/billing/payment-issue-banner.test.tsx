import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

/* The "your payment didn't go through" banner (lib/billing/retention.ts), rendered for real. */

const ent = vi.hoisted(() => ({ value: { entitlement: null as unknown, isAdminBypassAccount: false } }))
vi.mock('@/hooks/useEntitlement', () => ({ useEntitlement: () => ent.value }))

import { PaymentIssueBanner } from '@/components/billing/PaymentIssueBanner'

const withStatus = (status: string, gracePeriodEnd: string | null = '2026-11-22T17:00:00Z') => ({
  entitlement: { plans: ['pro'], status, currentPeriodEnd: null, gracePeriodEnd, message: '' },
  isAdminBypassAccount: false,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  try { sessionStorage.clear() } catch { /* */ }
})

describe('PaymentIssueBanner', () => {
  it('shows while the plan is in grace, with the date access ends and a 44px card link', () => {
    ent.value = withStatus('grace')
    render(<PaymentIssueBanner />)
    expect(screen.getByTestId('payment-issue-banner').textContent).toContain('Access stays on until Nov 22')
    expect(screen.getByTestId('payment-issue-update-card').getAttribute('href')).toBe('/api/subscription/billing-portal')
  })

  it('says nothing for an active plan, no plan, or the dev-admin grant', () => {
    for (const v of [withStatus('active'), withStatus('none'), { ...withStatus('grace'), isAdminBypassAccount: true }]) {
      ent.value = v
      const { container } = render(<PaymentIssueBanner />)
      expect(container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('🛑 never in the iOS app (App Store 3.1.1)', () => {
    ent.value = withStatus('past_due')
    vi.stubGlobal('navigator', { ...navigator, userAgent: `${navigator.userAgent} AllFantasyiOS` })
    const { container } = render(<PaymentIssueBanner />)
    expect(container.innerHTML).toBe('')
  })
})
