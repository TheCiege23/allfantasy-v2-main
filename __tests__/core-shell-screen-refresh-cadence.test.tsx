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

beforeEach(() => {
  vi.useFakeTimers()
  nav.router.refresh.mockClear()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => {
  cleanup()
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

describe('the shell refresh on a game day', () => {
  it('does not re-render my-team every 20s', () => {
    render(<Shell active="my-team" />)
    act(() => void vi.advanceTimersByTime(100_000))
    expect(nav.router.refresh).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(20_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
  })

  it('still refreshes home every 20s', () => {
    render(<Shell active="home" />)
    act(() => void vi.advanceTimersByTime(20_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
  })

  it('switching from my-team to home picks up the game-day cadence', () => {
    const { rerender } = render(<Shell active="my-team" />)
    rerender(<Shell active="home" />)
    act(() => void vi.advanceTimersByTime(20_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
  })
})
