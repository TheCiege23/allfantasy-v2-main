import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  LeagueTabsPrewarm,
  PREWARM_KEYS,
  selectPrewarmTargets,
} from '@/components/core-app/LeagueTabsPrewarm'
import {
  createSpeculationGate,
  NAVIGATION_QUIET_MS,
  SPECULATION_SPACING_MS,
  type SpeculationGate,
} from '@/components/core-app/speculationGate'

/**
 * Prewarming My team and Matchup.
 *
 * 🛑 THE NETWORK HALF CANNOT BE TESTED HERE, OR IN A DEV SERVER, AND THE SECOND
 * PART IS THE TRAP. Next disables prefetching entirely under
 * `NODE_ENV === 'development'` — `app-router.js` returns before dispatching, and
 * `link.js` short-circuits the same way — so a dev-server probe of this feature
 * observes zero requests and reads exactly like a feature that does nothing.
 *
 * What IS verifiable is every decision this component makes: which targets, when,
 * and the two cases where it must spend nothing. Those are tested against the
 * router directly. That `router.prefetch` performs a FULL prefetch rather than
 * stopping at `loading.tsx` is read out of Next's own source
 * (`kind: options?.kind ?? PrefetchKind.FULL`), not assumed, and not measurable
 * from here either way.
 */

const prefetch = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ prefetch, push() {}, replace() {}, refresh() {} }),
}))

const ALL = ['', 'my-team', 'matchup', 'waivers', 'players']

/** Runs whatever `requestIdleCallback` was handed, so the effect completes in-test. */
function installImmediateIdle() {
  vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
    cb()
    return 1
  })
  vi.stubGlobal('cancelIdleCallback', vi.fn())
}

/* A fresh gate per case, on the fake clock, so no claim leaks from one case into the next. */
let gate: SpeculationGate

