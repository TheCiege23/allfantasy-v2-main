/**
 * Build a name-keyed lookup that REFUSES on ambiguity instead of guessing.
 *
 * ⚠ WHY THIS EXISTS, IN THREE INCIDENTS. `new Map(rows.map(r => [name, r]))` resolves a
 * duplicate key to the LAST pair, silently. That shape shipped three separate bugs here:
 *
 *   - `scripts/backfill-player-dob.ts` wrote a 1971 birth date onto a 2026 rookie, because
 *     nflverse carries five Chris Johnsons in the DB position group (fixed, `e5fb40f38`).
 *   - `lib/core-app/myTeam.ts` showed the OLDEST injury status rather than the newest, because
 *     the rows were sorted `fetchedAt: desc` and last-wins took the tail (fixed, `b97cc1e10`).
 *   - `lib/api-sports.ts` handed one player another's team; within a single sport 117 NFL names
 *     resolve to more than one team, 4,254 across all sports (fixed, `bf3cbca40`).
 *
 * In two of the three, a correctly-guarded map sat within a few lines of the unguarded one. The
 * knowledge was present and did not survive being retyped, which is what a shared helper fixes.
 *
 * ⚠ NAMES COLLIDE IN THIS DATA, MEASURED. Over the 11,960-row NFL player table: 221 colliding
 * keys on name alone (553 rows), 53 on name+position. Some are placeholder junk
 * (`Duplicate Player`, `Player Invalid`) which pollutes any name key; plenty are real people —
 * Marvin Jones (DE/WR), Christian Jones (OT/LB/OL), Sean Ryan (TE/WR). Inside a single league
 * it is rarer but not absent: Byron Murphy (CB MIN / DL SEA) and Justin Jefferson
 * (WR MIN / LB CLE) each sit on one roster together.
 *
 * A name is not an id. Where an id exists, use it; this is for the fallbacks that remain.
 */

export interface NameIndexOptions<T> {
  /**
   * Identity of the underlying thing, when duplicate ROWS for the SAME entity are expected.
   * Two rows that agree on identity collapse to the first rather than being refused — a
   * duplicated row is not an ambiguous name. Omit it and any repeated key is refused.
   */
  identityOf?: (row: T) => string
  /** Called once per refused key, for logging. Never throws the caller off course. */
  onAmbiguous?: (key: string, rows: readonly T[]) => void
}

/**
 * Returns a plain `Map` containing ONLY unambiguous keys, so existing `.get()` call sites keep
 * working unchanged and an ambiguous name simply reads as absent — which every caller already
 * handles, because a name that is not in the data reads the same way.
 */
export function buildNameIndex<T>(
  rows: Iterable<T>,
  keyOf: (row: T) => string | null | undefined,
  options: NameIndexOptions<T> = {},
): Map<string, T> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const raw = keyOf(row)
    if (!raw) continue
    const key = raw.trim()
    if (!key) continue
    const bucket = grouped.get(key)
    if (bucket) bucket.push(row)
    else grouped.set(key, [row])
  }

  const out = new Map<string, T>()
  for (const [key, bucket] of grouped) {
    if (bucket.length === 1) {
      out.set(key, bucket[0])
      continue
    }
    if (options.identityOf) {
      const identities = new Set(bucket.map(options.identityOf))
      if (identities.size === 1) {
        // Same entity, repeated rows. Keeping the first is safe and loses nothing.
        out.set(key, bucket[0])
        continue
      }
    }
    options.onAmbiguous?.(key, bucket)
  }
  return out
}

/** Keys that were refused — useful when a caller wants to report coverage honestly. */
export function findAmbiguousNames<T>(
  rows: Iterable<T>,
  keyOf: (row: T) => string | null | undefined,
  options: NameIndexOptions<T> = {},
): string[] {
  const ambiguous: string[] = []
  buildNameIndex(rows, keyOf, {
    ...options,
    onAmbiguous: (key, bucket) => {
      ambiguous.push(key)
      options.onAmbiguous?.(key, bucket)
    },
  })
  return ambiguous
}
