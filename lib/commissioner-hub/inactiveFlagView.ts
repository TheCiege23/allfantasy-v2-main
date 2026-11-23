/**
 * The commissioner "inactive" flag's graded record, as the client sees it — pure and client-safe; the grading
 * itself is `inactiveFlagLedger.ts` (server-only). Counts only: no league, roster or person.
 */

/** What the outcome rebuild stores: flags graded in the last year, how many stayed away, how many are still open. */
export type InactiveFlagTally = { graded: number; stayedAway: number; pending: number }
export type InactiveFlagView = { graded: number; stayedAway: number; ratePct: number | null }

/** Below this many graded flags no rate is shown — the advice ledger's overall floor. */
export const MIN_GRADED_INACTIVE_FLAGS = 30

/** PURE. The client-safe view: counts, and a rate only at or above the floor. Null when nothing is graded. */
export function inactiveFlagView(tally: InactiveFlagTally | null | undefined): InactiveFlagView | null {
  if (!tally || !Number.isInteger(tally.graded) || tally.graded <= 0) return null
  const stayedAway = Math.max(0, Math.min(tally.graded, Math.floor(tally.stayedAway)))
  return {
    graded: tally.graded,
    stayedAway,
    ratePct: tally.graded >= MIN_GRADED_INACTIVE_FLAGS ? Math.round((100 * stayedAway) / tally.graded) : null,
  }
}

/** Only a well-formed view survives the trip to the client; anything else renders nothing. */
export function readInactiveFlagView(value: unknown): InactiveFlagView | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  const int = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0
  if (!int(v.graded) || !int(v.stayedAway) || v.graded === 0 || v.stayedAway > v.graded) return null
  if (v.ratePct !== null && !(typeof v.ratePct === 'number' && v.ratePct >= 0 && v.ratePct <= 100)) return null
  return { graded: v.graded, stayedAway: v.stayedAway, ratePct: v.ratePct as number | null }
}
