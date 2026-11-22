'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Keep the draft board's manager header row pinned to the top of whatever is scrolling, so lower
 * rounds still show who drafted each column.
 *
 * Why not `position: sticky`: the header sits inside the board's sideways scroller
 * (`overflow-x-auto`), and an `overflow-x` other than `visible` forces `overflow-y` to `auto`. That
 * makes the scroller the header's sticky container — and it never scrolls vertically — so sticky
 * silently did nothing. The vertical scroll belongs to an ancestor that differs by layout (desktop
 * board zone, tablet column, the phone's scroll root under its own sticky bar), and moving the header
 * out of the sideways scroller would split it from the grid whose column widths it has to share.
 * So the header stays put and is translated down by exactly the distance the board has scrolled
 * under the top of the visible area.
 */

/** How far to push the header down: 0 until the grid's top passes the pin line, never past the grid. */
export function stickyHeaderOffset(input: {
  pinLine: number
  gridTop: number
  gridHeight: number
  headerHeight: number
}): number {
  const { pinLine, gridTop, gridHeight, headerHeight } = input
  const max = Math.max(0, gridHeight - headerHeight)
  return Math.min(max, Math.max(0, Math.round(pinLine - gridTop)))
}

function isScrollableY(el: Element): boolean {
  const oy = getComputedStyle(el).overflowY
  return (oy === 'auto' || oy === 'scroll' || oy === 'overlay') && el.scrollHeight > el.clientHeight + 1
}

/** Nearest ancestor that actually scrolls vertically, or null for the window. */
function findVerticalScroller(start: Element | null): HTMLElement | null {
  let el = start?.parentElement ?? null
  while (el && el !== document.body && el !== document.documentElement) {
    if (isScrollableY(el)) return el
    el = el.parentElement
  }
  return null
}

/** Height of sticky bars pinned at the top of the scroller (the phone room has one). */
function pinnedBarHeight(scroller: HTMLElement): number {
  let h = 0
  for (const child of Array.from(scroller.children)) {
    if (!(child instanceof HTMLElement)) continue
    const cs = getComputedStyle(child)
    if (cs.position === 'sticky' && (cs.top === '0px' || cs.top === '0')) h += child.offsetHeight
  }
  return h
}

export function useStickyBoardHeader(
  gridRef: RefObject<HTMLElement | null>,
  headerRef: RefObject<HTMLElement | null>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const grid = gridRef.current
    const header = headerRef.current
    if (!grid || !header) return

    let scroller: HTMLElement | null = null
    let target: HTMLElement | Window = window
    let frame = 0

    const apply = () => {
      frame = 0
      const g = gridRef.current
      const h = headerRef.current
      if (!g || !h) return
      // Measure the grid, not the header: the header's own transform moves its rect.
      const gridRect = g.getBoundingClientRect()
      const pinLine = scroller ? scroller.getBoundingClientRect().top + pinnedBarHeight(scroller) : 0
      const offset = stickyHeaderOffset({
        pinLine,
        gridTop: gridRect.top,
        gridHeight: gridRect.height,
        headerHeight: h.offsetHeight,
      })
      const next = offset > 0 ? `translateY(${offset}px)` : ''
      if (h.style.transform !== next) h.style.transform = next
      h.dataset.pinned = offset > 0 ? 'true' : 'false'
    }
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply)
    }
    const bind = () => {
      target.removeEventListener('scroll', schedule)
      scroller = findVerticalScroller(grid)
      target = scroller ?? window
      target.addEventListener('scroll', schedule, { passive: true })
      schedule()
    }

    bind()
    // Layout changes (dock resize, tab switch, rows arriving) can change which ancestor scrolls.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(bind) : null
    ro?.observe(grid)
    window.addEventListener('resize', bind)
    return () => {
      target.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', bind)
      ro?.disconnect()
      if (frame) window.cancelAnimationFrame(frame)
      header.style.transform = ''
    }
  }, [gridRef, headerRef, enabled])
}
