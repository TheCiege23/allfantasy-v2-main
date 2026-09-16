'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The league tab strip's horizontal scroller, which brings the current tab into
 * view.
 *
 * 🛑 THE STRIP HAS SCROLLED SINCE IT SHIPPED; NOTHING EVER SCROLLED IT. The set
 * started at five tabs, where everything fitted, and is now twelve. A scroller
 * always starts at `scrollLeft: 0`, so landing on Standings or Outlook — the
 * last two — put the reader on a screen whose tab was off the right-hand edge,
 * with the strip showing Overview as the only thing near the start. The tab bar
 * answers "where am I", and on a phone it was answering it about a different
 * screen.
 *
 * ⚠ `scrollLeft`, NOT `scrollIntoView`. `scrollIntoView` is permitted to scroll
 * every scrollable ancestor, including the document — so bringing a pill into
 * view horizontally would also yank the page vertically on arrival, which is a
 * worse bug than the one being fixed. Setting `scrollLeft` on the one element
 * that overflows cannot move anything else.
 *
 * ⚠ ONLY WHEN THE PILL IS ACTUALLY OUT OF VIEW. Re-centring a tab that is
 * already visible moves the strip under someone who has just scrolled it by
 * hand, for no gain. The common case — a set that fits, or a tab near the start
 * — must be a no-op.
 */
export function LeagueTabsScroller({
  activeKey,
  children,
}: {
  /** Re-runs the effect when the tab changes; not otherwise read. */
  activeKey: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  /* False until the first run has happened, so arrival is a jump and not a glide. */
  const settled = useRef(false)

  useEffect(() => {
    const scroller = ref.current
    if (!scroller) return

    const first = !settled.current
    settled.current = true

    const active = scroller.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) return

    /*
     * `offsetLeft` is relative to the nearest positioned ancestor. The pills sit
     * in a static `[role="listitem"]` inside a static scroller, so that ancestor
     * is the scroller itself and the value is already in its scroll coordinate
     * space. Measured against the element rather than assumed: if a future style
     * positions the strip, this is the line that has to change.
     */
    const pillStart = active.offsetLeft
    const pillEnd = pillStart + active.offsetWidth
    const viewStart = scroller.scrollLeft
    const viewEnd = viewStart + scroller.clientWidth

    /* Already fully visible — leave the reader's scroll position alone. */
    if (pillStart >= viewStart && pillEnd <= viewEnd) return

    const centred = pillStart - (scroller.clientWidth - active.offsetWidth) / 2
    const maxScroll = scroller.scrollWidth - scroller.clientWidth
    const left = Math.max(0, Math.min(centred, maxScroll))

    /*
     * A jump on first paint, a glide on a later tab change — and neither when
     * the reader has asked for reduced motion. `scrollTo` with a behavior is
     * safe here because it acts on this element only.
     */
    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    scroller.scrollTo({ left, behavior: first || reduced ? 'auto' : 'smooth' })
  }, [activeKey])

  return (
    <div className="af-lt-tabs" role="list" ref={ref}>
      {children}
    </div>
  )
}

export default LeagueTabsScroller
