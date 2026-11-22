/**
 * A short-lived, in-process cache for reads that many leagues share in one render (2026-11-20).
 *
 * Why: /core's rail prices every league the user holds on every render (`loadLeagueRosterWeeks`), and each league
 * re-read the same season of AF projection rows and rebuilt the same board. With ~85 leagues that held the web
 * process at 100% busy and took the /core shell from 3-6 s to 10-105 s (`[core-shell-timing]`, 2026-11-20 02:03Z on).
 *
 * - Concurrent callers share one pending read, so four shell renders arriving together do the work once.
 * - A failed read is dropped at once, so an outage is retried next call rather than served for the TTL.
 * - Off under Vitest unless a test turns it on: suites mock these reads with different data under the same keys,
 *   and a cache would hand one test another's rows.
 */
type Entry = { at: number; value: Promise<unknown> }

const stores = new Map<string, Map<string, Entry>>()
let enabledInTests = false

function cacheActive(): boolean {
  return !process.env.VITEST || enabledInTests
}

/**
 * The same switch, for a caller that caches through another layer (leagueRosterWeek.ts's durable board cache)
 * and must stay off under Vitest exactly when this one is.
 */
export function sharedReadCacheActive(): boolean {
  return cacheActive()
}

/** Tests only: turn the cache on (or off again) and start empty. */
export function setSharedReadCacheForTests(on: boolean): void {
  enabledInTests = on
  stores.clear()
}

export function sharedRead<T>(store: string, key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  if (!cacheActive()) return load()
  let entries = stores.get(store)
  if (!entries) stores.set(store, (entries = new Map()))
  const now = Date.now()
  for (const [k, v] of entries) if (now - v.at > ttlMs) entries.delete(k)
  const hit = entries.get(key)
  if (hit) return hit.value as Promise<T>
  const map = entries
  const value = load().catch((error: unknown) => {
    if (map.get(key)?.value === value) map.delete(key)
    throw error
  })
  map.set(key, { at: now, value })
  return value
}
