import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The shell's poll stands down while the matchup board owns the route's refresh.
 *
 * Both timers call `router.refresh()` on the same `/core` route, so with both
 * mounted every period paid for two full renders — each a read across the whole
 * portfolio. See components/core-app/routeRefreshClaim.ts.
 *
 * ⚠ NO TEST FOR THE SHELL'S IN-FLIGHT GUARD, for the reason already recorded in
 * matchup-pulse-board.test.tsx: `router.refresh` is a synchronous mock here, so
 * the transition settles before the next tick and `pending` is never true when
 * the guard is read. A test for it passes with the guard deleted.
 */

/* One router object — a fresh one per render loops the shell's clock effect. */
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
import { MatchupPulseRefresh } from '@/components/core-app/MatchupPulseRefresh'
import { claimRouteRefresh, routeRefreshClaimed } from '@/components/core-app/routeRefreshClaim'

const LEAGUES = [{ id: 'l1', name: 'Dynasty Warriors', platform: 'sleeper', mark: 'DW' }]

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <AfCoreShell
      active="home"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      gameDayActive
    >
      <div>{children}</div>
    </AfCoreShell>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  nav.router.refresh.mockClear()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => {
  // Unmount even when an assertion threw, so a held claim cannot leak into the next test.
  cleanup()
  vi.useRealTimers()
})

describe('routeRefreshClaim', () => {
  it('counts claims, so a remount cannot release a claim still held', () => {
    expect(routeRefreshClaimed()).toBe(false)
    const a = claimRouteRefresh()
    const b = claimRouteRefresh()
    a()
    expect(routeRefreshClaimed()).toBe(true)
    a() // releasing twice is a no-op, not a second decrement
    expect(routeRefreshClaimed()).toBe(true)
    b()
    expect(routeRefreshClaimed()).toBe(false)
  })
})

describe('the shell poll and the matchup board', () => {
  it('the shell refreshes on the game-day cadence when nothing claims the route', () => {
    const { unmount } = render(<Shell />)
    act(() => void vi.advanceTimersByTime(20_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('with the board mounted, only the board refreshes — one render per period, not two', () => {
    const { unmount } = render(
      <Shell>
        <MatchupPulseRefresh inPlay />
      </Shell>,
    )
    act(() => void vi.advanceTimersByTime(20_000))
    // Both timers fire at 20s; before the claim this was 2.
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
    unmount()
    expect(routeRefreshClaimed()).toBe(false)
  })

  /*
   * 🛑 THE IDLE BOARD CLAIMS TOO, SINCE 2026-10-02. It used to stand down while idle so the shell's
   * 20s game-day tick would notice kickoff — but `gameDayActive` is true whenever any game in any of
   * the user's sports is on, so /core/matchup re-rendered every 20s all weekend with no NFL starter
   * playing. The board now wakes for kickoff itself (`nextKickoffAt`).
   */
  it('🛑 an idle board claims the route: the shell spends no 20s game-day render under it', () => {
    const { unmount } = render(
      <Shell>
        <MatchupPulseRefresh inPlay={false} />
      </Shell>,
    )
    expect(routeRefreshClaimed()).toBe(true)
    act(() => void vi.advanceTimersByTime(100_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(0)
    /* …and the board's own idle cadence still refreshes. */
    act(() => void vi.advanceTimersByTime(20_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('an idle board wakes just after the next kickoff, without polling for it', () => {
    const kickoff = new Date(Date.now() + 30_000).toISOString()
    const { unmount } = render(
      <Shell>
        <MatchupPulseRefresh inPlay={false} nextKickoffAt={kickoff} />
      </Shell>,
    )
    act(() => void vi.advanceTimersByTime(74_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(0)
    act(() => void vi.advanceTimersByTime(2_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
    unmount()
  })

  it('CONTROL: a kickoff more than six hours out holds no timer — the idle cadence covers it', () => {
    const kickoff = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString()
    const { unmount } = render(
      <Shell>
        <MatchupPulseRefresh inPlay={false} nextKickoffAt={kickoff} />
      </Shell>,
    )
    act(() => void vi.advanceTimersByTime(119_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(0)
    unmount()
  })

  it('the shell resumes when the board unmounts', () => {
    const { rerender, unmount } = render(
      <Shell>
        <MatchupPulseRefresh inPlay />
      </Shell>,
    )
    expect(routeRefreshClaimed()).toBe(true)
    rerender(
      <Shell>
        <MatchupPulseRefresh inPlay={false} />
      </Shell>,
    )
    /* Play ending no longer hands the route back — the idle board still owns it. */
    expect(routeRefreshClaimed()).toBe(true)
    rerender(<Shell />)
    expect(routeRefreshClaimed()).toBe(false)
    act(() => void vi.advanceTimersByTime(20_000))
    expect(nav.router.refresh).toHaveBeenCalledTimes(1)
    unmount()
  })
})
