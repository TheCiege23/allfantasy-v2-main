'use client'

import { useEffect, useRef } from 'react'
import { getPollIntervalMs } from '@/lib/chat-core/RealtimeMessageService'

/**
 * Near-realtime chat by polling.
 *
 * ⚠ NOTHING POLLED BEFORE THIS. Every chat surface loaded once on open and never
 * again, so a message arrived only when the reader happened to reopen the thread.
 * `RealtimeMessageService` has defined the cadence since it was written — 8s
 * idle, 4s while you are active — and had ZERO importers. There is no WebSocket
 * or SSE on the backend, which is why polling is the mechanism rather than a
 * stopgap.
 *
 * ⚠ IT STOPS WHEN THE TAB IS HIDDEN. A drawer left open in a background tab
 * would otherwise poll every four seconds forever, and the endpoints it hits are
 * rate-limited per user — a idle tab would spend the same budget the active one
 * needs. Polling resumes on the next visibility change, with an immediate
 * refresh so the reader is never looking at a stale thread they just returned to.
 *
 * ⚠ ONE REQUEST AT A TIME. A slow response must not let ticks pile up behind it;
 * a skipped tick costs at most one interval, whereas overlapping requests
 * multiply load exactly when the server is already slow.
 */
export function useChatPolling(args: {
  /** Re-fetch the thread. Must be stable — wrap it in useCallback. */
  refresh: () => Promise<void> | void
  /** Poll only while a thread is actually open and on screen. */
  enabled: boolean
  /** Recently typed or sent: polls at the faster cadence. */
  active?: boolean
}): void {
  const { refresh, enabled, active = false } = args

  // Held in a ref so a changing callback does not restart the interval.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const inFlight = useRef(false)

  useEffect(() => {
    if (!enabled) return
    if (typeof document === 'undefined') return

    let cancelled = false

    const tick = async () => {
      if (cancelled || inFlight.current) return
      if (document.visibilityState !== 'visible') return
      inFlight.current = true
      try {
        await refreshRef.current()
      } catch {
        // A failed poll is not an error state: the next tick tries again, and
        // surfacing it would put an error banner over a working conversation.
      } finally {
        inFlight.current = false
      }
    }

    const interval = window.setInterval(tick, getPollIntervalMs({ active }))

    /*
     * Coming back to the tab should not mean waiting out a full interval to see
     * what was missed.
     */
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, active])
}

/**
 * Is this element scrolled close enough to the bottom that new messages should
 * pull it down?
 *
 * Polling makes this matter: auto-scrolling on every arrival yanks the view away
 * from somebody reading back through the thread, which is worse than making them
 * scroll down themselves.
 */
export function isNearBottom(el: HTMLElement | null, slackPx = 80): boolean {
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slackPx
}
