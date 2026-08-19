import type { ActivityFeedItem } from "@/lib/activity/types"

/**
 * Tiny in-process response cache for the League Buzz feed (`/api/shared/activity`).
 *
 * Why this exists — the same incident that produced the client-side fan-out fix (PR #241):
 * a browser tab loaded before that deploy kept polling this endpoint at ~6 req/s (one poll per
 * mounted `MyLeagueCard`, hundreds of cards) for 29+ hours, exhausting production Postgres. A
 * server deploy can't fix an already-loaded client bundle, so the endpoint defends itself. This
 * cache is the *coalescing* half of that defense (the per-user rate limit in the route is the
 * other half): a warmed entry is served straight from memory, so identical polls never re-open a
 * Postgres connection or re-run the source aggregation.
 *
 * Keying — the entry key is the full response signature (`userId + leagueId + limit`) because the
 * feed genuinely differs across those params; a response computed for one league must never be
 * served for another. That is deliberately a *different* key from the route's rate-limit bucket
 * (which is keyed on `userId` alone, so all of a session's per-league polls share one budget and
 * a card fan-out can't multiply it). Cache = correctness-keyed; rate limit = abuse-keyed.
 *
 * Sliding TTL — a hit refreshes the entry's expiry. A continuously-polled dashboard therefore
 * keeps its entries warm (served without touching Postgres and without consuming the rate-limit
 * budget), while a session that stops polling lets its entries age out within one TTL.
 *
 * Honest-empty is preserved: a genuinely empty successful aggregation is a real, cacheable value.
 * Only the route's error fallback is never cached, so a transient failure can't pin an empty feed.
 */

type CacheEntry = { items: ActivityFeedItem[]; expiresAt: number }

const activityCache = new Map<string, CacheEntry>()

/**
 * TTL for a cached feed. Set slightly above `useActivityFeed`'s 90s poll interval so a card that
 * is polled every 90s keeps its entry warm across consecutive polls (each hit slides the expiry).
 */
export const ACTIVITY_CACHE_TTL_MS = 100_000

// Hard cap on the map. A Vercel function instance can serve many distinct users before it
// restarts; without eviction the map would grow one entry per (user, league, limit) triplet
// forever. Mirrors the bound in lib/rate-limit.ts.
const ACTIVITY_CACHE_MAX_SIZE = 2_000

/** Stable cache key for a feed response. Undefined params fold to a fixed token so the key is total. */
export function buildActivityCacheKey(userId: string, leagueId: string | undefined, limit: number): string {
  return `${userId}::${leagueId ?? "*"}::${limit}`
}

/**
 * Evict expired entries first; if still over `maxSize`, drop the entries closest to expiry
 * (LRU-ish, since a sliding TTL pushes recently-hit entries furthest out). O(n) only when the
 * map actually exceeds the cap.
 */
function evictIfOversized(now: number): void {
  if (activityCache.size <= ACTIVITY_CACHE_MAX_SIZE) return
  for (const [k, v] of activityCache) {
    if (now >= v.expiresAt) activityCache.delete(k)
    if (activityCache.size <= ACTIVITY_CACHE_MAX_SIZE) return
  }
  if (activityCache.size > ACTIVITY_CACHE_MAX_SIZE) {
    const entries = Array.from(activityCache.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt)
    const evictCount = Math.ceil(entries.length * 0.2)
    for (let i = 0; i < evictCount; i++) activityCache.delete(entries[i]![0])
  }
}

/**
 * Return a fresh cached feed for `key`, or null on miss/expiry. A hit slides the entry's TTL so a
 * steadily-polled key stays warm. Returns a defensive copy so callers can't mutate the stored feed.
 */
export function getCachedActivityFeed(key: string, now: number = Date.now()): ActivityFeedItem[] | null {
  const entry = activityCache.get(key)
  if (!entry) return null
  if (now >= entry.expiresAt) {
    activityCache.delete(key)
    return null
  }
  entry.expiresAt = now + ACTIVITY_CACHE_TTL_MS
  return entry.items.slice()
}

/** Cache a successful feed aggregation (including a genuinely empty one). */
export function setCachedActivityFeed(key: string, items: ActivityFeedItem[], now: number = Date.now()): void {
  evictIfOversized(now)
  activityCache.set(key, { items: items.slice(), expiresAt: now + ACTIVITY_CACHE_TTL_MS })
}

/** Test/observability helpers. */
export function getActivityFeedCacheSize(): number {
  return activityCache.size
}

export function clearActivityFeedCache(): void {
  activityCache.clear()
}
