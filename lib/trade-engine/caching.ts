// lib/trade-engine/caching.ts
// Performance & caching utilities

export type CacheKey =
  | `league:${string}:intel`
  | `league:${string}:assets`
  | `user:${string}:reputation`
  | `fantasycalc:${string}`

export type CacheEntry<T> = {
  data: T
  cachedAt: number
  expiresAt: number
}

export type CacheTTL = {
  leagueIntel: number
  fantasyCalcValues: number
  managerReputation: number
}

const memoryCache = new Map<string, CacheEntry<unknown>>()

export function getCacheKey(type: 'intel' | 'assets' | 'reputation' | 'fantasycalc', id: string): CacheKey {
  switch (type) {
    case 'intel':
      return `league:${id}:intel`
    case 'assets':
      return `league:${id}:assets`
    case 'reputation':
      return `user:${id}:reputation`
    case 'fantasycalc':
      return `fantasycalc:${id}`
  }
}

export function setCache<T>(key: CacheKey, data: T, ttlMs: number): void {
  const now = Date.now()
  memoryCache.set(key, {
    data,
    cachedAt: now,
    expiresAt: now + ttlMs,
  })
}

export function getCache<T>(key: CacheKey): T | null {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null

  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key)
    return null
  }

  return entry.data
}

export function invalidateCache(key: CacheKey): void {
  memoryCache.delete(key)
}

export function invalidateLeagueCache(leagueId: string): void {
  invalidateCache(`league:${leagueId}:intel`)
  invalidateCache(`league:${leagueId}:assets`)
}

export type InvalidationTrigger =
  | 'trade_accepted'
  | 'waiver_processed'
  | 'roster_change'
  | 'league_setting_change'

export function handleInvalidationTrigger(trigger: InvalidationTrigger, leagueId: string): void {
  switch (trigger) {
    case 'trade_accepted':
    case 'waiver_processed':
    case 'roster_change':
      invalidateLeagueCache(leagueId)
      break
    case 'league_setting_change':
      invalidateLeagueCache(leagueId)
      break
  }
}

export async function withCache<T>(
  key: CacheKey,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const cached = getCache<T>(key)
  if (cached !== null) {
    return cached
  }

  const data = await fetcher()
  setCache(key, data, ttlMs)
  return data
}

export function getCacheStats(): {
  entries: number
  keys: string[]
} {
  return {
    entries: memoryCache.size,
    keys: Array.from(memoryCache.keys()),
  }
}

// Simple generic cache helpers
export function cacheGet<T>(key: string): T | null {
  const entry = memoryCache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    memoryCache.delete(key)
    return null
  }
  return entry.data
}

export function cacheSet<T>(key: string, v: T, ttlMs: number): void {
  const now = Date.now()
  memoryCache.set(key, {
    data: v,
    cachedAt: now,
    expiresAt: now + ttlMs,
  })
}

export function cacheDel(key: string): void {
  memoryCache.delete(key)
}

export function cacheClearPrefix(prefix: string): void {
  for (const k of memoryCache.keys()) {
    if (k.startsWith(prefix)) memoryCache.delete(k)
  }
}
