// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Lock attribution + return to the unlocked feature (2026-11-17).
 *   - A feature lock's upgrade link says which lock sold the plan (`from=lock_<featureId>`) and where
 *     the buyer was (`back=<path + query>`). Before: the bare plan path — "no source" in the funnel.
 *   - After paying, the success panel's primary button goes back there. Before: seven hand-listed
 *     features had a button; everyone else went to /core, and a league-scoped lock never could return.
 */

vi.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
// Analytics go to gtag; keep the real module (it has pure helpers the card uses) and silence gtag.
vi.mock('@/lib/gtag', () => ({ gtagEvent: vi.fn() }))
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({ useSearchParams: () => search }))

import { safeBackPath, withLockReturn } from '@/lib/monetization/lockReturn'
import { resolveLockedFeature } from '@/lib/monetization/lockedFeature'
import { LockedFeatureCard } from '@/components/subscription/LockedFeatureCard'
import { CheckoutOutcomePanel } from '@/components/monetization/CheckoutOutcomePanel'
import { CoreDepthLock } from '@/components/core-app/CoreDepthLock'
import { entrySourceFromSearch } from '@/lib/monetization/upgradeEntrySource'

beforeEach(() => {
  search = new URLSearchParams()
  window.history.replaceState(null, '', '/league/L1?view=waivers')
})
afterEach(() => cleanup())

const paramsOf = (href: string | null) => new URL(href ?? '', 'http://x').searchParams

describe('safeBackPath — `back` arrives in a URL anyone can craft, and becomes a link after a payment', () => {
  it('keeps an internal page with its query', () => {
    expect(safeBackPath('/league/L1?view=waivers')).toBe('/league/L1?view=waivers')
    expect(safeBackPath('/af-legacy?tab=waiver')).toBe('/af-legacy?tab=waiver')
  })

  it.each([
    ['//evil.example/x', 'protocol-relative'],
    ['/\\evil.example', 'backslash host'],
    ['https://evil.example', 'absolute'],
    ['javascript:alert(1)', 'script'],
    ['/a\\b', 'any backslash'],
    ['/league/L1\nx', 'control character'],
    [`/${'a'.repeat(300)}`, 'too long'],
    ['/upgrade?plan=pro', 'a purchase page (loop)'],
    ['/commissioner-upgrade', 'a purchase page (loop)'],
    ['/pricing', 'a purchase page (loop)'],
    ['/login?callbackUrl=/x', 'an auth page'],
    ['/api/whatever', 'an API'],
    ['', 'empty'],
  ])('refuses %s (%s)', (value) => {
    expect(safeBackPath(value)).toBeNull()
  })

  it('a page that merely starts with a blocked word is fine', () => {
    expect(safeBackPath('/upgrades-guide')).toBe('/upgrades-guide')
    expect(safeBackPath('/pricing-history')).toBe('/pricing-history')
  })
})

describe('withLockReturn', () => {
  it('adds from and back; an existing from or back wins; an unsafe back is never added', () => {
    const href = withLockReturn('/upgrade?plan=pro&feature=ai_waivers', { source: 'lock_ai_waivers', back: '/league/L1?view=waivers' })
    expect(Object.fromEntries(paramsOf(href))).toEqual({
      plan: 'pro', feature: 'ai_waivers', from: 'lock_ai_waivers', back: '/league/L1?view=waivers',
    })
    expect(paramsOf(withLockReturn('/upgrade?from=chimmy&back=/a', { source: 'lock_x', back: '/b' })).get('from')).toBe('chimmy')
    expect(paramsOf(withLockReturn('/upgrade?from=chimmy&back=/a', { source: 'lock_x', back: '/b' })).get('back')).toBe('/a')
    expect(paramsOf(withLockReturn('/upgrade', { source: 'lock_x', back: '//evil.example' })).has('back')).toBe(false)
    expect(withLockReturn('https://x', { source: 'lock_x', back: '/a' })).toBe('https://x')
  })
})

