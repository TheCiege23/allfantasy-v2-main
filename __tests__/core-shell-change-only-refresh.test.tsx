import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CORE_SAFETY_REFRESH_MS, decideCoreRefresh } from '@/lib/core-app/coreRefreshPolicy'

/**
 * The shell rebuilds /core only when the league fingerprint changed (the Sleeper model), not on a
 * blind timer. Before: a full render every 20s on a game day, ~80 every 30 minutes on prod.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: () => {}, refresh: vi.fn() },
}))
vi.mock('@/lib/core-app/deployGuard', () => ({
  primeDeployBaseline: () => Promise.resolve(),
  canRefreshInBackground: () => ({ then: (cb: (ok: boolean) => void) => cb(true) }),
  refreshInBackground: (fn: () => void) => { fn(); return Promise.resolve() },
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
const server = { version: 'v1' as string | null }
const versionCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/core/league-version')).length
const fetchMock = vi.fn(async (url: unknown) => {
  if (String(url).includes('/api/core/league-version')) {
    return server.version === null
      ? new Response('{}', { status: 503 })
      : new Response(JSON.stringify({ version: server.version }), { status: 200 })
  }
  return new Response('{}', { status: 200 })
})

function Shell() {
  return (
    <AfCoreShell active="home" leagues={LEAGUES as never} syncAge={{ label: 'just now', stale: false }} syncEligibleCount={0} gameDayActive>
      <div>screen</div>
    </AfCoreShell>
  )
}
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  nav.router.refresh.mockClear()
  fetchMock.mockClear()
  server.version = 'v1'
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('decideCoreRefresh', () => {
  it('takes the first answer as the baseline', () => {
    expect(decideCoreRefresh(null, 'a', 20_000)).toEqual({ refresh: false, seen: 'a' })
  })
  it('rebuilds when the fingerprint moved, and only then', () => {
    expect(decideCoreRefresh('a', 'a', 20_000)).toEqual({ refresh: false, seen: 'a' })
    expect(decideCoreRefresh('a', 'b', 20_000)).toEqual({ refresh: true, seen: 'b' })
  })
  it('rebuilds after the backstop even with no change', () => {
    expect(decideCoreRefresh('a', 'a', CORE_SAFETY_REFRESH_MS)).toEqual({ refresh: true, seen: 'a' })
  })
  it('an unavailable fingerprint means rebuild, never "unchanged"', () => {
    expect(decideCoreRefresh('a', null, 20_000)).toEqual({ refresh: true, seen: 'a' })
  })
})

describe('the shell on a game day', () => {
  it('checks every 20s but does not rebuild while nothing changed', async () => {
    render(<Shell />)
    await tick(0)
    await tick(20_000 * 6)
    expect(versionCalls()).toBeGreaterThanOrEqual(6)
    expect(nav.router.refresh).not.toHaveBeenCalled()
  })

  it('rebuilds on the first check after a change', async () => {
    render(<Shell />)
    await tick(20_000)
    server.version = 'v2'
    await tick(20_000)
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
    await tick(20_000 * 3)
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
  })

  it('still rebuilds every 5 minutes as a backstop', async () => {
    render(<Shell />)
    await tick(CORE_SAFETY_REFRESH_MS - 20_000)
    expect(nav.router.refresh).not.toHaveBeenCalled()
    await tick(20_000)
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
  })

  it('falls back to rebuilding on the timer when the check is unavailable', async () => {
    server.version = null
    render(<Shell />)
    await tick(20_000)
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
  })

  it('returning to the tab checks instead of rebuilding', async () => {
    render(<Shell />)
    await tick(20_000)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
    expect(nav.router.refresh).not.toHaveBeenCalled()
    server.version = 'v3'
    await tick(2_000)
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0) })
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
  })
})
