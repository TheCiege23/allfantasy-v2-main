/**
 * A short-lived, in-process cache for Fantrax's player directories.
 *
 * 🛑 EVERY IMPORT DOWNLOADED SIX DIRECTORIES AND THREW THEM AWAY. A Fantrax league does not say
 * which sport it is, so the import fetches every sport's directory (`getPlayerIds`) and keeps the
 * one that names the most rostered players. The college football one alone is ~16,900 players. A
 * scheduled refresh of twenty Fantrax leagues therefore made 120 of these requests in a row for
 * six lists that had not changed, against an API that answers 429.
 *
 * A directory is the same for every league, so one copy per sport is shared for a short while.
 *
 * ⚠ IN-PROCESS, NOT IN POSTGRES, ON PURPOSE. These are megabytes of JSON each; reading six of them
 * back from a table on every import would trade one slow read for another. The saving that matters
 * is inside one process doing many imports — a refresh run, or a busy import screen — and a Map
 * gives that with nothing to migrate. A cold process simply fetches once.
 *
 * ⚠ ONLY SUCCESSES ARE KEPT. A failed read is returned to its caller and forgotten, so one
 * throttled request cannot become an hour of "that sport is unavailable".
 *
 * ⚠ SHORT, BECAUSE A STALE DIRECTORY HAS A VISIBLE COST. A player added to Fantrax after the copy
 * was taken is missing from it, and a rostered player missing from the directory imports without
 * a name. An hour bounds that.
 *
 * ⚠ THE COPY IS SHARED, SO IT MUST NOT BE CHANGED. Every caller today builds a new object from it
 * (`withFantraxDisplayNames`, `preserveSnapshotNames`, `resolveRosters`); a caller that edited the
 * map in place would be editing it for every later import.
 *
 * ⚠ FOR THE IMPORT ONLY. The identity ingestion jobs call `getFantraxPlayerIds` directly and keep
 * doing so: their whole job is to notice a new player, and they must read the live list.
 */
import { getFantraxPlayerIds, type FantraxPlayerRef, type FantraxResult, type FantraxSport } from './fantraxApi'

type Directory = Record<string, FantraxPlayerRef>

/** How long a directory is reused. */
export const FANTRAX_DIRECTORY_CACHE_MS = 60 * 60 * 1000

const held = new Map<FantraxSport, { at: number; result: FantraxResult<Directory> }>()
const inFlight = new Map<FantraxSport, Promise<FantraxResult<Directory>>>()

/**
 * Off under test unless a test asks for it: a cache that outlives one test would hand the next
 * test the previous test's directory, which is a test that passes or fails by run order.
 */
function defaultTtlMs(): number {
  return process.env.NODE_ENV === 'test' ? 0 : FANTRAX_DIRECTORY_CACHE_MS
}

/**
 * A sport's player directory, reused for up to `ttlMs`.
 *
 * Two imports asking for the same sport at once share one request rather than making two.
 */
export async function getCachedFantraxPlayerIds(
  sport: FantraxSport,
  options?: { ttlMs?: number; now?: () => number },
): Promise<FantraxResult<Directory>> {
  const ttlMs = options?.ttlMs ?? defaultTtlMs()
  if (!(ttlMs > 0)) return getFantraxPlayerIds(sport)

  const now = options?.now ?? Date.now
  const hit = held.get(sport)
  if (hit && now() - hit.at < ttlMs) return hit.result

  const pending = inFlight.get(sport)
  if (pending) return pending

  const request = (async () => {
    try {
      const result = await getFantraxPlayerIds(sport)
      if (result.ok) held.set(sport, { at: now(), result })
      return result
    } finally {
      inFlight.delete(sport)
    }
  })()
  inFlight.set(sport, request)
  return request
}

/** Forget every held directory. For tests, and for anything that knows the lists just changed. */
export function clearFantraxPlayerDirectoryCache(): void {
  held.clear()
  inFlight.clear()
}
