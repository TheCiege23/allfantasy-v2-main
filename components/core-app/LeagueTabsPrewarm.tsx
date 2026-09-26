'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import { speculationGate, type SpeculationGate } from '@/components/core-app/speculationGate'

/**
 * Warms the screens a manager opens next, after the one he opened has landed.
 *
 * ⚠ TWO, NAMED, AND NOT DERIVED FROM THE TAB LIST. Prewarming is not free: each
 * target is a FULL server render of `/core/[[...screen]]`, which runs the shell
 * reads and that screen's own loader. Twelve tabs would mean twelve renders per
 * league opened, on the most-visited surface in the product — the shape this
 * repo already has a note about under "an engine in a render = 244 HTTP". The
 * list is short, explicit, and has to be argued to grow.
 *
 * 🛑 `router.prefetch()` IS A FULL PREFETCH, AND THAT IS THE ONLY REASON THIS
 * DOES ANYTHING. Read out of `next/dist/client/components/app-router.js`:
 * `kind: options?.kind ?? PrefetchKind.FULL`. A `<Link>` without an explicit
 * `prefetch` resolves to `PrefetchKind.AUTO` instead (`link.js`: `prefetchProp
 * === null ? AUTO : FULL`), and AUTO on a dynamic route stops at the nearest
 * `loading.tsx` — which this route has. So every tab link on this page has
 * always "prefetched", and every one of them was fetching the skeleton this
 * page already shows. Warming the data needs FULL, explicitly.
 *
 * 🛑 AND NONE OF IT RUNS IN `next dev`. Both paths short-circuit on
 * `process.env.NODE_ENV === "development"` (app-router.js line 272, link.js
 * line 378). A dev-server probe of this feature observes zero requests and
 * reads exactly like a change that does nothing — so the logic below is tested
 * directly, and the network behaviour is cited from Next's source rather than
 * measured in a dev run that cannot show it.
 */

/** The screens worth warming, in the order a manager usually reaches them. */
export const PREWARM_KEYS = ['my-team', 'matchup'] as const

/**
 * Which of `PREWARM_KEYS` to warm from here.
 *
 * Exported for its test — the exclusions are the whole behaviour, and both of
 * them are ways to spend a render on something the user cannot or will not use.
 */
export function selectPrewarmTargets({
  activeKey,
  availableKeys,
}: {
  activeKey: string
  availableKeys: readonly string[]
}): string[] {
  return PREWARM_KEYS.filter(
    (key) =>
      /* Already here. Warming the screen you are looking at is a second render of it. */
      key !== activeKey &&
      /*
       * ⚠ AND ONLY A TAB THAT IS ACTUALLY OFFERED. `LeagueTabs` removes Matchup
       * when the league has no scored week, and Trades/Draft HQ when the import
       * says the platform does not publish them. Warming a screen with no tab is
       * a render nobody can navigate to — pure waste, and invisible, because
       * nothing downstream would ever report it.
       */
      availableKeys.includes(key),
  )
}

/** True when the reader has asked the browser to spend less data on their behalf. */
function saveDataRequested(): boolean {
  const connection = (
    navigator as Navigator & { connection?: { saveData?: boolean } }
  ).connection
  return connection?.saveData === true
}

export function LeagueTabsPrewarm({
  leagueId,
  activeKey,
  availableKeys,
  gate = speculationGate,
}: {
  leagueId: string
  activeKey: string
  availableKeys: readonly string[]
  /** The page's shared gate; a test passes its own so no state leaks between cases. */
  gate?: SpeculationGate
}) {
  const router = useRouter()
  /* A stable dependency: the array identity changes on every render, its contents do not. */
  const availableSignature = availableKeys.join(',')

  useEffect(() => {
    const targets = selectPrewarmTargets({ activeKey, availableKeys: availableSignature.split(',') })
    if (targets.length === 0) return
    /* Speculative traffic is the first thing to drop when someone is paying per megabyte. */
    if (saveDataRequested()) return

    let cancelled = false
    let idleHandle: number | null = null
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    /*
     * 🛑 ONE AT A TIME, THROUGH THE SHARED GATE — NOT BOTH IN ONE LOOP. This fired both targets
     * back to back, and nothing held it off while the rail was warming leagues or the manager
     * had just clicked. `speculationGate.ts` records what that did to production. A target the
     * gate refuses waits for it to open rather than being dropped: two spaced renders are not
     * a burst, and these two are the screens a manager most often opens next.
     */
    const queue = [...targets]
    const prefetch = () => {
      if (cancelled || queue.length === 0) return
      if (!gate.tryAcquire()) {
        timeoutHandle = setTimeout(prefetch, Math.max(gate.msUntilOpen(), 50))
        return
      }
      const key = queue.shift()!
      router.prefetch(`/core/${key}?league=${encodeURIComponent(leagueId)}`)
      if (queue.length > 0) timeoutHandle = setTimeout(prefetch, gate.msUntilOpen())
    }

    /*
     * ⚠ AFTER THE CURRENT SCREEN, NEVER ALONGSIDE IT. The screen the user asked
     * for streams in behind its own Suspense boundary, and two more full renders
     * issued while that is still in flight compete with it on the same server —
     * making the page he is looking at slower to make one he may not open
     * faster. That is the opposite of the point.
     *
     * `load` covers the first navigation; on a tab-to-tab move it has already
     * fired and `readyState` is `complete`, so this goes straight to idle.
     */
    const schedule = () => {
      if (cancelled) return
      if (typeof window.requestIdleCallback === 'function') {
        /* The timeout is a floor on when it happens, not a deadline to beat: on a
           busy main thread idle may never come on its own. */
        idleHandle = window.requestIdleCallback(prefetch, { timeout: 4000 })
      } else {
        timeoutHandle = setTimeout(prefetch, 2000)
      }
    }

    if (document.readyState === 'complete') {
      schedule()
    } else {
      window.addEventListener('load', schedule, { once: true })
    }

    return () => {
      cancelled = true
      window.removeEventListener('load', schedule)
      if (idleHandle != null && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle)
      }
      if (timeoutHandle != null) clearTimeout(timeoutHandle)
    }
  }, [leagueId, activeKey, availableSignature, router, gate])

  return null
}

export default LeagueTabsPrewarm
