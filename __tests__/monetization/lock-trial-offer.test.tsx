// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Try AF Pro free for 7 days" on the lock cards (2026-11-24). The server's eligibility answer is the
 * only rule; the lock says it only to an eligible viewer, only for the plan the trial covers, with the
 * catalog price after — and never in an iOS app build (App Store 3.1.1 / 3.1.3) or the Play TWA.
 */

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('@/lib/gtag', () => ({ gtagEvent: vi.fn() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }))
const ctx = vi.hoisted(() => ({ requiredPlan: 'AF Pro', hasAccess: false }))
vi.mock('@/hooks/useMonetizationContext', () => ({
  useMonetizationContext: () => ({
    loading: false,
    error: null,
    entitlement: { plans: [], status: 'none' },
    feature: { featureId: 'trade_analyzer', hasAccess: ctx.hasAccess, requiredPlan: ctx.requiredPlan, upgradePath: '/upgrade?plan=pro', message: null },
    tokenBalance: null,
    previewsByRuleCode: new Map(),
    refetch: async () => undefined,
  }),
}))

import { InContextMonetizationCard } from '@/components/monetization/InContextMonetizationCard'
import { LockedFeatureCard } from '@/components/subscription/LockedFeatureCard'
import { CoreDepthLock } from '@/components/core-app/CoreDepthLock'
import { AfAdpLockedHeader } from '@/components/app/draft-room/afAdpLock'
import { lockTrialCopy, lockTrialSku } from '@/lib/monetization/lockTrialOffer'
import { resetLockTrialOfferCache } from '@/lib/monetization/useLockTrialOffer'
import type { CoreDepthAccess } from '@/lib/core-app/coreDepthAccess'

const ELIGIBLE = { days: 7, skus: ['af_pro_monthly', 'af_pro_yearly'], eligible: true }
const SUBSCRIBED_BEFORE = { days: 0, skus: [], eligible: false }
const SIGNED_OUT = { days: 7, skus: ['af_pro_monthly', 'af_pro_yearly'], eligible: null }

const eligibility = (body: unknown) => {
  const f = vi.fn(async (_url: string) => ({ ok: true, json: async () => body }))
  vi.stubGlobal('fetch', f)
  return f
}
const askedEligibility = (f: ReturnType<typeof eligibility>) =>
  f.mock.calls.filter((c) => String(c[0]).includes('trial-eligibility')).length

const realUA = navigator.userAgent
const setUA = (ua: string) => Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })

const proAccess = {
  depth: 'trade_depth',
  label: 'Full trade breakdowns',
  planName: 'AF Pro',
  upgradePath: '/upgrade?plan=pro',
  unlocked: false,
  preLaunchFree: false,
  startsAt: '2026-10-15T00:00:00Z',
} as unknown as CoreDepthAccess

beforeEach(() => {
  resetLockTrialOfferCache()
  setUA(realUA)
  document.documentElement.removeAttribute('data-ios-app')
  window.history.replaceState(null, '', '/core/trade')
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  setUA(realUA)
})

describe('which lock the trial applies to (pure)', () => {
  it('AF Pro, in any spelling, maps to the monthly SKU the lock link sells; other plans to nothing', () => {
    expect(lockTrialSku('AF Pro')).toBe('af_pro_monthly')
    expect(lockTrialSku('pro')).toBe('af_pro_monthly')
    expect(lockTrialSku('af_pro_yearly')).toBe('af_pro_yearly')
    expect(lockTrialSku('AF Commissioner')).toBeNull()
    expect(lockTrialSku('AF Supreme')).toBeNull()
    expect(lockTrialSku(null)).toBeNull()
  })
  it('only `eligible: true` gets words; the price is the catalog price', () => {
    expect(lockTrialCopy(ELIGIBLE, 'AF Pro')).toEqual({ cta: 'Try AF Pro free for 7 days', then: 'Then $9.99/mo, cancel anytime' })
    expect(lockTrialCopy(ELIGIBLE, 'AF Pro', 'es')).toEqual({
      cta: 'Prueba AF Pro gratis durante 7 días',
      then: 'Después $9.99/mes, cancela cuando quieras',
    })
    expect(lockTrialCopy(SIGNED_OUT, 'AF Pro')).toBeNull()
    expect(lockTrialCopy(SUBSCRIBED_BEFORE, 'AF Pro')).toBeNull()
    expect(lockTrialCopy(ELIGIBLE, 'AF Commissioner')).toBeNull()
  })
})

