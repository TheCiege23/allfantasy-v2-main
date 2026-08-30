/**
 * Reduce crosswalk rows to a one-to-one id map, refusing anything ambiguous.
 *
 * ⚠ A PURE MODULE, because `rosterIdCrosswalk.ts` imports prisma at module scope
 * and this guard is the part most worth a unit test. Same reason as
 * `descriptiveId.ts` and `birthdayRules.ts`.
 *
 * ⚠ ONLY `sleeperId` IS UNIQUE ON `PlayerIdentityMap` — the provider id columns
 * are NOT. Two rows sharing one `espnId` are two different athletes, and
 * translating to whichever the database happened to return first would put a
 * stranger in somebody's lineup, silently, on a screen that then prices him and
 * feeds him to a win-probability model.
 *
 * So an id that does not resolve to exactly one player is DROPPED, and the
 * screen falls back to "could not identify" — which is true, and which the
 * identity note already explains at platform level.
 */

export type CrosswalkRow = {
  /** The platform's own id, e.g. an ESPN athlete id. */
  from: string | null | undefined
  /** The Sleeper id every player-resolving surface joins on. */
  to: string | null | undefined
}

/**
 * `from` → `to`, keeping only ids that map to exactly one target.
 *
 * ⚠ A REPEATED ROW WITH THE SAME TARGET IS NOT AMBIGUOUS. The same pairing
 * arriving twice is one fact stated twice; it is a genuine DISAGREEMENT — two
 * different targets for one source — that must be refused. Treating a duplicate
 * as a conflict would throw away good bridges for no reason.
 */
export function reduceCrosswalk(rows: readonly CrosswalkRow[]): Map<string, string> {
  const seen = new Map<string, string | null>()

  for (const r of rows) {
    const from = r.from?.trim()
    const to = r.to?.trim()
    if (!from || !to) continue
    if (!seen.has(from)) {
      seen.set(from, to)
      continue
    }
    /* Already contradicted, or contradicted now. Null is the tombstone. */
    if (seen.get(from) !== to) seen.set(from, null)
  }

  const out = new Map<string, string>()
  for (const [from, to] of seen) {
    if (to) out.set(from, to)
  }
  return out
}
