'use client'

import { useEffect, useLayoutEffect, type RefObject } from 'react'

/**
 * Keeps the league rail where the user left it.
 *
 * 🛑 THE RAIL IS REBUILT ON MOST LEAGUE CLICKS, SO ITS SCROLL POSITION WAS LOST. Every tile links to
 * `/core?league=…`. From any other screen (`/core/my-team?league=A`, `/core/portfolio`, …) that
 * changes the `[[...screen]]` segment, and Next unmounts the page — which renders the shell, rail
 * included; there is no `app/core/layout.tsx` — and mounts a fresh one. `.af-rail-scroll` then
 * starts at the top, and a user who scrolled down to their thirtieth league lands back at the
 * first (user report, 2026-09-16).
 *
 * The position is saved to sessionStorage as the user scrolls and at the moment a tile is
 * pressed, and restored in a layout effect, before the rebuilt rail paints. After restoring, the
 * active tile is scrolled into view only if it is not already — a league picked some other way
 * (the scope switcher, search) must not be left off-screen.
 *
 * ⚠ ONE POSITION PER LAYOUT. The phone tray, the expanded rail and the collapsed crest column
 * have different row heights, so a pixel offset from one means nothing in another; each is kept
 * under its own key. `layout` is null until the shell knows which layout it is in, and nothing is
 * read or written until then — the desktop preference is unread on first render, and saving under
 * a guessed layout would overwrite the right one.
 *
 * ⚠ RECT MATH, NOT `offsetTop`. `offsetTop` is measured from the nearest POSITIONED ancestor, which
 * is not the scroller here — the same mistake `LeagueTabsScroller` shipped once with `offsetLeft`.
 */

export type RailLayout = 'tray' | 'open' | 'collapsed'

export const RAIL_SCROLL_KEY_PREFIX = 'af-rail-scroll:'

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function readSaved(layout: RailLayout): number | null {
  try {
    const raw = window.sessionStorage.getItem(RAIL_SCROLL_KEY_PREFIX + layout)
    if (raw == null) return null
    const top = Number(raw)
    return Number.isFinite(top) && top >= 0 ? top : null
  } catch {
    return null
  }
}

/** Save where the rail is now. Safe to call from an event handler; a no-op without a layout. */
export function saveRailScroll(el: HTMLElement | null, layout: RailLayout | null): void {
  if (!el || !layout) return
  try {
    window.sessionStorage.setItem(RAIL_SCROLL_KEY_PREFIX + layout, String(Math.round(el.scrollTop)))
  } catch {
    /* storage unavailable: the rail still works, it just forgets */
  }
}

/** Scroll the smallest distance that shows `tile` inside `scroller`. */
export function keepTileInView(scroller: HTMLElement, tile: HTMLElement): void {
  const box = scroller.getBoundingClientRect()
  const rect = tile.getBoundingClientRect()
  if (rect.top < box.top) scroller.scrollTop -= box.top - rect.top
  else if (rect.bottom > box.bottom) scroller.scrollTop += rect.bottom - box.bottom
}

export function useRailScrollMemory(
  scrollerRef: RefObject<HTMLElement>,
  layout: RailLayout | null,
  activeLeagueId: string | null,
): void {
  useIsomorphicLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || !layout) return
    const saved = readSaved(layout)
    if (saved != null) el.scrollTop = saved
    const active = el.querySelector<HTMLElement>('[data-active="true"]')
    if (active) keepTileInView(el, active)
  }, [scrollerRef, layout, activeLeagueId])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !layout) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        saveRailScroll(el, layout)
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [scrollerRef, layout])
}
