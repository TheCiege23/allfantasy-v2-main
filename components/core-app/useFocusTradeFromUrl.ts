'use client'

import { useEffect } from 'react'

/**
 * Bring the trade a link points at into view: `/core/trades?league=…&trade=<sleeperTransactionId>`.
 *
 * WHY. Trade emails and pushes link to one specific trade, and the page used to open at the top
 * with that trade somewhere below three other panels — so "the email says a trade happened" and
 * "the league page shows it" did not meet even when the link was right. Any element carrying
 * `data-trade-id="<id>"` is a target; the first one found wins.
 *
 * ⚠ IT RE-SCROLLS WHILE THE PAGE ABOVE IS STILL LOADING, AND STOPS THE MOMENT THE MANAGER TOUCHES
 * ANYTHING. The builder and inbox above the history load after it and push it down; iOS Safari has
 * no CSS scroll anchoring to hold the position. Re-centring on resize for a few seconds keeps the
 * trade in view without ever fighting a manager who has started to scroll.
 *
 * `ready` lets a list that renders after a fetch say when its rows exist.
 */
export function useFocusTradeFromUrl(ready = true): void {
  useEffect(() => {
    if (!ready || typeof window === 'undefined') return
    const wanted = new URLSearchParams(window.location.search).get('trade')?.trim()
    if (!wanted) return
    const target = Array.from(document.querySelectorAll<HTMLElement>('[data-trade-id]')).find(
      (el) => el.dataset.tradeId === wanted,
    )
    if (!target) return

    target.dataset.tradeFocused = 'true'
    const smooth = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    target.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' })

    let stopped = false
    const stop = () => {
      stopped = true
    }
    const events = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const
    for (const e of events) window.addEventListener(e, stop, { once: true, passive: true })
    const startedAt = Date.now()
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (stopped || Date.now() - startedAt > 6000) {
              observer?.disconnect()
              return
            }
            target.scrollIntoView({ block: 'center' })
          })
    observer?.observe(document.body)

    return () => {
      observer?.disconnect()
      for (const e of events) window.removeEventListener(e, stop)
    }
  }, [ready])
}
