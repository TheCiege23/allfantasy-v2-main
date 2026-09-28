/**
 * One gate for every speculative `/core` render — the league rail's hover warm and the tab strip's
 * prewarm — so together they can never start a burst.
 *
 * 🛑 MEASURED 2026-09-26, AND IT IS WHY THIS EXISTS. Each warm is a FULL server render of
 * `/core/[[...screen]]`: the shell's reads plus a screen loader, 40–150 queries. The two warmers
 * were each bounded on their own (two tabs; six rail leagues) and nothing bounded them together or
 * against the click they exist to serve. In production one page load produced SEVEN concurrent
 * renders (Sentry trace e41eb7e6…): the page itself in 1.9s, then six league `home` renders from a
 * pointer crossing the rail, each 6–8s, with the shell alone swelling from its usual ~0.8s to
 * 2.5–3.6s and a single `League.findMany` taking up to 1.25s. That is the 8–15s "tab click" people
 * reported — the server was busy rendering pages nobody opened.
 *
 * ⚠ AND THE DATA CANNOT SEPARATE THEM, WHICH IS WHY THE CONTROL LIVES HERE AND NOT IN A DASHBOARD.
 * Next 14.2 sends `next-router-prefetch: 1` only for an AUTO prefetch
 * (`fetch-server-response.js`); a FULL one — the only kind that warms data — arrives looking
 * exactly like a click, so the request classifier files it under `rsc`.
 *
 * Two rules:
 *   · SPACING. At most one speculative render per `SPECULATION_SPACING_MS`, across both warmers.
 *     `router.prefetch` returns nothing, so there is no completion to wait on; spacing by roughly a
 *     median render is the closest honest stand-in.
 *   · NAVIGATION FIRST. Nothing speculative starts within `NAVIGATION_QUIET_MS` of a real click.
 *     The screen the manager asked for is the one render that must not share the server.
 *
 * A refused warm is DROPPED, not queued. Queueing would only move the burst a second later.
 */

/** Minimum gap between two speculative renders, across every warmer. About one median render. */
export const SPECULATION_SPACING_MS = 1_500

/** How long after a real /core navigation starts before anything speculative may begin. */
export const NAVIGATION_QUIET_MS = 4_000

export type SpeculationGate = {
  /** A real navigation has started; speculation stands down for `NAVIGATION_QUIET_MS`. */
  noteNavigation(): void
  /** Claims the next speculative render. True means go, and the claim is recorded. */
  tryAcquire(): boolean
  /** How long until `tryAcquire` could next succeed; 0 when it would now. */
  msUntilOpen(): number
}

export function createSpeculationGate(now: () => number = () => Date.now()): SpeculationGate {
  let lastSpeculationAt: number | null = null
  let lastNavigationAt: number | null = null

  const msUntilOpen = () => {
    const t = now()
    const afterNavigation = lastNavigationAt == null ? 0 : lastNavigationAt + NAVIGATION_QUIET_MS - t
    const afterSpeculation = lastSpeculationAt == null ? 0 : lastSpeculationAt + SPECULATION_SPACING_MS - t
    return Math.max(0, afterNavigation, afterSpeculation)
  }

  return {
    noteNavigation() {
      lastNavigationAt = now()
    },
    tryAcquire() {
      if (msUntilOpen() > 0) return false
      lastSpeculationAt = now()
      return true
    },
    msUntilOpen,
  }
}

/** The page's one gate. Module-level on purpose: both warmers must see each other's claims. */
export const speculationGate = createSpeculationGate()
