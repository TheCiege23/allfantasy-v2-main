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
 * ⚠ ITS OWN LEAF, CLIENT-SAFE ON PURPOSE. It is pure arithmetic, and a client screen that already
 * holds both provider numbers (the Player Finder) carries AF per league without a server round
 * trip. `playerProjections.ts` is `server-only` and re-exports this, so server callers are unchanged;
 * a client must import THIS file, never that one.
 */
export function afEngineForLeague(
  afEngine: number | null | undefined,
  providerGeneric: number | null | undefined,
  providerLeague: number | null | undefined,
): number | null {
  if (afEngine == null || !Number.isFinite(afEngine)) return null
  const canScale =
    providerGeneric != null &&
    providerLeague != null &&
    Number.isFinite(providerGeneric) &&
    Number.isFinite(providerLeague) &&
    providerGeneric > 0.5
  const v = canScale ? afEngine * (providerLeague! / providerGeneric!) : afEngine
  return Math.round(v * 100) / 100
}
