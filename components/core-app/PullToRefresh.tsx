'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { startClientSync } from '@/lib/core-app/clientSyncJob'
import { pullAxis, pullDistance, pullIsReady, pullStartBlocked, type PullTargetNode } from '@/lib/core-app/pullToRefresh'
import './af-pull-refresh.css'

/**
 * Pull to refresh on a phone (see lib/core-app/pullToRefresh.ts for the rules).
 *
 * What a refresh does, in order:
 *   1. `router.refresh()` — the screen's server loaders run again and the page updates in place, no
 *      reload, scroll and open state kept. The indicator spins until that transition settles.
 *   2. When the leagues themselves are stale (`syncStale`, the shell's own sync-age rule), the same
 *      background sync "Sync now" runs. Pulling on a fresh account never hits a provider.
 *
 * ⚠ THE LISTENERS ARE PASSIVE AND NEVER CALL preventDefault, so scrolling is exactly what it was. The
 * gesture only counts at the very top of the page, vertically, outside anything that scrolls on its
 * own; a sideways league swipe and a pull cannot both fire, because each locks its own axis.
 *
 * ⚠ THE ROUTER IS READ THROUGH A REF, for the reason LeagueSwipe.tsx found the hard way: the indicator
 * re-renders on every touchmove, and a router dependency would rebind the listeners mid-gesture.
 */
type Phase = 'idle' | 'pulling' | 'refreshing' | 'done'

function asNode(el: Element | null): PullTargetNode | null {
  if (!el || el === document.body || el === document.documentElement) return null
  return {
    tagName: el.tagName,
    isContentEditable: (el as HTMLElement).isContentEditable,
    getAttribute: (name) => el.getAttribute(name),
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    get overflowY() {
      return window.getComputedStyle(el).overflowY
    },
    get parentElement() {
      return asNode(el.parentElement)
    },
  }
}

function pageScrollTop(): number {
  return Math.max(window.scrollY || 0, document.scrollingElement?.scrollTop ?? 0)
}

/** A scroll-locked page (an open modal or tray) is not a page anyone is pulling. */
function scrollLocked(): boolean {
  const b = document.body.style.overflow
  const h = document.documentElement.style.overflow
  return b === 'hidden' || h === 'hidden'
}

export function PullToRefresh({ syncStale = false }: { syncStale?: boolean }) {
  const router = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const staleRef = useRef(syncStale)
  staleRef.current = syncStale
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const [pending, startTransition] = useTransition()
  const [phase, setPhase] = useState<Phase>('idle')
  const [distance, setDistance] = useState(0)
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase

  useEffect(() => {
    let start: { x: number; y: number } | null = null
    let axis: 'pull' | 'other' | null = null
    let travelled = 0

    const reset = () => {
      start = null
      axis = null
      travelled = 0
      if (phaseRef.current === 'pulling') {
        setPhase('idle')
        setDistance(0)
      }
    }
    const onStart = (e: TouchEvent) => {
      if (phaseRef.current === 'refreshing' || e.touches.length !== 1 || scrollLocked()) return reset()
      const t = e.touches[0]!
      if (pullStartBlocked(asNode(e.target as Element), pageScrollTop())) return reset()
      start = { x: t.clientX, y: t.clientY }
      axis = null
    }
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return
      const t = e.touches[0]!
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      axis = axis ?? pullAxis(dx, dy)
      // The page scrolled under the finger after all: this was a scroll, not a pull.
      if (axis !== 'pull' || pageScrollTop() > 0) {
        if (axis === 'other' || pageScrollTop() > 0) reset()
        return
      }
      travelled = pullDistance(dy)
      setPhase('pulling')
      setDistance(travelled)
    }
    const onEnd = () => {
      if (!start) return
      const ready = axis === 'pull' && pullIsReady(travelled)
      start = null
      axis = null
      travelled = 0
      if (!ready) {
        setPhase('idle')
        setDistance(0)
        return
      }
      setPhase('refreshing')
      setDistance(48)
      try {
        navigator.vibrate?.(8)
      } catch {
        /* Haptics are a nicety; the refresh is the point. */
      }
      if (staleRef.current) void startClientSync().catch(() => undefined)
      startTransition(() => routerRef.current.refresh())
    }

    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', reset, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', reset)
    }
  }, [])

  /*
   * The refresh transition settled: say so briefly, then get out of the way.
   *
   * ⚠ ONLY AFTER PENDING WAS SEEN. The first render after release can still read `pending` as false —
   * the transition has been asked for, not yet started — and finishing on that would say "Up to date"
   * before anything refreshed. A ten-second ceiling covers a refresh that never reports at all.
   */
  const sawPending = useRef(false)
  if (pending) sawPending.current = true
  useEffect(() => {
    if (phase !== 'refreshing') return
    if (pending || !sawPending.current) {
      const ceiling = window.setTimeout(() => setPhase('done'), 10_000)
      return () => window.clearTimeout(ceiling)
    }
    setPhase('done')
  }, [phase, pending])
  /*
   * ⚠ ITS OWN EFFECT. In the one above, moving to `done` changes that effect's dependencies, so its
   * cleanup would cancel this timer and the indicator would never leave the screen.
   */
  useEffect(() => {
    if (phase !== 'done') return
    sawPending.current = false
    const t = window.setTimeout(() => {
      setPhase('idle')
      setDistance(0)
    }, 700)
    return () => window.clearTimeout(t)
  }, [phase])

  const ready = pullIsReady(distance)
  const label =
    phase === 'refreshing'
      ? es ? 'Actualizando…' : 'Refreshing…'
      : phase === 'done'
        ? es ? 'Al día' : 'Up to date'
        : ready
          ? es ? 'Suelta para actualizar' : 'Release to refresh'
          : es ? 'Desliza para actualizar' : 'Pull to refresh'

  return (
    <div
      className="af-ptr"
      data-phase={phase}
      data-ready={ready ? 'true' : undefined}
      style={{ transform: `translate(-50%, ${phase === 'idle' ? -60 : distance - 44}px)`, opacity: phase === 'idle' ? 0 : 1 }}
      aria-hidden={phase === 'idle'}
    >
      <span className="af-ptr-icon" aria-hidden style={phase === 'pulling' ? { transform: `rotate(${(distance / 64) * 180}deg)` } : undefined}>
        {phase === 'done' ? '✓' : phase === 'refreshing' ? '⟳' : '↓'}
      </span>
      <span className="af-ptr-label" role="status" aria-live="polite">
        {phase === 'idle' ? '' : label}
      </span>
    </div>
  )
}

export default PullToRefresh
