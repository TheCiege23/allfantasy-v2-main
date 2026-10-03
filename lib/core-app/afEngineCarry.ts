import { isIdpEligiblePosition } from '@/lib/af-projections/idpScoring'

/**
 * The engine row as the carry needs it. A bare number is still accepted and means "generic PPR,
 * position unknown" — which is what every caller passed before the IDP guard below existed.
 */
export type AfEngineCarryInput =
  | number
  | { projectedPoints: number; basis?: string | null; position?: string | null }

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
 * against the provider's 165.7. A defender's engine number is returned unscaled — his AF figure
 * under the engine's IDP preset, the same "as the engine wrote it" the fallback above already uses.
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
): number | null {
  if (afEngine == null) return null
  const points = typeof afEngine === 'number' ? afEngine : afEngine.projectedPoints
  if (points == null || !Number.isFinite(points)) return null
  const defensive =
    typeof afEngine !== 'number' &&
    (String(afEngine.basis ?? '').includes('idp') || isIdpEligiblePosition(afEngine.position))
  const canScale =
    !defensive &&
    providerGeneric != null &&
    providerLeague != null &&
    Number.isFinite(providerGeneric) &&
    Number.isFinite(providerLeague) &&
    providerGeneric > 0.5
  const v = canScale ? points * (providerLeague! / providerGeneric!) : points
  return Math.round(v * 100) / 100
}
