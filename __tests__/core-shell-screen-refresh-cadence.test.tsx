import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { coreRefreshIntervalMs, shellRouteRefreshMs } from '@/lib/core-app/coreRefreshPolicy'

/**
 * The shell's full-route refresh cadence is per SCREEN.
 *
 * `my-team` renders no value that can change during a game (no live scoring is ingested; the lock
 * countdown ticks on the client), yet on game days it was re-rendered every 20s — the largest DB
 * load on /core in prod Sentry. It keeps the 120s idle cadence.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: vi.fn() },
}))

/* Background refreshes go through the deploy guard (lib/core-app/deployGuard). A synchronous
   pass-through keeps fake-timer assertions in the same tick and keeps its marker read out of
   fetch counts; guard.ok=false is "a deploy landed". */
const guard = vi.hoisted(() => ({ ok: true }))
vi.mock('@/lib/core-app/deployGuard', () => ({
  primeDeployBaseline: () => Promise.resolve(),
  canRefreshInBackground: () => ({ then: (cb: (ok: boolean) => void) => cb(guard.ok) }),
  refreshInBackground: (fn: () => void) => { if (guard.ok) fn(); return Promise.resolve() },
  isNewVersionReady: () => false,
  subscribeNewVersionReady: () => () => {},
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

const LEAGUES = [{ id: 'l1', name: 'Dynasty Warriors', platform: 'sleeper', mark: 'DW' }]

function Shell({ active }: { active: 'home' | 'my-team' }) {
  return (
    <AfCoreShell
      active={active}
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      gameDayActive
    >
      <div>screen</div>
    </AfCoreShell>
  )
}

/* Since 2026-11-19 the cadence is how often the shell ASKS whether the page changed
   (/api/core/league-version); it rebuilds only on a change (core-shell-change-only-refresh.test.tsx).
   So the cadence is counted in checks. */
const fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: 'same' }), { status: 200 }))
const checks = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/core/league-version')).length
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  nav.router.refresh.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('shellRouteRefreshMs', () => {
  it('my-team keeps the idle cadence on game days; other screens follow the game-day policy', () => {
    expect(shellRouteRefreshMs('my-team', true, 3)).toBe(120_000)
    expect(shellRouteRefreshMs('home', true, 3)).toBe(coreRefreshIntervalMs(true, 3))
    expect(shellRouteRefreshMs('home', true, 3)).toBe(20_000)
    expect(shellRouteRefreshMs('home', false, 0)).toBe(120_000)
  })
})

describe('the shell check on a game day', () => {
  it('does not check my-team every 20s', async () => {
    render(<Shell active="my-team" />)
    await tick(0)
    const baseline = checks()
    await tick(100_000)
    expect(checks()).toBe(baseline)
    await tick(20_000)
    expect(checks()).toBe(baseline + 1)
  })

  it('still checks home every 20s', async () => {
    render(<Shell active="home" />)
    await tick(0)
    const baseline = checks()
    await tick(20_000)
    expect(checks()).toBe(baseline + 1)
  })

  it('switching from my-team to home picks up the game-day cadence', async () => {
    const { rerender } = render(<Shell active="my-team" />)
    rerender(<Shell active="home" />)
    await tick(0)
    const baseline = checks()
    await tick(20_000)
    expect(checks()).toBe(baseline + 1)
  })

  it('an unchanged page is not rebuilt on the cadence', async () => {
    render(<Shell active="home" />)
    await tick(20_000 * 5)
    expect(nav.router.refresh).not.toHaveBeenCalled()
  })
})
