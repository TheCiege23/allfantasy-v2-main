/**
 * PLACEHOLDER — NOT YET MEASURED.
 *
 * ⚠ THIS FILE IS EMPTY ON PURPOSE AND MUST NOT BE HAND-EDITED. It exists so that
 * `lib/trade-intel/devyOutlook.ts` can import the draft-rate bridge today and
 * have it light up the moment real rates land, rather than needing a code change
 * at that point. Every consumer path is therefore already exercised by tests
 * against an empty table.
 *
 * `DRAFT_RATES` is empty, so `draftRateFor()` returns null for every lookup and
 * `pReachesRelevance` stays null with `calibration: 'never-observed'`. That is
 * the honest state: P(reaches the NFL) has never been observed here, because the
 * devy table holds only forward-looking cohorts (draftEligibleYear 2026-2029) —
 * nobody in it has had the chance to be drafted.
 *
 * TO POPULATE IT, run the backfill, which OVERWRITES this file wholesale:
 *
 *     npx tsx scripts/devy-draft-rate-backfill.ts
 *
 * ⚠ BLOCKED ON QUOTA as of 2026-08-25: the CFBD key returns
 * `HTTP 429 {"message":"Monthly call quota exceeded."}`. The script aborts on
 * the first refusal and writes nothing rather than computing rates from a
 * partial fetch, which would understate every cohort invisibly. Tier 3 ($10/mo,
 * 75k calls) is comfortably enough for the ~18 calls it needs.
 */

export type DraftRateCell = {
  position: 'QB' | 'RB' | 'WR' | 'TE'
  stars: number
  /** Rated recruits in this cell across all measured classes. */
  recruits: number
  /** How many were later selected in the NFL draft. */
  drafted: number
  /** drafted / recruits. */
  rate: number
}

export const DRAFT_RATE_PROVENANCE = {
  recruitClasses: [] as number[],
  draftYears: [] as number[],
  outcomeWindowYears: [] as number[],
  totalRecruits: 0,
  totalDrafted: 0,
  overallRate: 0,
  /** False until the backfill has actually run. Consumers must check this. */
  measured: false,
} as const

export const DRAFT_RATES: DraftRateCell[] = []

/**
 * The measured rate for a recruit, or null when we have no cell or too small a
 * one to state a rate.
 *
 * ⚠ NULL IS THE ANSWER TODAY, FOR EVERY PLAYER. A fabricated rate would put a
 * confident probability on an asset nobody has measured — the precise failure
 * lib/trade-intel/devyOutlook.ts exists to prevent.
 */
export function draftRateFor(
  position: string,
  stars: number | null,
  minSample = 50,
): DraftRateCell | null {
  if (stars == null) return null
  const hit = DRAFT_RATES.find((c) => c.position === position && c.stars === stars)
  if (!hit || hit.recruits < minSample) return null
  return hit
}
