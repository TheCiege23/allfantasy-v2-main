/**
 * A small bounded, time-limited in-process memo.
 *
 * Exists to stop hot read paths re-pulling the same large result from Postgres on every call.
 * Measured 2026-09-21: the NFL player pool's DB-backed cache row is 13 MB, and every cache HIT
 * transferred all 13 MB from Neon — "cached" saved CPU but not a byte of egress. A per-process
 * memo in front of it makes a repeat call cost nothing.
 *
 * ⚠ DISABLED UNDER THE TEST RUNNER BY DEFAULT. Module state survives between test cases in one
 * file, so a memo would hand case B the result case A's mocks produced. A test that exercises a
 * memo turns it on with `enabled: () => true`, or `AF_TTL_MEMO_IN_TESTS=1` for a module's own.
 */

export interface TtlMemo<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  clear(): void
  readonly size: number
}

export interface TtlMemoOptions {
  ttlMs: number | (() => number)
  /** Hard cap on entries; the oldest-inserted is dropped first. */
  maxEntries: number
  enabled?: () => boolean
}

const defaultEnabled = () =>
  process.env.NODE_ENV !== 'test' || process.env.AF_TTL_MEMO_IN_TESTS === '1'

export function createTtlMemo<T>(options: TtlMemoOptions): TtlMemo<T> {
  const store = new Map<string, { value: T; expiresAt: number }>()
  const enabled = options.enabled ?? defaultEnabled
  const ttl = () => (typeof options.ttlMs === 'function' ? options.ttlMs() : options.ttlMs)

  return {
    get(key) {
      if (!enabled()) return undefined
      const hit = store.get(key)
      if (!hit) return undefined
      if (hit.expiresAt <= Date.now()) {
        store.delete(key)
        return undefined
      }
      return hit.value
    },
    set(key, value) {
      if (!enabled()) return
      const now = Date.now()
      for (const [k, v] of store) if (v.expiresAt <= now) store.delete(k)
      store.delete(key)
      while (store.size >= options.maxEntries) {
        const oldest = store.keys().next().value
        if (oldest === undefined) break
        store.delete(oldest)
      }
      store.set(key, { value, expiresAt: now + ttl() })
    },
    clear() {
      store.clear()
    },
    get size() {
      return store.size
    },
  }
}
