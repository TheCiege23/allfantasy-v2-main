'use client'

import { useEffect, useRef } from 'react'

/**
 * Re-run `refresh` when the manager comes back to the page, and on an interval while it stays in
 * view.
 *
 * 🛑 WHY: A TRADE SCREEN READ ONCE AND THEN SAT THERE (2026-09-25). A Sleeper offer sent while the
 * inbox was open never appeared until the manager navigated away and back — nothing on the screen
 * ever asked again. Mobile webviews do not remount on return either, so the first read could stay
 * on screen for the whole session.
 *
 * ⚠ ONLY WHILE VISIBLE. A hidden tab polling is provider calls nobody sees; the interval skips while
 * hidden and the return itself triggers one refresh.
 *
 * ⚠ ONE REFRESH AT A TIME, AND NOT TWICE FOR ONE RETURN. Returning to a tab fires BOTH `focus` and
 * `visibilitychange`, so without a minimum gap every return was two full reads. A refresh still in
 * flight is never stacked on, so a slow read cannot pile up behind the interval.
 */
export function useVisibleRefresh(
  refresh: () => unknown,
  opts: { intervalMs?: number | null; enabled?: boolean; minGapMs?: number } = {},
): void {
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })

  const { intervalMs = 60_000, enabled = true, minGapMs = 5_000 } = opts

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || typeof document === 'undefined') return
    // The component's own mount load has just run; the first return must not repeat it.
    let last = Date.now()
    let inFlight = false

    const fire = () => {
      if (inFlight || Date.now() - last < minGapMs) return
      last = Date.now()
      inFlight = true
      Promise.resolve()
        .then(() => latest.current())
        .catch(() => {
          // The caller owns error display; a failed background refresh must not throw into React.
        })
        .finally(() => {
          inFlight = false
        })
    }
    const visible = () => document.visibilityState === 'visible'
    const onFocus = () => fire()
    const onVisibility = () => {
      if (visible()) fire()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    const timer = intervalMs && intervalMs > 0 ? window.setInterval(() => (visible() ? fire() : undefined), intervalMs) : null
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      if (timer != null) window.clearInterval(timer)
    }
  }, [enabled, intervalMs, minGapMs])
}
