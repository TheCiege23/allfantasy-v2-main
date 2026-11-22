/**
 * How many seasons ahead a native dynasty league's picks can be traded. Pure (no Prisma), so the
 * rules popup (lib/league-rules-explainer/snapshot.ts) and the Draft Pick Settings tab read the same
 * clamp the trade engine does. ./nativeFuturePicks.ts re-exports it for its existing importers.
 */

/** Seasons ahead a native pick can be traded when the league has not set one — the three-year horizon imported leagues use. */
export const NATIVE_PICK_YEARS = 3
/** Bounds on the commissioner's `futurePicksYearsOut`; past five years a pick has no market to speak of. */
export const NATIVE_PICK_YEARS_MIN = 1
export const NATIVE_PICK_YEARS_MAX = 5

/**
 * The league's tradeable-pick horizon in seasons: `DynastyLeagueConfig.futurePicksYearsOut`, clamped
 * to [1, 5], or 3 when unset or not a number. It used to be a flat 3 whatever the commissioner chose.
 *
 * Shrinking it never loses a pick: a stored trade for a season now beyond the horizon stays in
 * `future_draft_picks` and is still applied when that season's draft is created
 * (`consumeNativeFuturePicksForDraft` reads by season, not by horizon); it is only not offered again
 * until the season comes back inside the window.
 */
export function resolveNativePickYears(configured: number | null | undefined): number {
  const n = Number(configured)
  if (configured == null || !Number.isFinite(n)) return NATIVE_PICK_YEARS
  return Math.min(Math.max(NATIVE_PICK_YEARS_MIN, Math.floor(n)), NATIVE_PICK_YEARS_MAX)
}
