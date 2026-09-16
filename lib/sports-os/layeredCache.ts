/**
 * Sports OS — point 5: layered caching with explicit expiration, and point 9's delivery mechanism.
 *
 * One read-through path that composes the tiers we actually have:
 *
 *   in-process memory  →  a durable tier (Postgres `sportsDataCache`, Redis, …)  →  compute
 *
 * and returns a `Fresh<T>`, so a caller cannot receive a cached value without also receiving its
 * age. Stale-while-revalidate is the default: past the TTL the last-known value is returned
 * IMMEDIATELY and a refresh runs behind it.
 *
 * ⚠ READ-THROUGH AND SELF-POPULATING, ON PURPOSE. CLAUDE.md records why: `ingestCFBDStats` had no
 * scheduled caller, so `DevyPlayer` stat columns were never refreshed and a surface pointed at them
 * served nulls while looking correct. `getFantasyCalcValuesDbFirst` does not have that failure mode
 * because a cold cache costs one compute rather than a wrong answer. This is that shape, generalised
 * — so wiring a scheduled refresh is a latency and quota win here, never a correctness prerequisite.
 *
 * ⚠ ONLY SUCCESSES ARE CACHED. Writing a failure turns one transient provider outage into a TTL's
 * worth of "this does not exist" — the same rule the weather geocode carries.
 *
 * ⚠ A DURABLE TIER IS INJECTED, NEVER IMPORTED. This module must stay usable from a unit test and
 * from the browser bundle's type graph, so it takes a `DurableCacheTier` rather than reaching for
 * prisma. `lib/sports-os/summaries.ts` is where a real one gets wired in.
 */

import { type Fresh, isStale, withSource } from './freshness'

export type DurableCacheTier = {
  read: (key: string) => Promise<Fresh<unknown> | null>
  write: (key: string, entry: Fresh<unknown>) => Promise<void>
  remove?: (key: string) => Promise<void>
}

export type LayeredCacheOptions<T> = {
  key: string
  /** How long a value counts as current. */
  ttlMs: number
  /**
   * How long past the TTL a value may still be SERVED while a refresh runs. `0` disables
   * stale-while-revalidate: past the TTL the caller waits for the recompute.
   */
  staleWhileRevalidateMs?: number
  compute: () => Promise<T>
  durable?: DurableCacheTier | null
  /** Skip every cached tier and recompute. The result is still written back. */
  forceRefresh?: boolean
  /** Injected for tests. */
  now?: () => number
  /** Called when a background revalidation rejects. Never rethrows into the caller. */
  onRevalidateError?: (error: unknown) => void
}

type MemoryEntry = { entry: Fresh<unknown>; expiresAt: number }

const MEMORY_MAX_ENTRIES = 500

// Survives HMR and request boundaries, like `lib/events/eventBus.ts`'s bus singleton.
const g = globalThis as typeof globalThis & {
  __afSportsOsMemoryCache?: Map<string, MemoryEntry>
  __afSportsOsInFlight?: Map<string, Promise<unknown>>
}
const memory: Map<string, MemoryEntry> = (g.__afSportsOsMemoryCache ??= new Map())
/** Single-flight: N concurrent misses on one key run ONE compute, not N. */
const inFlight: Map<string, Promise<unknown>> = (g.__afSportsOsInFlight ??= new Map())

function evictIfNeeded(nowMs: number): void {
  if (memory.size <= MEMORY_MAX_ENTRIES) return
  for (const [key, held] of memory) {
    if (nowMs >= held.expiresAt) memory.delete(key)
  }
  if (memory.size <= MEMORY_MAX_ENTRIES) return
  // Still over: drop oldest-written first.
  const ordered = [...memory.entries()].sort((a, b) => a[1].entry.fetchedAt - b[1].entry.fetchedAt)
  for (const [key] of ordered.slice(0, memory.size - MEMORY_MAX_ENTRIES)) memory.delete(key)
}

function readMemory(key: string, nowMs: number): Fresh<unknown> | null {
  const held = memory.get(key)
  if (!held) return null
  // The hold window covers TTL + SWR; past it the value is not servable at all.
  if (nowMs >= held.expiresAt) {
    memory.delete(key)
    return null
  }
  return held.entry
}

