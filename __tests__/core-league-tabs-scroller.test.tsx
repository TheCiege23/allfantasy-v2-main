import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeagueTabsScroller } from '@/components/core-app/LeagueTabsScroller'

/**
 * Bringing the current league tab into view.
 *
 * 🛑 THE GEOMETRY BELOW IS THE CASE THAT BROKE THE FIRST VERSION, MEASURED, NOT
 * INVENTED. In Chromium, with the strip static inside an ancestor positioned
 * 265px to its left (the shell's rail plus padding), a tab at x=900 in the strip
 * reported `offsetLeft` 1165 — because `offsetLeft` counts from the nearest
 * POSITIONED ancestor and a static strip is never one. The rect difference read
 * 900 in every case measured. So `offsetLeft` is stubbed here to the value a
 * browser actually returns, and a scroller that reads it fails these tests.
 *
 * jsdom has no layout, so every dimension is stubbed. That makes this a test of
 * the arithmetic against real-browser inputs; that the inputs ARE what a browser
 * returns is the measurement above, not something this file can show.
 */

const RAIL_OFFSET = 265 // where the positioned ancestor puts the strip
const BORDER = 1
const VIEW = 368 // strip clientWidth
const CONTENT = 1091 // strip scrollWidth
const PILL = 80

type Geometry = { pillAt: number; scrollLeft?: number }

let geometry: Geometry = { pillAt: 0 }
const scrollTo = vi.fn()
const restore: Array<() => void> = []

function stub<K extends keyof HTMLElement>(key: K, get: (el: HTMLElement) => unknown) {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)
  Object.defineProperty(HTMLElement.prototype, key, {
    configurable: true,
    get(this: HTMLElement) {
      return get(this)
    },
  })
  restore.push(() => {
    if (original) Object.defineProperty(HTMLElement.prototype, key, original)
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key as string]
  })
}

const isStrip = (el: HTMLElement) => el.getAttribute('role') === 'list'
const isPill = (el: HTMLElement) => el.dataset.active === 'true'

beforeEach(() => {
  scrollTo.mockClear()
  const scrollLeft = () => geometry.scrollLeft ?? 0

  stub('clientWidth', (el) => (isStrip(el) ? VIEW : 0))
  stub('scrollWidth', (el) => (isStrip(el) ? CONTENT : 0))
  stub('clientLeft', (el) => (isStrip(el) ? BORDER : 0))
  stub('scrollLeft', (el) => (isStrip(el) ? scrollLeft() : 0))
  stub('offsetWidth', (el) => (isPill(el) ? PILL : 0))
  /* What a browser returns for a static strip: measured from the positioned ancestor. */
  stub('offsetLeft', (el) => (isPill(el) ? RAIL_OFFSET + geometry.pillAt : 0))

  const originalRect = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const left = isStrip(this)
      ? RAIL_OFFSET
      : isPill(this)
        ? RAIL_OFFSET + BORDER + geometry.pillAt - scrollLeft()
        : 0
    return { left, right: left, top: 0, bottom: 0, width: 0, height: 0, x: left, y: 0, toJSON() {} } as DOMRect
  }
  restore.push(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect
  })

  const originalScrollTo = HTMLElement.prototype.scrollTo
  HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo']
  restore.push(() => {
    HTMLElement.prototype.scrollTo = originalScrollTo
  })
})

afterEach(() => {
  while (restore.length) restore.pop()!()
})

function strip() {
  return render(
    <LeagueTabsScroller activeKey="standings">
      <span role="listitem">
        <a href="/core" data-active="false">
          Overview
        </a>
      </span>
      <span role="listitem">
        <a href="/core/standings" data-active="true">
          Standings
        </a>
      </span>
    </LeagueTabsScroller>,
  )
}

describe('LeagueTabsScroller', () => {
  it('centres an off-screen tab by its position in the strip, not in the shell', () => {
    geometry = { pillAt: 400 }
    strip()

    /* 400 - (368 - 80) / 2. Reading offsetLeft would have produced 521. */
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ left: 256, behavior: 'auto' })
  })

  it('leaves the strip alone when the tab is already fully visible', () => {
    /* x=100..180 inside a 368px view. offsetLeft (365) would call it off-screen. */
    geometry = { pillAt: 100 }
    strip()

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('accounts for a strip the reader has already scrolled', () => {
    /* Visible at 300..380 of content only if the view starts at >= 12. */
    geometry = { pillAt: 300, scrollLeft: 50 }
    strip()

    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('clamps to the end of the strip for the last tabs', () => {
    geometry = { pillAt: 1000 }
    strip()

    expect(scrollTo).toHaveBeenCalledWith({ left: CONTENT - VIEW, behavior: 'auto' })
  })
})
