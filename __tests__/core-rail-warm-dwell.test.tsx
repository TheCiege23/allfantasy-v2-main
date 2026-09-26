import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The league rail warms a league only when the pointer RESTS on it — never for passing over it —
 * and through the one speculation gate the tab prewarm also uses.
 *
 * 🛑 WHY. The warm fired on `onMouseEnter`, so a pointer crossing the rail ordered a FULL `/core`
 * render per crest it touched. Production 2026-09-26: one page load carried six concurrent league
 * `home` renders at 6–8s each while the page itself waited behind them (see `speculationGate.ts`).
 *
 * Next disables prefetch under `next dev`, so the network half cannot be observed locally; these
 * pin the DECISIONS against the router the shell calls.
 */

const nav = vi.hoisted(() => ({
  router: { push: () => {}, replace: () => {}, prefetch: vi.fn(), refresh: () => {} },
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

/* A fresh gate per case: the real one is module-level, and a claim must not leak between cases. */
const holder = vi.hoisted(() => ({ gate: null as null | import('@/components/core-app/speculationGate').SpeculationGate }))
vi.mock('@/components/core-app/speculationGate', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/components/core-app/speculationGate')>()
  return {
    ...real,
    speculationGate: {
      noteNavigation: () => holder.gate!.noteNavigation(),
      tryAcquire: () => holder.gate!.tryAcquire(),
      msUntilOpen: () => holder.gate!.msUntilOpen(),
    },
  }
})

import AfCoreShell from '@/components/core-app/AfCoreShell'
import { RAIL_WARM_DWELL_MS } from '@/components/core-app/railPrefetch'
import { createSpeculationGate, SPECULATION_SPACING_MS } from '@/components/core-app/speculationGate'

const LEAGUES = [
  { id: 'l1', name: 'Dynasty Warriors', platform: 'sleeper', mark: 'DW' },
  { id: 'l2', name: 'Pirate League', platform: 'sleeper', mark: 'PL' },
  { id: 'l3', name: 'Cream Bowl', platform: 'espn', mark: 'CB' },
]

function renderShell() {
  const view = render(
    <AfCoreShell
      active="home"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
    >
      <div>screen</div>
    </AfCoreShell>,
  )
  const tile = (id: string) =>
    Array.from(view.container.querySelectorAll<HTMLAnchorElement>('.af-rail-tile.af-platform')).find((a) =>
      a.getAttribute('href')?.includes(`league=${id}`),
    )!
  return { view, tile }
}

const warmed = () => nav.router.prefetch.mock.calls.map(([url]) => url)

beforeEach(() => {
  vi.useFakeTimers()
  nav.router.prefetch.mockClear()
  holder.gate = createSpeculationGate()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('rail warm needs a hover pause', () => {
  it('control: resting on a crest warms that league once the pause has passed, not before', () => {
    const { tile } = renderShell()
    fireEvent.mouseEnter(tile('l2'))
    vi.advanceTimersByTime(RAIL_WARM_DWELL_MS - 1)
    expect(warmed()).toEqual([])
    vi.advanceTimersByTime(1)
    expect(warmed()).toEqual(['/core?league=l2'])
  })

  it('🛑 a pointer sweeping across the rail warms nothing', () => {
    const { tile } = renderShell()
    for (const id of ['l1', 'l2', 'l3']) {
      fireEvent.mouseEnter(tile(id))
      vi.advanceTimersByTime(RAIL_WARM_DWELL_MS / 4)
      fireEvent.mouseLeave(tile(id))
    }
    vi.advanceTimersByTime(RAIL_WARM_DWELL_MS * 10)
    expect(warmed(), 'passing over a crest ordered a full render').toEqual([])
  })

  it('keyboard focus is held to the same pause', () => {
    const { tile } = renderShell()
    fireEvent.focus(tile('l1'))
    fireEvent.blur(tile('l1'))
    fireEvent.focus(tile('l3'))
    vi.advanceTimersByTime(RAIL_WARM_DWELL_MS)
    expect(warmed()).toEqual(['/core?league=l3'])
  })
})

describe('rail warm goes through the shared gate', () => {
  it('🛑 two rests inside the spacing warm one league, and the refused one can warm later', () => {
    const { tile } = renderShell()
    fireEvent.mouseEnter(tile('l1'))
    vi.advanceTimersByTime(RAIL_WARM_DWELL_MS)
    fireEvent.mouseLeave(tile('l1'))
    fireEvent.mouseEnter(tile('l2'))
    vi.advanceTimersByTime(RAIL_WARM_DWELL_MS)
    fireEvent.mouseLeave(tile('l2'))
    expect(warmed()).toEqual(['/core?league=l1'])

    vi.advanceTimersByTime(SPECULATION_SPACING_MS)
    fireEvent.mouseEnter(tile('l2'))
    vi.advanceTimersByTime(RAIL_WARM_DWELL_MS)
    expect(warmed(), 'a refusal was recorded as a warm, so the league could never warm').toEqual([
      '/core?league=l1',
      '/core?league=l2',
    ])
  })

  it('🛑 a real click on a league holds every warm off while its screen renders', () => {
    const { tile } = renderShell()
    fireEvent.click(tile('l1'))
    fireEvent.mouseEnter(tile('l3'))
    vi.advanceTimersByTime(RAIL_WARM_DWELL_MS)
    expect(warmed(), 'warmed a league alongside the screen the manager asked for').toEqual([])
  })
})
