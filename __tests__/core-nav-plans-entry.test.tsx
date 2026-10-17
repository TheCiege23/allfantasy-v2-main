import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * "Plans & tokens" in the Core nav (owner, 2026-10-03: "there is no more > account > plans").
 *
 * Before this the only way to buy was More → Tools → scroll to the bottom → Account → Plans. The
 * owner could not find it, and App Review — which must be able to reach every in-app purchase —
 * would not have either.
 *
 * ⚠ THE HREF IS PINNED EXACTLY, NOT MERELY "SOME PRICING LINK". In an iOS build that cannot sell
 * through Apple, `globals.css` hides `a[href^='/pricing']` (App Store 3.1.1). A tracking param is
 * still caught by that prefix; an absolute URL or a different path would put a purchase link in
 * front of a reviewer of a build with nothing to buy.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: () => {} },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => nav.router,
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

describe('Core nav → Plans & tokens', () => {
  it('is in the nav, one tap from anywhere, and links to plain /pricing', () => {
    render(
      <AfCoreShell active="home" leagues={[]} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0}>
        <div>screen</div>
      </AfCoreShell>,
    )
    const plans = screen
      .getAllByRole('link')
      .filter((a) => a.textContent?.replace(/\s+/g, ' ').trim().endsWith('Plans & tokens'))
    expect(plans.length).toBeGreaterThan(0)
    for (const link of plans) {
      expect(link.getAttribute('href')).toBe('/pricing')
    }
  })
})