describe('the /core depth lock', () => {
  it('eligible: the button offers the trial and the price after is said under it', async () => {
    eligibility(ELIGIBLE)
    render(<CoreDepthLock access={proAccess} />)
    await waitFor(() => expect(screen.getByRole('link').textContent).toBe('Try AF Pro free for 7 days'))
    expect(screen.getByTestId('core-lock-trial-then').textContent).toBe('Then $9.99/mo, cancel anytime')
    // Same destination as before: the trial is decided at checkout, not by the link.
    expect(screen.getByRole('link').getAttribute('href')).toContain('/upgrade?plan=pro')
  })

  it('Spanish lock: Spanish trial words', async () => {
    eligibility(ELIGIBLE)
    render(<CoreDepthLock access={proAccess} lang="es" />)
    await waitFor(() => expect(screen.getByRole('link').textContent).toBe('Prueba AF Pro gratis durante 7 días'))
  })

  it('already had a subscription (server says not eligible): the lock is unchanged', async () => {
    const f = eligibility(SUBSCRIBED_BEFORE)
    render(<CoreDepthLock access={proAccess} />)
    await waitFor(() => expect(askedEligibility(f)).toBe(1))
    expect(screen.getByRole('link').textContent).toBe('Unlock with AF Pro')
    expect(screen.queryByTestId('core-lock-trial-then')).toBeNull()
  })

  it('a lock for a plan the trial does not cover never asks', async () => {
    const f = eligibility(ELIGIBLE)
    render(<CoreDepthLock access={{ ...proAccess, planName: 'AF Commissioner', upgradePath: '/upgrade?plan=commissioner' } as CoreDepthAccess} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(askedEligibility(f)).toBe(0)
    expect(screen.getByRole('link').textContent).toBe('Unlock with AF Commissioner')
  })

  it('🛑 inside the iOS app — with or without StoreKit — it never asks and never says it', async () => {
    for (const ua of ['Mozilla/5.0 (iPhone) AllFantasyiOS', 'Mozilla/5.0 (iPhone) AllFantasyiOS AFIAP']) {
      resetLockTrialOfferCache()
      setUA(ua)
      const f = eligibility(ELIGIBLE)
      const view = render(<CoreDepthLock access={proAccess} />)
      await new Promise((r) => setTimeout(r, 20))
      expect(askedEligibility(f)).toBe(0)
      expect(screen.getByRole('link').textContent).toBe('Unlock with AF Pro')
      view.unmount()
    }
  })

  it('several locks on one page ask once', async () => {
    const f = eligibility(ELIGIBLE)
    render(
      <>
        <CoreDepthLock access={proAccess} />
        <CoreDepthLock access={proAccess} />
        <CoreDepthLock access={proAccess} />
      </>,
    )
    await waitFor(() => expect(screen.getAllByText('Try AF Pro free for 7 days')).toHaveLength(3))
    expect(askedEligibility(f)).toBe(1)
  })

  it('the one-line AF ADP header is not a lock card and keeps its label', async () => {
    const f = eligibility(ELIGIBLE)
    render(<AfAdpLockedHeader lock={proAccess} label="AF ADP" source="draft_adp" />)
    await new Promise((r) => setTimeout(r, 20))
    expect(askedEligibility(f)).toBe(0)
    expect(screen.getByTestId('af-adp-lock-cta').textContent).toContain('AF ADP')
  })
})

describe('LockedFeatureCard', () => {
  it('eligible: trial button and price line', async () => {
    eligibility(ELIGIBLE)
    render(<LockedFeatureCard featureName="Trade analyzer" featureId="trade_analyzer" requiredPlan="AF Pro" />)
    await waitFor(() => expect(screen.getByTestId('locked-feature-upgrade-link').textContent).toBe('Try AF Pro free for 7 days'))
    expect(screen.getByTestId('locked-feature-trial-then').textContent).toBe('Then $9.99/mo, cancel anytime')
  })

  it('not eligible, or a guest: no trial words', async () => {
    const f = eligibility(SUBSCRIBED_BEFORE)
    const view = render(<LockedFeatureCard featureName="Trade analyzer" requiredPlan="AF Pro" />)
    await waitFor(() => expect(askedEligibility(f)).toBe(1))
    expect(screen.getByTestId('locked-feature-upgrade-link').textContent).toBe('Unlock with AF Pro')
    view.unmount()

    resetLockTrialOfferCache()
    const g = eligibility(ELIGIBLE)
    render(<LockedFeatureCard featureName="Trade analyzer" requiredPlan="AF Pro" isGuestLocked />)
    await new Promise((r) => setTimeout(r, 20))
    expect(askedEligibility(g)).toBe(0)
    expect(screen.queryByTestId('locked-feature-trial-then')).toBeNull()
  })
})

describe('InContextMonetizationCard', () => {
  beforeEach(() => {
    ctx.requiredPlan = 'AF Pro'
    ctx.hasAccess = false
  })
  it('locked AF Pro feature, eligible viewer: trial on the upgrade button, price beside it', async () => {
    eligibility(ELIGIBLE)
    render(<InContextMonetizationCard title="Trade analyzer" featureId={'trade_analyzer' as never} />)
    await waitFor(() => expect(screen.getByTestId('in-context-monetization-upgrade-cta').textContent).toBe('Try AF Pro free for 7 days'))
    expect(screen.getByTestId('in-context-monetization-trial-then').textContent).toBe('Then $9.99/mo, cancel anytime')
  })
  it('already included with the plan: no upgrade button, and the card never asks', async () => {
    ctx.hasAccess = true
    const f = eligibility(ELIGIBLE)
    render(<InContextMonetizationCard title="Trade analyzer" featureId={'trade_analyzer' as never} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(askedEligibility(f)).toBe(0)
    expect(screen.queryByTestId('in-context-monetization-trial-then')).toBeNull()
  })
})
