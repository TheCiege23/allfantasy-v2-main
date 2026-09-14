import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Settings in the Core nav opens the Settings hub, not a tab.
 *
 * 🛑 THE BUG THIS CLOSES. The 2026-09-13 Settings handoff made bare `/settings` a
 * card grid that every tab opens from. The Core nav kept deep-linking to
 * `/settings?tab=preferences`, so from Core the hub was unreachable: the nav
 * skipped straight past it into a tab, and the redesign read as "Settings did
 * not change" (user report, 2026-09-14). A link that names a tab is correct
 * elsewhere — the profile page's "Language, timezone, theme" row — but the
 * nav's Settings entry is the front door.
 */

/* One router object for the file — see core-admin-nav.test.tsx for why a
   per-call factory hangs any suite that renders AfCoreShell. */
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

describe('Core nav → Settings', () => {
  it('opens the Settings hub, not a tab inside it', () => {
    render(
      <AfCoreShell active="home" leagues={[]} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0}>
        <div>screen</div>
      </AfCoreShell>,
    )
    const settingsLinks = screen
      .getAllByRole('link')
      .filter((a) => a.textContent?.replace(/\s+/g, ' ').trim().endsWith('Settings'))
    expect(settingsLinks.length).toBeGreaterThan(0)
    for (const link of settingsLinks) {
      expect(link.getAttribute('href')).toBe('/settings')
    }
  })
})
