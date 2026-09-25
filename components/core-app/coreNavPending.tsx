'use client'

import { createContext, useContext } from 'react'

import CoreScreenSkeleton from '@/components/core-app/CoreScreenSkeleton'

/**
 * The moment between clicking a /core tab and the new screen arriving.
 *
 * WHY. Every /core screen is one server render, and a render takes seconds (the shell's reads,
 * then that screen's loaders). Until 2026-09-25 the route's `loading.tsx` sat INSIDE the
 * `[[...screen]]` segment, and Next keys a segment's loading boundary on the segment's value — so
 * every tab click mounted a fresh boundary and repainted the ENTIRE app, rail and nav included,
 * as a skeleton. A manager clicking Trades saw the whole page blank and rebuild.
 *
 * The boundary now sits above the `(shell)` route group (app/core/loading.tsx), whose key never
 * changes between tabs. Next navigates inside a transition, so React keeps the current page on
 * screen instead of falling back. That removes the flash, and leaves a wait with nothing
 * happening — which is what this file answers: the link that was clicked lights up at once, and
 * the screen area (only the screen area; the rail, nav, league tabs and league bar stay exactly
 * as they are) shows the same skeleton the new screen will stream in behind.
 *
 * ⚠ OPT-IN BY `data-core-nav`, NOT EVERY ANCHOR. A player name, a card or a chip can be a link
 * that opens an overlay and never changes the URL. A skeleton raised for one of those would stay
 * up until the safety timeout, hiding the screen the manager is still on. Only links that are
 * known to navigate between /core screens carry the attribute.
 */

/** The attribute a link carries to take part. */
export const CORE_NAV_ATTRIBUTE = 'data-core-nav'

/** True while a /core navigation started by a marked link has not yet landed. */
export const CoreNavPendingContext = createContext(false)

/**
 * Where a click on a marked link is going, or null when the click is not a same-tab navigation to
 * another /core screen.
 *
 * Mirrors the checks `next/link` itself makes before navigating client-side (primary button, no
 * modifier, no foreign target, no download), because a click Link hands to the browser — a new
 * tab, a download — must never raise a skeleton over the page the manager is still reading.
 */
export function pendingCoreNavTarget(input: {
  href: string | null
  currentHref: string
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: string | null
  download: boolean
}): string | null {
  if (!input.href) return null
  if (input.button !== 0) return null
  if (input.metaKey || input.ctrlKey || input.shiftKey || input.altKey) return null
  if (input.target && input.target !== '_self') return null
  if (input.download) return null
  let next: URL
  let current: URL
  try {
    current = new URL(input.currentHref)
    next = new URL(input.href, current)
  } catch {
    return null
  }
  if (next.origin !== current.origin) return null
  if (next.pathname !== '/core' && !next.pathname.startsWith('/core/')) return null
  // A hash-only change, or the page already open, is not a navigation that will ever "arrive".
  if (next.pathname === current.pathname && next.search === current.search) return null
  return `${next.pathname}${next.search}`
}

/**
 * The screen area: the real screen, or — while a marked navigation is in flight — the screen
 * skeleton in its place.
 *
 * ⚠ THE SCREEN STAYS MOUNTED, ONLY HIDDEN. If the navigation is abandoned (the safety timeout,
 * a failed fetch) the manager gets back exactly the screen they left, scroll and open panels
 * included. `display: contents` keeps the wrapper out of layout, so the screen's own CSS sees
 * the parent it always had.
 */
export function CoreScreenArea({ children }: { children: React.ReactNode }) {
  const pending = useContext(CoreNavPendingContext)
  return (
    <>
      {pending ? <CoreScreenSkeleton /> : null}
      <div style={{ display: pending ? 'none' : 'contents' }}>{children}</div>
    </>
  )
}
