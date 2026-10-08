'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import {
  classifySwipe,
  leagueSwipeHref,
  lockAxis,
  neighborLeagues,
  swipeStartBlocked,
  SWIPE_MIN_PX,
  type SwipeLeague,
  type SwipeTargetNode,
} from '@/lib/core-app/leagueSwipe'
import './af-league-swipe.css'

/**
 * Swipe between leagues on a phone (see lib/core-app/leagueSwipe.ts for the rules).
 *
 * Two halves, and the second is not optional:
 *   - the GESTURE: a horizontal swipe on the screen content moves to the previous/next league on the
 *     same screen, with a peek pill naming where you are about to land;
 *   - the PAGER: a slim "‹ prev · 3 / 12 · next ›" row with real links. A swipe-only control is
 *     invisible until someone is told about it and unusable with a switch or screen reader; the
 *     pager is how the gesture is discovered and the accessible way to do the same thing.
 *
 * ⚠ THE LISTENERS ARE PASSIVE AND NEVER CALL preventDefault. Vertical scrolling must stay exactly as
 * it is; this only watches. A swipe that starts at a screen edge, in a form control, or inside
 * anything that scrolls sideways (chip rows, tables) is ignored — those gestures belong to the OS
 * or to the element.
 */
function asNode(el: Element | null, stop: Element | null): SwipeTargetNode | null {
  if (!el || el === stop) return null
  return {
    tagName: el.tagName,
    isContentEditable: (el as HTMLElement).isContentEditable,
    getAttribute: (name) => el.getAttribute(name),
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    get overflowX() {
      return window.getComputedStyle(el).overflowX
    },
    get parentElement() {
      return asNode(el.parentElement, stop)
    },
  }
}

export function LeagueSwipe({
  leagues,
  selectedLeagueId,
  targetId = 'af-content',
}: {
  leagues: SwipeLeague[]
  selectedLeagueId: string
  targetId?: string
}) {
  const router = useRouter()
  const pathname = usePathname() ?? '/core'
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const nav = neighborLeagues(leagues, selectedLeagueId)
  const [peek, setPeek] = useState<{ dir: 'next' | 'prev'; progress: number } | null>(null)
  const navRef = useRef(nav)
  navRef.current = nav
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  /*
   * ⚠ THE ROUTER IS READ THROUGH A REF, NOT AN EFFECT DEPENDENCY. The peek re-renders this component
   * on every touchmove; with `router` as a dependency, any render that hands back a new router object
   * tears the listeners down mid-gesture and the touch start is lost — the swipe silently does
   * nothing. The listeners are bound once per target and read the latest router, path and
   * neighbours from refs.
   */
  const routerRef = useRef(router)
  routerRef.current = router

  useEffect(() => {
    const target = document.getElementById(targetId)
    if (!target) return
    let start: { x: number; y: number; t: number } | null = null
    let axis: 'x' | 'y' | null = null
    let warmed = false

    const reset = () => {
      start = null
      axis = null
      warmed = false
      setPeek(null)
    }
    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return reset()
      const t = e.touches[0]!
      if (swipeStartBlocked(asNode(e.target as Element, target.parentElement), t.clientX, window.innerWidth)) return reset()
      start = { x: t.clientX, y: t.clientY, t: Date.now() }
      axis = null
    }
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return
      const t = e.touches[0]!
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      axis = axis ?? lockAxis(dx, dy)
      if (axis !== 'x') return
      const dir = dx < 0 ? 'next' : 'prev'
      const to = dir === 'next' ? navRef.current?.next : navRef.current?.prev
      if (!to) return setPeek(null)
      // A head start on the page the swipe is heading for, once per gesture, and never on Save-Data.
      if (!warmed) {
        warmed = true
        const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
        if (!saveData) routerRef.current.prefetch(leagueSwipeHref(pathRef.current, to.id))
      }
      setPeek({ dir, progress: Math.min(1, Math.abs(dx) / SWIPE_MIN_PX) })
    }
    const onEnd = (e: TouchEvent) => {
      if (!start) return reset()
      const t = e.changedTouches[0]
      const verdict = t && axis === 'x' ? classifySwipe({ dx: t.clientX - start.x, dy: t.clientY - start.y, ms: Date.now() - start.t }) : null
      const to = verdict === 'next' ? navRef.current?.next : verdict === 'prev' ? navRef.current?.prev : null
      reset()
      if (!to) return
      try {
        navigator.vibrate?.(8)
      } catch {
        /* Some browsers throw on vibrate without a user-activation; the switch matters, the buzz does not. */
      }
      routerRef.current.push(leagueSwipeHref(pathRef.current, to.id))
    }

    target.addEventListener('touchstart', onStart, { passive: true })
    target.addEventListener('touchmove', onMove, { passive: true })
    target.addEventListener('touchend', onEnd, { passive: true })
    target.addEventListener('touchcancel', reset, { passive: true })
    return () => {
      target.removeEventListener('touchstart', onStart)
      target.removeEventListener('touchmove', onMove)
      target.removeEventListener('touchend', onEnd)
      target.removeEventListener('touchcancel', reset)
    }
  }, [targetId])

  if (!nav) return null
  const peekTo = peek ? (peek.dir === 'next' ? nav.next : nav.prev) : null

  return (
    <>
      <nav className="af-lswipe" aria-label={es ? 'Cambiar de liga' : 'Switch league'}>
        {nav.prev ? (
          <Link className="af-lswipe-btn" href={leagueSwipeHref(pathname, nav.prev.id)} data-dir="prev">
            <span aria-hidden>‹</span>
            <span className="af-lswipe-name">{nav.prev.name}</span>
          </Link>
        ) : (
          <span className="af-lswipe-btn" data-dir="prev" aria-hidden />
        )}
        <span className="af-lswipe-count af-num" aria-live="polite">
          {nav.index + 1} / {nav.total}
        </span>
        {nav.next ? (
          <Link className="af-lswipe-btn" href={leagueSwipeHref(pathname, nav.next.id)} data-dir="next">
            <span className="af-lswipe-name">{nav.next.name}</span>
            <span aria-hidden>›</span>
          </Link>
        ) : (
          <span className="af-lswipe-btn" data-dir="next" aria-hidden />
        )}
      </nav>
      {peek && peekTo ? (
        <div
          className="af-lswipe-peek"
          data-dir={peek.dir}
          data-ready={peek.progress >= 1 ? 'true' : undefined}
          style={{ opacity: 0.35 + peek.progress * 0.65 }}
          aria-hidden
        >
          {peek.dir === 'prev' ? '‹ ' : ''}
          {peekTo.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={peekTo.imageUrl} alt="" width={20} height={20} />
          ) : null}
          <span>{peekTo.name}</span>
          {peek.dir === 'next' ? ' ›' : ''}
        </div>
      ) : null}
    </>
  )
}

export default LeagueSwipe
