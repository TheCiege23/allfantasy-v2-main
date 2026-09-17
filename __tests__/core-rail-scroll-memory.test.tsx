import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The league rail keeps its scroll position (user report, 2026-09-16).
 *
 * 🛑 A RAIL CLICK FROM ANY SCREEN BUT THE OVERVIEW REBUILDS THE WHOLE SHELL. Tiles link to
 * `/core?league=…`, which changes the `[[...screen]]` segment, and the page — which renders the
 * rail — is remounted. The list came back at the top. Unmounting and remounting the shell here is
 * that navigation, as far as the rail can tell.
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
import { keepTileInView, RAIL_SCROLL_KEY_PREFIX } from '@/components/core-app/useRailScrollMemory'

const LEAGUES = Array.from({ length: 40 }, (_, i) => ({
  id: `l${i}`,
  name: `League ${String(i).padStart(2, '0')}`,
  platform: 'sleeper',
  mark: `L${i}`,
}))

function shell(props: Record<string, unknown> = {}) {
  return (
    <AfCoreShell
      active="my-team"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      {...props}
    >
      <div>screen</div>
    </AfCoreShell>
  )
}

/** jsdom ships no matchMedia; without one the shell never learns its layout. */
function setViewport(isDesktop: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes('min-width: 721px') ? isDesktop : !isDesktop,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      onchange: null,
      dispatchEvent: () => false,
    }),
  })
}

const scroller = (c: HTMLElement) => c.querySelector<HTMLElement>('#af-rail-scroll')!
const tile = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`a[href="/core?league=${id}"]`)!

/** jsdom does no layout: give the scroller and tiles boxes so "in view" means something. */
function stubBoxes(c: HTMLElement, tileTop: (id: string) => number) {
  const box = scroller(c)
  box.getBoundingClientRect = () => ({ top: 100, bottom: 500, left: 0, right: 300, height: 400, width: 300, x: 0, y: 100, toJSON() {} }) as DOMRect
  for (const l of LEAGUES) {
    const t = tile(c, l.id)
    t.getBoundingClientRect = () => {
      const top = tileTop(l.id) - box.scrollTop
      return { top, bottom: top + 40, left: 0, right: 300, height: 40, width: 300, x: 0, y: top, toJSON() {} } as DOMRect
    }
  }
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('the league rail keeps where the user left it', () => {
  it('🛑 a tile click saves the position, and the rebuilt rail restores it', () => {
    setViewport(true)
    const first = render(shell({ selectedLeagueId: 'l0' }))
    scroller(first.container).scrollTop = 960
    fireEvent.click(tile(first.container, 'l30'))
    expect(window.sessionStorage.getItem(`${RAIL_SCROLL_KEY_PREFIX}open`)).toBe('960')
    first.unmount()

    // The navigation: a fresh shell, now scoped to the league that was clicked.
    const second = render(shell({ selectedLeagueId: 'l30' }))
    expect(scroller(second.container).scrollTop).toBe(960)
  })

  it('saves as the user scrolls, not only on a click', async () => {
    setViewport(true)
    const { container } = render(shell())
    scroller(container).scrollTop = 420
    fireEvent.scroll(scroller(container))
    await act(() => new Promise((resolve) => window.requestAnimationFrame(() => resolve(undefined))))
    expect(window.sessionStorage.getItem(`${RAIL_SCROLL_KEY_PREFIX}open`)).toBe('420')
  })

  it('keeps one position per layout — a phone offset is never applied to the desktop rail', () => {
    window.sessionStorage.setItem(`${RAIL_SCROLL_KEY_PREFIX}tray`, '700')
    setViewport(true)
    const desktop = render(shell())
    expect(scroller(desktop.container).scrollTop).toBe(0)
    desktop.unmount()

    setViewport(false)
    const phone = render(shell())
    expect(scroller(phone.container).scrollTop).toBe(700)
  })

  it('collapsed desktop is its own layout too', () => {
    window.localStorage.setItem('af-rail-open', '0')
    window.sessionStorage.setItem(`${RAIL_SCROLL_KEY_PREFIX}open`, '300')
    window.sessionStorage.setItem(`${RAIL_SCROLL_KEY_PREFIX}collapsed`, '80')
    setViewport(true)
    const { container } = render(shell())
    expect(scroller(container).scrollTop).toBe(80)
  })

  it('reads and writes nothing while the layout is unknown', () => {
    // No matchMedia: the shell cannot tell phone from desktop. Every layout has a saved position,
    // so a guessed layout — whichever it is — would restore one.
    const layouts = ['open', 'collapsed', 'tray']
    for (const l of layouts) window.sessionStorage.setItem(`${RAIL_SCROLL_KEY_PREFIX}${l}`, '500')
    const { container } = render(shell({ selectedLeagueId: 'l0' }))
    expect(scroller(container).scrollTop).toBe(0)
    scroller(container).scrollTop = 120
    fireEvent.click(tile(container, 'l3'))
    for (const l of layouts) {
      expect(window.sessionStorage.getItem(`${RAIL_SCROLL_KEY_PREFIX}${l}`), l).toBe('500')
    }
  })

  it('survives storage that throws', () => {
    setViewport(true)
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    try {
      const { container } = render(shell({ selectedLeagueId: 'l1' }))
      expect(scroller(container)).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})

describe('keepTileInView', () => {
  it('scrolls the smallest distance to show an off-screen tile, and leaves a visible one alone', () => {
    setViewport(true)
    const { container } = render(shell())
    const box = scroller(container)
    stubBoxes(container, (id) => 100 + Number(id.slice(1)) * 40)

    box.scrollTop = 0
    keepTileInView(box, tile(container, 'l3')) // top 220 — inside 100..500
    expect(box.scrollTop).toBe(0)

    keepTileInView(box, tile(container, 'l20')) // top 900, bottom 940 → needs 440
    expect(box.scrollTop).toBe(440)

    keepTileInView(box, tile(container, 'l1')) // top 140 - 440 = -300 → back up by 400
    expect(box.scrollTop).toBe(40)
  })

  it('🛑 the rebuilt rail brings a league picked elsewhere into view', () => {
    setViewport(true)
    window.sessionStorage.setItem(`${RAIL_SCROLL_KEY_PREFIX}open`, '0')
    const { container, rerender } = render(shell({ selectedLeagueId: 'l0' }))
    stubBoxes(container, (id) => 100 + Number(id.slice(1)) * 40)
    // Scope switched to a league far down the list without touching the rail.
    rerender(shell({ selectedLeagueId: 'l35' }))
    expect(scroller(container).scrollTop).toBeGreaterThan(0)
    const t = tile(container, 'l35').getBoundingClientRect()
    expect(t.bottom).toBeLessThanOrEqual(500)
  })
})
