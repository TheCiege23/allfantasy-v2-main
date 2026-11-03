import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Urgency badges on the Core tabs, rendered through the real shell.
 *
 * The contract: a count shows on the tab it belongs to, a zero or unknown shows
 * nothing, and a running draft keeps its LIVE badge instead of a number.
 */

/*
 * 🛑 ONE ROUTER OBJECT, NOT ONE PER CALL. The shell's rail-clock effect depends
 * on `router` and sets state synchronously; a fresh object per render loops
 * forever inside act() and the suite hangs silently. See core-admin-nav.test.tsx.
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
    render(shell({ urgencyBadges: { myTeam: 2, trades: 1, draftHq: 3 } }))
    expect(badgeFor('My team')).toBe('2')
    expect(badgeFor('Trades')).toBe('1')
    expect(badgeFor('Draft HQ')).toBe('3')
  })

  /* Sync left the rail for every league on 2026-10-31; a stale count must not bring it back. */
  it('has no Sync tab, even with a stale-league count', () => {
    render(shell({ selectedLeagueId: 'lg1', urgencyBadges: { sync: 4 } }))
    const labels = screen.getAllByRole('link').map((a) => a.textContent?.replace(/\s+/g, ' ').trim())
    expect(labels.some((t) => t === 'Sync' || t?.startsWith('↻'))).toBe(false)
    expect(screen.queryAllByRole('link').some((a) => a.getAttribute('href')?.startsWith('/core/sync'))).toBe(false)
  })

  it('draws nothing for a zero, a null, or an absent prop', () => {
    render(shell({ urgencyBadges: { myTeam: 0, trades: null } }))
    expect(badgeFor('My team')).toBeNull()
    expect(badgeFor('Trades')).toBeNull()
  })

  /* A running draft is the more urgent fact; a number would bury it. */
  it('keeps LIVE on Draft HQ while a draft is running', () => {
    render(shell({ draftLive: true, urgencyBadges: { draftHq: 2 } }))
    expect(badgeFor('Draft HQ')).toBe('LIVE')
  })
})
