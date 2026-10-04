import '@/components/core-app/af-core.css'
import '@/components/core-app/af-dash-carryover.css'
import type { Dash34Data } from '@/components/core-app/screens/Dashboard34'
import { Dash34CarryoverView, Dash34CoverageView, type CarryoverCountdown } from '@/components/core-app/screens/Dash34CarryoverView'

/**
 * The 34a home sections Dashboard3A does not render, carried over so the /core
 * cutover loses nothing (the parity rule: less is fine only when it is chosen,
 * and these four were not up for losing):
 *
 *   - firstLock  — the most-time-critical band with the next real kickoff.
 *   - notice     — the one-account-wide honesty card ("sync has never run"),
 *                  the 604-row fix; dropping it would un-fix that.
 *   - chimmyBrief — the deterministic brief, the 34a hero.
 *   - coverage   — what this screen is NOT watching. A quiet dashboard that
 *                  doesn't name its blind spots reads as "everything is fine".
 *
 * Deliberately NOT carried over (covered elsewhere on the unified home, listed
 * for sign-off in the cutover PR): today/next-24 strips (Outstanding issues
 * carries the same "what needs you" facts) and the per-league state chips
 * (STARTERS OUT lives in the triage panel above; DRAFTING/YOU COMMISH surface
 * on each league's own screens).
 *
 * A separate component because Dashboard3A.tsx carries another session's
 * in-flight work and is not edited. Countdown renders the server paint
 * statically — the triage panel above already carries live kickoff urgency.
 */
/**
 * Static server paint, deliberately coarse. No ticker mounts here — the triage
 * panel above carries live kickoff urgency, and the 34a page keeps the precise
 * Dash34Countdown — so a to-the-minute '3d 02:48' would sit frozen and read as
 * a live clock that stopped. 'in 3d 3h' is honest about its own precision.
 * Falls back to the loader's pre-formatted string when no ISO target exists.
 */
function coarseCountdown(toIso: string | null | undefined, fallback: string): CarryoverCountdown {
  if (!toIso) return { fallback }
  const t = new Date(toIso).getTime()
  if (Number.isNaN(t)) return { fallback }
  // The MINUTES are decided here, against the server's clock; the view words them ('in 3d 3h', 'underway').
  return { mins: Math.floor((t - Date.now()) / 60000) }
}

export function Dash34Carryover({ data }: { data: Dash34Data | null }) {
  if (!data) return null
  const { firstLock, notice, chimmyBrief } = data
  /*
   * Coverage no longer counts toward this guard — it renders at the foot of
   * the page now (Dash34Coverage). The brief still keeps this band alive in
   * the quiet case, deliberately: with nothing to report its headline reads
   * "Nothing is waiting on you", and hiding it would leave a reader unable to
   * tell "we checked and it is clear" from "we are not looking".
   */
  if (!firstLock && !notice && !chimmyBrief) return null

  /*
   * ⚠ THE WORDS ARE SAID IN THE CLIENT (2026-10-04). This band keeps the decisions — whether it renders
   * at all, and the countdown against `Date.now()` — and Dash34CarryoverView says them in the reader's
   * language, from the parts dash34 now writes beside its English.
   */
  return (
    <Dash34CarryoverView
      firstLock={firstLock ?? null}
      countdown={firstLock ? coarseCountdown(firstLock.countdownTo, firstLock.countdown) : null}
      notice={notice ?? null}
      chimmyBrief={chimmyBrief ?? null}
    />
  )
}

/**
 * What this screen is NOT watching — the same disclosure, moved to the foot of
 * the page.
 *
 * ⚠ IT IS A FOOTNOTE, AND IT WAS SITTING THIRD. Leading a home screen with a
 * list of everything we cannot see sets the tone of the whole page to apology,
 * before the reader has seen a single thing the product DOES know. It belongs
 * after the answers, where someone who has read them and wants to know what
 * was left out can find it — which is exactly what a collapsed disclosure at
 * the bottom is for. Nothing about the content changed; only where it sits.
 */
export function Dash34Coverage({ data }: { data: Dash34Data | null }) {
  const coverage = data?.coverage
  if (!coverage || coverage.length === 0) return null
  return <Dash34CoverageView coverage={coverage} />
}
