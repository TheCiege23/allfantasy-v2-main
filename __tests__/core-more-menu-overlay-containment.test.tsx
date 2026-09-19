import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 🛑 "MORE" WAS THE ONE /core OVERLAY THAT NEVER ADOPTED `useOverlayContainment`.
 *
 * It hand-rolled its own `document.body.style.overflow` value and its own `document` Escape
 * listener — precisely the two things that hook's docblock says no overlay may own alone,
 * because "the previous value" is not a property any single overlay can hold and a `document`
 * listener cannot know whether it is the topmost dialog.
 *
 * Both failures the docblock numbers are reachable in ONE GESTURE here, because the league tray
 * is a tap away on the same bar. These pin them.
 *
 * ⚠ jsdom LAYS NOTHING OUT, so nothing in this file can tell you the sheet covers the page. What
 * it can tell you — and what a refactor silently breaks — is the BOOKKEEPING: who owns the scroll
 * lock, and which overlay answers Escape. Same limit, and same reason, as
 * `core-rail-default-open.test.tsx` states for the rail's attribute assertions.
 */

/*
 * 🛑 ONE ROUTER OBJECT, NOT ONE PER CALL. The shell's rail-clock effect depends on `router` and
 * sets state synchronously; a fresh object per render loops forever inside act() and the suite
 * hangs silently. Copied from core-rail-default-open.test.tsx, which learned it the hard way.
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
 * ⚠ jsdom SHIPS NO `matchMedia`, so without this the shell's own try/catch swallows a TypeError
 * and every test silently exercises the "no matchMedia" branch — including the ones meant to
 * prove the phone branch works.
 */
function setPhoneViewport() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: !query.includes('min-width: 721px'),
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

const moreButton = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>('.af-tabbar-item')).find(
    (b) => b.textContent?.includes('More'),
  )!
const moreSheet = (c: HTMLElement) => c.querySelector('#af-mobile-more')
const railHandle = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.af-rail-handle')!
const railOpen = (c: HTMLElement) =>
  c.querySelector('.af-shell')?.getAttribute('data-rail-open') === 'true'

/**
 * 🛑 WITHOUT THIS, THE FOCUS ASSERTIONS CANNOT PASS — NOT BECAUSE THE CODE IS WRONG.
 *
 * `useOverlayContainment`'s `isFocusable` tests `el.getClientRects().length > 0`, which is the
 * cheap way to rule out `display: none` and detached nodes. jsdom performs no layout, so it
 * returns an EMPTY list for every element alive or not — making every node unfocusable, so
 * restoration silently drops focus to `<body>` and a correct implementation looks broken.
 *
 * Stubbing it is the same accommodation this suite already makes for `matchMedia`: jsdom is
 * missing a browser capability the component legitimately depends on. It is scoped to this file
 * and reverted after each test.
 */
const realGetClientRects = Element.prototype.getClientRects

beforeEach(() => {
  setPhoneViewport()
  Element.prototype.getClientRects = function getClientRects(this: Element) {
    return [{ width: 10, height: 10 }] as unknown as DOMRectList
  }
  window.localStorage.clear()
  document.body.style.overflow = ''
})

afterEach(() => {
  Element.prototype.getClientRects = realGetClientRects
  vi.restoreAllMocks()
  window.localStorage.clear()
  document.body.style.overflow = ''
})

describe('the More sheet joins the shared overlay stack', () => {
  it('opens and closes on its own without leaving the page locked', () => {
    const { container } = render(shell())
    expect(moreSheet(container)).toBeNull()

    fireEvent.click(moreButton(container))
    expect(moreSheet(container)).not.toBeNull()
    expect(document.body.style.overflow).toBe('hidden')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(moreSheet(container)).toBeNull()
    expect(document.body.style.overflow).toBe('')
  })

  /*
   * 🛑 FAILURE 1 FROM THE HOOK'S DOCBLOCK, REACHED ON THE PHONE BAR.
   *
   * The hand-rolled lock captured `document.body.style.overflow` for itself. Open More, open the
   * tray, close More FIRST — its cleanup writes back the `''` it captured, unlocking a page that
   * still has a modal tray over it — then close the tray, whose shared lock restores the
   * `hidden` it believed was the real previous value. The page ends LOCKED with nothing open,
   * and only a reload clears it.
   */
  it('leaves the page scrollable when both overlays have closed, whatever the order', () => {
    const { container } = render(shell())

    fireEvent.click(moreButton(container))
    fireEvent.click(railHandle(container))
    expect(railOpen(container)).toBe(true)
    expect(moreSheet(container)).not.toBeNull()

    /* The order that breaks it: the one opened FIRST is closed first. */
    fireEvent.click(container.querySelector('.af-mobile-more-scrim') as HTMLButtonElement)
    expect(moreSheet(container)).toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(railOpen(container)).toBe(false)

    expect(document.body.style.overflow).toBe('')
  })

  /*
   * 🛑 FAILURE 2. Two independent `document` Escape listeners both fired, so one key closed every
   * open overlay. Only the topmost may answer.
   */
  it('peels one layer per Escape instead of closing everything at once', () => {
    const { container } = render(shell())

    fireEvent.click(railHandle(container))
    expect(railOpen(container)).toBe(true)
    fireEvent.click(moreButton(container))
    expect(moreSheet(container)).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })

    /* The sheet went; the tray underneath it did not. */
    expect(moreSheet(container)).toBeNull()
    expect(railOpen(container)).toBe(true)
  })

  /*
   * ⚠ THE SCRIM MUST SURVIVE THE INERT SWEEP. It is a SIBLING of the sheet, so a naive sweep
   * disables it — and it is the control a thumb reaches for first. `keepClickableRefs` is what
   * exempts it, and this is the assertion that the ref is actually wired to it.
   */
  it('keeps the scrim clickable while the sheet is modal', () => {
    const { container } = render(shell())
    fireEvent.click(moreButton(container))

    const scrim = container.querySelector('.af-mobile-more-scrim') as HTMLButtonElement
    expect(scrim).not.toBeNull()
    expect(scrim.inert).not.toBe(true)

    fireEvent.click(scrim)
    expect(moreSheet(container)).toBeNull()
  })

  /*
   * ⚠ AND THE CONTROL AGAINST OVER-ROTATING: closing must hand focus BACK to the More button,
   * not leave it on `<body>`, which is where a keyboard user was dropped before.
   */
  it('returns focus to the More button when the sheet closes', () => {
    const { container } = render(shell())
    const button = moreButton(container)

    button.focus()
    fireEvent.click(button)
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(document.activeElement).toBe(button)
  })
})
