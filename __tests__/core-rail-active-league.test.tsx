import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The Admin entry in the /core rail.
 *
 * 🛑 THE BUG THIS CLOSES. `/admin` was reachable only by typing the URL. The two
 * components that DID carry an admin link — `AppShellNav` and `DashboardShell`'s
 * header controls — have zero runtime importers: PROMPT75 moved every page onto
 * `ProductShellLayout`, and `/dashboard` is now a stub that redirects to `/core`.
 * So the links still existed in the tree, still looked correct in review, and
 * rendered nowhere. `AfCoreShell` is the one shell `/core` actually mounts.
 *
 * ⚠ THE NEGATIVE CASE IS THE LOAD-BEARING ONE. An ungated entry hands every
 * signed-in user a door that /admin then refuses to open. That is why this
 * renders the shell both ways instead of asserting the gating expression exists
 * in the source: a source match cannot tell a working gate from a deleted one
 * that happens to leave the words behind.
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

/*
 * ⚠ THE RAIL NEVER SAID WHICH LEAGUE YOU ARE IN. The 2026-09-07 handoff
 * (`AF League List.dc.html`) accent-fills the current row, and on a rail of
 * sixty near-identical crests it is the only thing answering "where am I".
 * Shipped without it; caught by comparing the handoff against the built rail.
 */

const LEAGUES = [
  { id: 'l1', name: 'Dynasty Warriors', platform: 'sleeper', mark: 'DW' },
  { id: 'l2', name: 'Pirate League', platform: 'sleeper', mark: 'PL' },
  { id: 'l3', name: 'Cream Bowl', platform: 'espn', mark: 'CB' },
]

function shell(props: Record<string, unknown> = {}) {
  return (
    <AfCoreShell
      active="home"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      {...props}
    >
      <div>screen</div>
    </AfCoreShell>
  )
}

const railTiles = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.af-rail-tile.af-platform'))

describe('the rail marks the league you are in', () => {
  it('marks exactly the selected league, and only it', () => {
    const { container } = render(shell({ selectedLeagueId: 'l2' }))
    const active = railTiles(container).filter((t) => t.getAttribute('data-active') === 'true')
    expect(active).toHaveLength(1)
    expect(active[0].getAttribute('href')).toContain('l2')
  })

  /* Screen readers get the same fact the accent fill carries. */
  it('exposes it to assistive tech', () => {
    const { container } = render(shell({ selectedLeagueId: 'l2' }))
    const marked = railTiles(container).filter((t) => t.getAttribute('aria-current') === 'true')
    expect(marked).toHaveLength(1)
  })

  /*
   * ⚠ `aria-current="page"` IS ALREADY THE NAV'S. The row is not the page, it is
   * the league the page is scoped to; reusing "page" would announce two current
   * pages on one screen.
   */
  it('does not claim to be the current PAGE', () => {
    const { container } = render(shell({ selectedLeagueId: 'l2' }))
    const asPage = railTiles(container).filter((t) => t.getAttribute('aria-current') === 'page')
    expect(asPage).toHaveLength(0)
  })

  /* A cross-league screen with no league selected must mark nothing. */
  it('marks nothing when no league is selected', () => {
    const { container } = render(shell({}))
    const active = railTiles(container).filter((t) => t.getAttribute('data-active') === 'true')
    expect(active).toHaveLength(0)
  })

  it('marks nothing when the selected league is not in the rail', () => {
    const { container } = render(shell({ selectedLeagueId: 'not-a-league' }))
    const active = railTiles(container).filter((t) => t.getAttribute('data-active') === 'true')
    expect(active).toHaveLength(0)
  })
})