function writeMemory(key: string, entry: Fresh<unknown>, holdMs: number, nowMs: number): void {
  evictIfNeeded(nowMs)
  memory.set(key, { entry, expiresAt: nowMs + Math.max(0, holdMs) })
}

/**
 * Read `key` through the tiers, computing on a miss.
 *
 * Returns `source: 'live'` for a computed value, `'cache'` for one inside its TTL, and
 * `'last-known'` for one past it that is being refreshed behind the caller's back.
 */
export async function readThrough<T>(options: LayeredCacheOptions<T>): Promise<Fresh<T>> {
  const now = options.now ?? Date.now
  const ttlMs = Math.max(0, options.ttlMs)
  const swrMs = Math.max(0, options.staleWhileRevalidateMs ?? 0)
  const holdMs = ttlMs + swrMs
  const { key, durable } = options

  const computeAndStore = async (): Promise<Fresh<T>> => {
    // Join an in-flight compute rather than starting a second one.
    const existing = inFlight.get(key) as Promise<Fresh<T>> | undefined
    if (existing) return existing
    const run = (async (): Promise<Fresh<T>> => {
      const data = await options.compute()
      const entry: Fresh<T> = { data, fetchedAt: now(), source: 'live', staleAfterMs: ttlMs }
      writeMemory(key, entry, holdMs, now())
      if (durable) {
        // A durable-tier failure must not fail the read — the value is already correct.
        try {
          await durable.write(key, entry)
        } catch (error) {
          options.onRevalidateError?.(error)
        }
      }
      return entry
    })()
    inFlight.set(key, run)
    try {
      return await run
    } finally {
      inFlight.delete(key)
    }
  }

  if (options.forceRefresh) return computeAndStore()

  const nowMs = now()
  let candidate = readMemory(key, nowMs)

  if (!candidate && durable) {
    try {
      const stored = await durable.read(key)
      if (stored) {
        candidate = stored
        /**
         * Promote the entry UNCHANGED.
         *
         * 🛑 `fetchedAt` MUST SURVIVE THE HOP. Staleness is judged from it, so re-stamping it here
         * would make a hop between tiers look like a refresh and the value would never go stale
         * again — the one bug in this file that produces a permanently wrong screen with nothing
         * red anywhere. The regression test for it is the mutation control, not the assertion.
         *
         * The hold window is the remainder of the entry's own, never a fresh full one, so memory
         * does not retain an entry the durable tier has already given up on. That part is
         * housekeeping: it is not what stops the value going immortal.
         */
        const remaining = stored.staleAfterMs === null ? holdMs : stored.fetchedAt + holdMs - nowMs
        if (remaining > 0) writeMemory(key, stored, remaining, nowMs)
      }
    } catch (error) {
      options.onRevalidateError?.(error)
    }
  }

  if (!candidate) return computeAndStore()

  const stale = isStale({ fetchedAt: candidate.fetchedAt, staleAfterMs: ttlMs }, nowMs)
  if (!stale) return withSource(candidate as Fresh<T>, 'cache')

  if (swrMs <= 0) return computeAndStore()

  // Stale but inside the SWR window: hand back what we have and refresh behind it.
  void computeAndStore().catch((error) => options.onRevalidateError?.(error))
  return withSource(candidate as Fresh<T>, 'last-known')
}

/** Drop one key from memory, and from the durable tier when it supports removal. */
export async function invalidate(key: string, durable?: DurableCacheTier | null): Promise<void> {
  memory.delete(key)
  if (durable?.remove) {
    try {
      await durable.remove(key)
    } catch {
      // An invalidation that throws would fail the write that triggered it. The memory tier is
      // already clear and the durable entry still carries its own TTL.
    }
  }
}

/** Drop every memory key under a prefix. Returns how many went. */
export function invalidatePrefix(prefix: string): number {
  let removed = 0
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) {
      memory.delete(key)
      removed++
    }
  }
  return removed
}

/** Test seam. Never call from application code. */
export function __resetLayeredCacheForTests(): void {
  memory.clear()
  inFlight.clear()
}
