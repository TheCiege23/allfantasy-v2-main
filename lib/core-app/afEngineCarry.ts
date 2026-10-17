import { isIdpEligiblePosition } from '@/lib/af-projections/idpScoring'
import { rescoreIdpForLeague, type StoredProjectionFactors } from '@/lib/af-projections/rescoreForLeague'

/**
 * The engine row as the carry needs it. A bare number is still accepted and means "generic PPR,
 * position unknown" — which is what every caller passed before the IDP guard below existed.
 *
 * `idpFactors` is the engine snapshot's stored IDP block (`adjustmentFactors`), carried by
 * `lookupAfEngineProjections` for defenders. League-agnostic: it holds component AMOUNTS, never
 * one league's points, so it is safe on a shared row.
 */
export type AfEngineCarryInput =
  | number
  | {
      projectedPoints: number
      basis?: string | null
      position?: string | null
      idpFactors?: StoredProjectionFactors | null
    }

/** A league's scoring map, numeric entries only — the shape `rescoreIdpForLeague` multiplies. */
function numericRules(scoring: Record<string, unknown> | null | undefined): Record<string, number> | null {
  if (!scoring) return null
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(scoring)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * The AF engine's number carried into one league's scoring.
 *
 * The engine emits generic PPR. Where the provider line for the SAME player priced under both
 * generic PPR and this league's rules, their ratio is how far this league's rules move that
 * player's stat mix — a 6-point passing TD lifts a QB, a TE premium lifts a tight end — and it is
 * applied to the AF number. Where no such ratio exists (no provider row, no league rules, a
 * provider total too small to divide by) the AF number is returned as the engine wrote it, never
 * dropped: it is still the AF projection, just under PPR.
 *
 * ⚠ EXCEPT FOR DEFENDERS, WHERE THE ENGINE DOES NOT EMIT PPR AND THE RATIO IS NOT A RATIO.
 * `buildAfProjection` scores an IDP-eligible player on his defensive components (basis
 * `*_idp_*`), so a DE arrives at ~10. The provider's generic column is offensive-only — the same
 * DE reads ~0.8 there — so league/generic measured how blind that column is to tackles and sacks,
 * not how this league's rules move him. Seen on the live My Team screen 2026-10-02, an IDP league in week 4: provider
 * league line 10.0 and 12.4 for two DL, carried AF 95.2 and 121.5, and a team total of 342.2
 * against the provider's 165.7.
 *
 * 🛑 AND RETURNING A DEFENDER UNSCALED WAS HALF A FIX. The engine scores every defender under ONE
 * canonical preset (`balanced`: solo 1.0 / assist 0.5), so "as the engine wrote it" is a
 * balanced-league number in every league. Measured the same evening on that league (KBFL: solo 2,
 * assist 1, pass defended 4, TFL 2): its eight IDP starters read 45.2 AF against 86.2 from the
 * provider, the whole 27-point gap between the two team totals. Rescored from the snapshot's
 * stored component amounts under the league's own rules they read 9.24 / 12.41 / 15.10 / 12.81 /
 * 8.65 / 9.16 / 9.67 / 8.33 — within 0.8 of the provider on every one.
 *
 * So, given `idpFactors` and the league's `scoring`, a defender is rescored with
 * `rescoreIdpForLeague` — the Decision OS's read-time path, not a second implementation. The
 * engine's own adjustments survive: the result is the engine number scaled by
 * (league rescore / stored preset points), which is the rescore itself whenever the engine applied
 * none. Without factors or rules the defender stays unscaled, as before.
 *
 * ⚠ ITS OWN LEAF, CLIENT-SAFE ON PURPOSE. It is pure arithmetic, and a client screen that already
 * holds both provider numbers (the Player Finder) carries AF per league without a server round
 * trip. `playerProjections.ts` is `server-only` and re-exports this, so server callers are unchanged;
 * a client must import THIS file, never that one.
 */
export function afEngineForLeague(
  afEngine: AfEngineCarryInput | null | undefined,
  providerGeneric: number | null | undefined,
  providerLeague: number | null | undefined,
  /** The league's own scoring settings. Only read for a defender with stored IDP factors. */
  scoring?: Record<string, unknown> | null,
): number | null {
  if (afEngine == null) return null
  const points = typeof afEngine === 'number' ? afEngine : afEngine.projectedPoints
  if (points == null || !Number.isFinite(points)) return null
  const defensive =
    typeof afEngine !== 'number' &&
    (String(afEngine.basis ?? '').includes('idp') || isIdpEligiblePosition(afEngine.position))
  if (defensive) {
    const factors = (afEngine as Exclude<AfEngineCarryInput, number>).idpFactors ?? null
    const rescore = rescoreIdpForLeague(factors, numericRules(scoring))
    if (!rescore) return Math.round(points * 100) / 100
    const storedRaw = (factors?.idp as { points?: unknown } | null | undefined)?.points
    const stored = typeof storedRaw === 'number' && Number.isFinite(storedRaw) ? storedRaw : null
    const v = stored != null && stored > 0.05 ? points * (rescore.points / stored) : rescore.points
    return Math.round(v * 100) / 100
  }
  const canScale =
    providerGeneric != null &&
    providerLeague != null &&
    Number.isFinite(providerGeneric) &&
    Number.isFinite(providerLeague) &&
    providerGeneric > 0.5
  const v = canScale ? points * (providerLeague! / providerGeneric!) : points
  return Math.round(v * 100) / 100
}
