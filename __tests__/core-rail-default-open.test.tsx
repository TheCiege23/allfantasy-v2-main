import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The league rail is EXPANDED BY DEFAULT on desktop — 2026-09-07 handoff.
 *
 * 🛑 WHY THIS IS A TRI-STATE AND NOT A FLIPPED BOOLEAN. `data-rail-open` drives
 * TWO presentations from one flag: the desktop column AND the mobile
 * full-screen tray. Defaulting it to `true` — the obvious implementation —
 * opens the tray over every page on every phone load. Measured in a 375px
 * frame: `.af-rail` becomes `position: fixed`, `x: 0`, full viewport.
 *
 * So `absent` has to mean two different things at once, which is precisely what
 * a boolean cannot express:
 *
 *   absent    no preference    desktop EXPANDED (via CSS), mobile tray CLOSED
 *   'false'   chose collapsed  desktop 68px crests
 *   'true'    chose expanded   desktop expanded, mobile tray OPEN
 *
 * ⚠ THESE ASSERT THE ATTRIBUTE, NOT THE LAYOUT, AND THAT IS THE LIMIT OF THIS
 * FILE. jsdom does not lay out grid, so no test here can tell you the rail is
 * 300px wide or that the page is not 232px. The widths were measured in a real
 * engine and recorded in the commit; what these pin is the STATE MACHINE that
 * selects them — which is the half that a refactor silently breaks.
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

const LEAGUES = [
  { id: 'l1', name: 'Dynasty Warriors', platform: 'sleeper', mark: 'DW' },
  { id: 'l2', name: 'Pirate League', platform: 'sleeper', mark: 'PL' },
]

function shell() {
  return (
    <AfCoreShell
      active="home"
      leagues={LEAGUES as never}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
    >
      <div>screen</div>
    </AfCoreShell>
  )
}

/**
 * ⚠ jsdom SHIPS NO `matchMedia`, so without this the component's own try/catch
 * swallows a TypeError and every test silently exercises the "no matchMedia"
 * branch — including the ones meant to prove the desktop branch works. Defining
 * it explicitly is what makes the desktop and mobile cases distinguishable
 * rather than both quietly taking the same path.
 */
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

const railFlag = (c: HTMLElement) =>
  c.querySelector('.af-shell')?.getAttribute('data-rail-open') ?? null

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('the desktop rail opens without being asked', () => {
  it('reconciles to open on desktop when nothing is stored', () => {
    setViewport(true)
    const { container } = render(shell())
    expect(railFlag(container)).toBe('true')
  })

  /*
   * 🛑 THE ONE THAT MATTERS. A phone with no stored preference must render NO
   * flag — the tray is `position: fixed; inset: 0`, so 'true' here is a
   * full-screen league list covering the page the reader asked for.
   */
  it('leaves the flag absent on mobile, so the tray stays shut', () => {
    setViewport(false)
    const { container } = render(shell())
    expect(railFlag(container)).toBeNull()
  })

  it('gives the mobile league control a stateful accessible name', () => {
    setViewport(false)
    const { container } = render(shell())
    const handle = container.querySelector<HTMLButtonElement>('.af-rail-handle')
    expect(handle?.getAttribute('aria-label')).toBe('Open leagues')
    fireEvent.click(handle as HTMLButtonElement)
    expect(handle?.getAttribute('aria-label')).toBe('Close leagues')
  })

  it('contains phone tray focus, closes with Escape, and restores the page', () => {
    setViewport(false)
    // jsdom has no layout; treat these rendered controls as visible here.
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList)
    const { container } = render(shell())
    const handle = container.querySelector<HTMLButtonElement>('.af-rail-handle')!
    const home = container.querySelector<HTMLAnchorElement>('.af-rail-logo')!
    const content = container.querySelector<HTMLElement>('#af-content')!
    const previousOverflow = document.body.style.overflow
    fireEvent.click(handle)
    expect(document.activeElement).toBe(handle)
    expect(document.body.style.overflow).toBe('hidden')
    expect(content.closest('.af-main')?.inert ?? content.inert).toBe(true)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(home)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(handle)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(handle).toHaveAttribute('aria-expanded', 'false')
    expect(document.activeElement).toBe(handle)
    expect(document.body.style.overflow).toBe(previousOverflow)
    expect(content.closest('.af-main')?.inert ?? content.inert).not.toBe(true)
  })

  it('closes the phone tray for its home and utility links too', () => {
    setViewport(false)
    const { container } = render(shell())
    const handle = container.querySelector<HTMLButtonElement>('.af-rail-handle')!
    for (const selector of ['.af-rail-logo', '.af-rail-add', '.af-rail-profile']) {
      fireEvent.click(handle)
      fireEvent.click(container.querySelector(selector)!)
      expect(handle).toHaveAttribute('aria-expanded', 'false')
      expect(document.body.style.overflow).not.toBe('hidden')
    }
  })

  /*
   * ⚠ 'false' AND absent MUST NOT COLLAPSE INTO ONE VALUE. Emitting `undefined`
   * for a reader who collapsed the rail would re-expand it on their next page
   * load, because absent is what the CSS reads as "expanded" on desktop.
   */
  it('emits a literal false for someone who collapsed it, never an absent flag', () => {
    setViewport(true)
    window.localStorage.setItem('af-rail-open', '0')
    const { container } = render(shell())
    expect(railFlag(container)).toBe('false')
  })

  it('still honours a stored open preference', () => {
    setViewport(true)
    window.localStorage.setItem('af-rail-open', '1')
    const { container } = render(shell())
    expect(railFlag(container)).toBe('true')
  })

  it('keeps the phone tray shut even with an expanded desktop preference', () => {
    setViewport(false)
    window.localStorage.setItem('af-rail-open', '1')
    const { container } = render(shell())
    expect(railFlag(container)).toBeNull()
  })

  it('does not save a temporary phone tray as the desktop preference', () => {
    setViewport(false)
    window.localStorage.setItem('af-rail-open', '0')
    const { container } = render(shell())
    fireEvent.click(container.querySelector('.af-rail-handle')!)
    expect(railFlag(container)).toBe('true')
    expect(window.localStorage.getItem('af-rail-open')).toBe('0')
  })

  /*
   * ⚠ THE TOGGLE MUST NOT ANNOUNCE THE OPPOSITE OF WHAT IS PAINTED. The rail is
   * expanded on a default desktop load, so `aria-expanded` has to say so — this
   * is the reason the effect adopts 'open' instead of leaving the flag null and
   * letting CSS do it alone.
   */
  it('does not tell a screen reader the rail is closed while it is open', () => {
    setViewport(true)
    const { container } = render(shell())
    const toggle = container.querySelector('.af-rail-toggle')
    expect(railFlag(container)).toBe('true')
    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
  })

  /*
   * Storage that THROWS is a real state — a private window, or a browser set to
   * block site data — and it must not take the shell down or strand the rail.
   */
  it('survives localStorage throwing', () => {
    setViewport(true)
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    const { container } = render(shell())
    expect(railFlag(container)).toBe('true')
    spy.mockRestore()
  })
})