describe('the feature lock card links with its lock and its page', () => {
  it('View plans carries from=lock_<featureId> and back=<this page>', async () => {
    render(<LockedFeatureCard featureName="AI Waivers" featureId="ai_waivers" requiredPlan="AF Pro" upgradeHref="/upgrade?plan=pro&feature=ai_waivers" />)
    const link = screen.getByTestId('locked-feature-upgrade-link')
    await waitFor(() => expect(paramsOf(link.getAttribute('href')).get('back')).toBe('/league/L1?view=waivers'))
    const p = paramsOf(link.getAttribute('href'))
    expect(p.get('from')).toBe('lock_ai_waivers')
    expect(p.get('feature')).toBe('ai_waivers')
    // The checkout client reads `from` off the upgrade page's own URL, so this is what reaches Stripe.
    expect(entrySourceFromSearch(`?${p.toString()}`)).toBe('lock_ai_waivers')
  })

  it('the /core depth lock carries its page too', async () => {
    window.history.replaceState(null, '', '/core/players?id=p1')
    render(<CoreDepthLock access={{ depth: 'player_depth', label: 'Player depth', planName: 'AF Pro', upgradePath: '/upgrade?plan=pro', unlocked: false } as never} what="Player detail" />)
    const link = screen.getByRole('link')
    await waitFor(() => expect(paramsOf(link.getAttribute('href')).get('back')).toBe('/core/players?id=p1'))
    expect(paramsOf(link.getAttribute('href')).get('from')).toBe('lock_player_depth')
    expect(link.hasAttribute('data-ios-purchase')).toBe(true)
  })
})

describe('after paying, the primary button returns to the lock', () => {
  it('back + a feature id the old list never knew: "Back to AI Waivers", to the exact league page', () => {
    search = new URLSearchParams({ plan: 'pro', feature: 'ai_waivers', from: 'lock_ai_waivers', back: '/league/L1?view=waivers', checkout: 'success' })
    render(<CheckoutOutcomePanel phase="success" planName="AF Pro" />)
    const button = screen.getByRole('link', { name: 'Back to AI Waivers' })
    expect(button.getAttribute('href')).toBe('/league/L1?view=waivers')
    expect(screen.queryByRole('link', { name: 'Go to your dashboard' })).toBeNull()
  })

  it('back beats a listed feature\'s guessed href', () => {
    search = new URLSearchParams({ feature: 'commissioner', back: '/league/L9?view=commish' })
    render(<CheckoutOutcomePanel phase="success" />)
    expect(screen.getByRole('link', { name: 'Back to commissioner insights' }).getAttribute('href')).toBe('/league/L9?view=commish')
  })

  it('back with no named feature (the /core depth lock): "Back to where you were"', () => {
    search = new URLSearchParams({ plan: 'pro', from: 'lock_player_depth', back: '/core/players?id=p1' })
    render(<CheckoutOutcomePanel phase="success" />)
    expect(screen.getByRole('link', { name: 'Back to where you were' }).getAttribute('href')).toBe('/core/players?id=p1')
  })

  it('🛑 a crafted off-site back is ignored: the dashboard, never the attacker', () => {
    search = new URLSearchParams({ back: '//evil.example/phish' })
    render(<CheckoutOutcomePanel phase="success" />)
    expect(screen.getByRole('link', { name: 'Go to your dashboard' }).getAttribute('href')).toBe('/core')
    expect(document.body.innerHTML).not.toContain('evil.example')
  })

  it('a cancelled checkout offers the way back too', () => {
    search = new URLSearchParams({ feature: 'ai_waivers', back: '/league/L1?view=waivers', checkout: 'cancelled' })
    render(<CheckoutOutcomePanel phase="cancelled" />)
    expect(screen.getByRole('link', { name: 'Back to AI Waivers' }).getAttribute('href')).toBe('/league/L1?view=waivers')
  })
})

describe('resolveLockedFeature names any premium feature from the plan matrix', () => {
  it('listed keys keep their entry; premium ids get their matrix title; junk stays null', () => {
    expect(resolveLockedFeature('league_rankings')).toEqual({ label: 'power rankings commentary', href: '/core/rankings?scope=league&panel=power' })
    expect(resolveLockedFeature('ai_waivers')).toEqual({ label: 'AI Waivers', href: null })
    expect(resolveLockedFeature('legacy_trade_finder')).toEqual({ label: 'Trade Review', href: null })
    expect(resolveLockedFeature('some_new_key')).toBeNull()
  })
})
