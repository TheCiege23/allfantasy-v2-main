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

function shell(props: Record<string, unknown> = {}) {
  return (
    <AfCoreShell
      active="home"
      leagues={[]}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      {...props}
    >
      <div>screen</div>
    </AfCoreShell>
  )
}

const adminLinks = () =>
  screen.queryAllByRole('link', { name: /admin/i }).filter((el) => el.getAttribute('href') === '/admin')

describe('/core Admin rail entry', () => {
  it('shows an /admin link when the viewer is an admin', () => {
    render(shell({ isAdmin: true }))
    expect(adminLinks().length).toBeGreaterThan(0)
  })

  /** 🛑 The half that leaks if the gate is ever dropped. */
  it('renders no /admin link for a non-admin', () => {
    render(shell({ isAdmin: false }))
    expect(adminLinks()).toHaveLength(0)
  })

  /**
   * ⚠ An absent prop must hide the door, not reveal it. `isAdmin` is optional so
   * that every other AfCoreShell call site keeps compiling; that only stays safe
   * while the default is closed.
   */
  it('defaults to hidden when the prop is omitted entirely', () => {
    render(shell())
    expect(adminLinks()).toHaveLength(0)
  })
})

/**
 * The server half. The gate has to be the predicate /admin itself enforces —
 * a second, hand-rolled email check drifts, and it fails in the worse direction:
 * a rail offering a door the page behind it refuses to open.
 */
describe('/core admin gate wiring', () => {
  const PAGE = readFileSync(resolve(process.cwd(), 'app/core/[[...screen]]/page.tsx'), 'utf8')

  it('resolves admin access with the same helper /admin uses', () => {
    expect(PAGE).toContain('getAdminAccessState')
    expect(PAGE).toContain('isAdmin={isAdmin}')
  })

  it('degrades to hidden rather than throwing the page', () => {
    expect(PAGE).toMatch(/getAdminAccessState\(\)[\s\S]{0,120}catch\(\(\) => false\)/)
  })
})