beforeEach(() => {
  vi.useFakeTimers()
  prefetch.mockClear()
  installImmediateIdle()
  gate = createSpeculationGate()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('selectPrewarmTargets', () => {
  it('warms both when you are on neither', () => {
    expect(selectPrewarmTargets({ activeKey: 'standings', availableKeys: ALL })).toEqual([
      'my-team',
      'matchup',
    ])
  })

  it('never warms the screen you are already on', () => {
    expect(selectPrewarmTargets({ activeKey: 'my-team', availableKeys: ALL })).toEqual(['matchup'])
    expect(selectPrewarmTargets({ activeKey: 'matchup', availableKeys: ALL })).toEqual(['my-team'])
  })

  /*
   * 🛑 THE ONE THAT COSTS REAL MONEY IF IT REGRESSES, AND THE ONE NOTHING ELSE
   * WOULD REPORT. `LeagueTabs` removes Matchup on a league with no scored week.
   * Warming it anyway is a full server render of a screen with no tab to reach
   * it — spent on every render, for every such league, silently.
   */
  it('does not warm a screen this league is not offered', () => {
    const withoutMatchup = ALL.filter((key) => key !== 'matchup')
    expect(selectPrewarmTargets({ activeKey: 'standings', availableKeys: withoutMatchup })).toEqual([
      'my-team',
    ])
  })

  it('warms nothing when the league offers neither', () => {
    expect(selectPrewarmTargets({ activeKey: 'standings', availableKeys: ['', 'waivers'] })).toEqual(
      [],
    )
  })

  /* The list is deliberately short. Growing it is a cost decision, not a tidy-up. */
  it('is exactly two screens', () => {
    expect([...PREWARM_KEYS]).toEqual(['my-team', 'matchup'])
  })
})

describe('LeagueTabsPrewarm', () => {
  it('prefetches each target with the league carried forward', () => {
    render(<LeagueTabsPrewarm leagueId="L/1" activeKey="standings" availableKeys={ALL} gate={gate} />)
    vi.advanceTimersByTime(SPECULATION_SPACING_MS)

    expect(prefetch.mock.calls.map(([url]) => url)).toEqual([
      '/core/my-team?league=L%2F1',
      '/core/matchup?league=L%2F1',
    ])
  })

  /*
   * 🛑 ONE FULL RENDER AT A TIME. Both targets used to fire in one loop; with the rail warming
   * leagues at the same moment, one page load reached seven concurrent renders in production.
   */
  it('🛑 staggers the two targets through the shared gate instead of firing both at once', () => {
    render(<LeagueTabsPrewarm leagueId="L1" activeKey="standings" availableKeys={ALL} gate={gate} />)
    expect(prefetch).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(SPECULATION_SPACING_MS - 1)
    expect(prefetch, 'the second render started inside the spacing').toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(1)
    expect(prefetch).toHaveBeenCalledTimes(2)
  })

  it('🛑 waits out a real navigation before warming anything', () => {
    gate.noteNavigation()
    render(<LeagueTabsPrewarm leagueId="L1" activeKey="standings" availableKeys={ALL} gate={gate} />)
    expect(prefetch, 'warmed alongside the screen the manager just asked for').not.toHaveBeenCalled()

    vi.advanceTimersByTime(NAVIGATION_QUIET_MS)
    expect(prefetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SPECULATION_SPACING_MS)
    expect(prefetch).toHaveBeenCalledTimes(2)
  })

  it('shares the gate: a rail warm a moment earlier delays the first target', () => {
    gate.tryAcquire() // the rail just warmed a league
    render(<LeagueTabsPrewarm leagueId="L1" activeKey="standings" availableKeys={ALL} gate={gate} />)
    expect(prefetch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SPECULATION_SPACING_MS)
    expect(prefetch).toHaveBeenCalledTimes(1)
  })

  it('leaving the screen between the two targets cancels the second', () => {
    const view = render(<LeagueTabsPrewarm leagueId="L1" activeKey="standings" availableKeys={ALL} gate={gate} />)
    expect(prefetch).toHaveBeenCalledTimes(1)
    view.unmount()
    vi.advanceTimersByTime(SPECULATION_SPACING_MS * 3)
    expect(prefetch).toHaveBeenCalledTimes(1)
  })

  it('spends nothing when the reader has asked for reduced data', () => {
    vi.stubGlobal('navigator', { ...navigator, connection: { saveData: true } })
    render(<LeagueTabsPrewarm leagueId="L1" activeKey="standings" availableKeys={ALL} gate={gate} />)

    expect(prefetch).not.toHaveBeenCalled()
  })

  /*
   * ⚠ IDLE, NOT IMMEDIATE. The screen the user actually asked for is still
   * streaming behind its own Suspense boundary when this mounts; two more full
   * renders issued alongside it compete for the same server and make the page he
   * is looking at slower to speed up one he may never open.
   */
  it('waits for idle rather than firing during render', () => {
    const pending: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      pending.push(cb)
      return 1
    })
    vi.stubGlobal('cancelIdleCallback', vi.fn())

    render(<LeagueTabsPrewarm leagueId="L1" activeKey="standings" availableKeys={ALL} gate={gate} />)
    expect(prefetch, 'prefetched before the browser went idle').not.toHaveBeenCalled()

    pending.forEach((cb) => cb())
    expect(prefetch).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SPECULATION_SPACING_MS)
    expect(prefetch).toHaveBeenCalledTimes(2)
  })

  it('does not prefetch after unmounting while still waiting for idle', () => {
    const pending: Array<() => void> = []
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => {
      pending.push(cb)
      return 1
    })
    vi.stubGlobal('cancelIdleCallback', vi.fn())

    const view = render(<LeagueTabsPrewarm leagueId="L1" activeKey="standings" availableKeys={ALL} gate={gate} />)
    view.unmount()
    pending.forEach((cb) => cb())

    expect(prefetch, 'warmed a screen for a page the user had already left').not.toHaveBeenCalled()
  })
})
