'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'
import { CARD_USE_COOKIE, parseCardUsage, recordCardUse, serializeCardUsage } from '@/lib/core-app/homeCardOrder'

/**
 * The /core home's client-side behaviours, neither of which renders anything of its own:
 *
 *   HomeActivity  — records which card a tap came from (the card order's usage counts), and warms a
 *                   /core link the moment the reader shows intent to follow it.
 *   HomePrefetch  — warms the few destinations the home can predict, once the page has settled.
 *
 * ⚠ THERE IS DELIBERATELY NO SCROLL RESTORER HERE. One was written for the 2026-09-16 brief ("restore
 * position after navigating back") and removed the same day because it changed nothing measurable:
 * on Back, Next 14.2 serves the home from its router cache whatever the dynamic stale time, so the
 * page is already full height when the browser restores the position itself. Measured in Chromium
 * at 1280 and 390 wide — scrolled to 900px, opened Portfolio, waited 35s (past the 30s stale time),
 * pressed Back: 900px with the restorer and 900px with it disabled (a console marker proved the
 * disabled build was the one running). Add one back only with a case that fails without it.
 */

// ── Shared: can this connection afford speculative work? ────────────────────────────────────────

function connectionAllowsPrefetch(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  if (connection?.saveData) return false
  if (connection?.effectiveType && /(^|-)2g$/.test(connection.effectiveType)) return false
  return true
}

function isCoreHref(href: string | null): href is string {
  return Boolean(href && href.startsWith('/core') && !href.startsWith('//'))
}

// ── Usage + intent ──────────────────────────────────────────────────────────────────────────────

/** The per-page cap on intent prefetches. Each one is a full server render of a /core screen. */
const INTENT_PREFETCH_LIMIT = 6
/** How long a pointer must rest on a link before it counts as intent, not a pass-over. */
const INTENT_DWELL_MS = 120

function readCookie(name: string): string | null {
  try {
    const match = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))
    return match ? match.slice(name.length + 1) : null
  } catch {
    return null
  }
}

/**
 * Wraps the home. Its listeners sit on one element, not on every card and link.
 *
 * ⚠ ONLY TAPS ON SOMETHING ACTIONABLE COUNT — a link or a button inside a `[data-home-card]`. A tap
 * on a card's empty space is not use, and counting it would let idle scrolling reorder the home.
 *
 * ⚠ INTENT PREFETCH IS CAPPED AND DEDUPED. `router.prefetch` defaults to a FULL prefetch, which on
 * /core is a real server render (Next only prefetches as far as `loading.tsx` for a plain dynamic
 * `<Link>`, which is the skeleton the page already shows). Six per page view, one per URL.
 */
export function HomeActivity({ children }: { children: ReactNode }) {
  const router = useRouter()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const warmed = new Set<string>()
    let dwell: number | null = null

    const warm = (href: string) => {
      if (warmed.has(href) || warmed.size >= INTENT_PREFETCH_LIMIT || !connectionAllowsPrefetch()) return
      warmed.add(href)
      try {
        router.prefetch(href)
      } catch {
        // A prefetch is an optimisation; failing it changes nothing the reader sees.
      }
    }

    const linkFrom = (target: EventTarget | null): string | null => {
      const anchor = (target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank') return null
      const href = anchor.getAttribute('href')
      return isCoreHref(href) ? href : null
    }

    const onOver = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      const href = linkFrom(event.target)
      if (dwell != null) window.clearTimeout(dwell)
      dwell = href ? window.setTimeout(() => warm(href), INTENT_DWELL_MS) : null
    }
    const onImmediate = (event: Event) => {
      const href = linkFrom(event.target)
      if (href) warm(href)
    }
    const onClick = (event: MouseEvent) => {
      const actionable = (event.target as Element | null)?.closest?.('a[href], button')
      if (!actionable) return
      const card = actionable.closest('[data-home-card]')?.getAttribute('data-home-card')
      if (!card) return
      try {
        const next = recordCardUse(parseCardUsage(readCookie(CARD_USE_COOKIE)), card)
        const secure = window.location.protocol === 'https:' ? '; secure' : ''
        document.cookie = `${CARD_USE_COOKIE}=${encodeURIComponent(serializeCardUsage(next))}; path=/core; max-age=${60 * 60 * 24 * 90}; samesite=lax${secure}`
      } catch {
        // No cookie, no personalisation — the designed order still stands.
      }
    }

    root.addEventListener('pointerover', onOver)
    root.addEventListener('touchstart', onImmediate, { passive: true })
    root.addEventListener('focusin', onImmediate)
    root.addEventListener('click', onClick, true)
    return () => {
      if (dwell != null) window.clearTimeout(dwell)
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('touchstart', onImmediate)
      root.removeEventListener('focusin', onImmediate)
      root.removeEventListener('click', onClick, true)
    }
  }, [router])

  return (
    <div ref={rootRef} className="af-home-activity" style={{ display: 'contents' }}>
      {children}
    </div>
  )
}

// ── Predicted destinations ──────────────────────────────────────────────────────────────────────

/**
 * Warms the destinations the server predicted (the most urgent league, the screen its top decision
 * points at, notifications when some are unread…), one at a time, after the page has finished
 * loading and the browser is idle.
 *
 * ⚠ AFTER `load`, NOT ON MOUNT. The home's own cards are still streaming when this mounts; a
 * prefetch then competes with them on the same server and makes the page the reader is looking at
 * slower, to speed up one they may never open.
 *
 * ⚠ DOES NOTHING IN `next dev` — Next disables prefetching there entirely, so a dev-server probe
 * shows zero requests whether this works or not. Verify the decisions in a unit test, not a network
 * panel.
 */
export function HomePrefetch({ targets }: { targets: string[] }) {
  const router = useRouter()
  const key = targets.join('|')

  useEffect(() => {
    const list = key ? key.split('|').filter(isCoreHref) : []
    if (list.length === 0) return
    let cancelled = false
    const timers: number[] = []

    const run = () => {
      if (cancelled || !connectionAllowsPrefetch()) return
      list.forEach((href, index) => {
        timers.push(
          window.setTimeout(() => {
            if (cancelled || document.visibilityState !== 'visible') return
            try {
              router.prefetch(href)
            } catch {
              // optimisation only
            }
          }, index * 800),
        )
      })
    }
    const idle = () => {
      const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
      if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 })
      else timers.push(window.setTimeout(run, 1500))
    }

    if (document.readyState === 'complete') idle()
    else window.addEventListener('load', idle, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('load', idle)
      for (const t of timers) window.clearTimeout(t)
    }
  }, [key, router])

  return null
}
