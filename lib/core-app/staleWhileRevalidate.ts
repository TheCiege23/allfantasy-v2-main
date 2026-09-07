/**
 * A small in-process cache that serves what it has and refreshes behind the
 * request: fresh → the value; stale → the stale value at once and ONE refresh
 * in the background; missing → one load, shared by everyone who asks while it
 * runs. A failed refresh keeps the stale value and is swallowed; a failed
 * first load rejects for the callers waiting on it and caches nothing.
 *
 * ⚠ THE BACKGROUND REFRESH IS WHERE THIS KIND OF CACHE GOES WRONG. The
 * suggestion module's roster-count refresh ran with no rejection handler on
 * its stale path (the gate's review, 2026-09-06); a rejected promise nobody
 * awaits is an unhandled rejection, which on Node 15+ is a process crash.
 * Every refresh here is caught, and the test proves it.
 *
 * Bounded: entries are dropped least-recently-used past the cap, and the TTL
 * is checked on read, so an entry for a key nobody asks for again simply ages
 * out when it is next evicted. Pure over `now`, so the tests need no clock.
 */

export type SwrStats = { hits: number; staleHits: number; misses: number; refreshes: number; failures: number }

export type SwrCache<T> = {
  get(key: string, load: () => Promise<T>, now?: number): Promise<T>
  /** The cached value if any, fresh or stale, without loading. */
  peek(key: string): T | undefined
  size(): number
  clear(): void
  stats(): SwrStats
}

export function createSwrCache<T>(opts: { ttlMs: number; cap: number }): SwrCache<T> {
  const entries = new Map<string, { value: T; at: number }>()
  const inflight = new Map<string, Promise<T>>()
  const stats: SwrStats = { hits: 0, staleHits: 0, misses: 0, refreshes: 0, failures: 0 }

  const touch = (key: string, entry: { value: T; at: number }) => {
    // Re-insertion moves the key to the end; the first key is the least recently used.
    entries.delete(key)
    entries.set(key, entry)
    while (entries.size > opts.cap) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  const start = (key: string, load: () => Promise<T>, at: number): Promise<T> => {
    const existing = inflight.get(key)
    if (existing) return existing
    const p = load()
      .then((value) => {
        touch(key, { value, at })
        return value
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, p)
    return p
  }

  return {
    async get(key, load, now = Date.now()) {
      const hit = entries.get(key)
      if (hit && now - hit.at < opts.ttlMs) {
        stats.hits += 1
        touch(key, hit)
        return hit.value
      }
      if (hit) {
        // Stale: hand it back now, refresh once behind it, and never let that refresh throw at nobody.
        stats.staleHits += 1
        if (!inflight.has(key)) {
          stats.refreshes += 1
          start(key, load, now).catch(() => {
            stats.failures += 1
          })
        }
        return hit.value
      }
      stats.misses += 1
      return start(key, load, now)
    },
    peek(key) {
      return entries.get(key)?.value
    },
    size() {
      return entries.size
    },
    clear() {
      entries.clear()
      inflight.clear()
      stats.hits = stats.staleHits = stats.misses = stats.refreshes = stats.failures = 0
    },
    stats() {
      return { ...stats }
    },
  }
}
