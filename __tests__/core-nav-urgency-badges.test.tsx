import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Urgency badges on the Core tabs, rendered through the real shell.
 *
 * The contract: a count shows on the tab it belongs to, a zero or unknown shows
 * nothing, and a running draft keeps its LIVE badge instead of a number.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/components/core-app/comms/CommsDock', () => ({ default: () => null }))
vi.mock('@/components/core-app/SyncNowButton', () => ({ default: () => null }))
vi.mock('@/components/core-app/GeoRestrictionNotice', () => ({ GeoRestrictionNotice: () => null }))
vi.mock('@/components/core-app/AfCrest', () => ({ AfCrest: () => null }))
vi.mock('@/components/MiniPlayerImg', () => ({ default: () => null }))

import AfCoreShell from '@/components/core-app/AfCoreShell'

function shell(props: Record<string, unknown> = {}) {
  return (
    <AfCoreShell active="home" leagues={[]} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} {...props}>
      <div>screen</div>
    </AfCoreShell>
  )
}

/** The desktop nav badge on the link whose visible label is `label`. */
function badgeFor(label: string): string | null {
  const link = screen
    .getAllByRole('link')
    .find((a) => a.textContent?.replace(/\s+/g, ' ').includes(label) && a.querySelector('.af-nav-badge'))
  return link?.querySelector('.af-nav-badge')?.textContent ?? null
}

describe('Core tab urgency badges', () => {
  it('puts each league count on its own tab', () => {
    render(shell({ urgencyBadges: { myTeam: 2, trades: 1, draftHq: 3, sync: 4 } }))
    expect(badgeFor('My team')).toBe('2')
    expect(badgeFor('Trades')).toBe('1')
    expect(badgeFor('Draft HQ')).toBe('3')
    expect(badgeFor('Sync')).toBe('4')
  })

  it('draws nothing for a zero, a null, or an absent prop', () => {
    const { unmount } = render(shell({ urgencyBadges: { myTeam: 0, trades: null } }))
    expect(badgeFor('My team')).toBeNull()
    expect(badgeFor('Trades')).toBeNull()
    unmount()
    render(shell())
    expect(badgeFor('Sync')).toBeNull()
  })

  /* A running draft is the more urgent fact; a number would bury it. */
  it('keeps LIVE on Draft HQ while a draft is running', () => {
    render(shell({ draftLive: true, urgencyBadges: { draftHq: 2 } }))
    expect(badgeFor('Draft HQ')).toBe('LIVE')
  })
})
