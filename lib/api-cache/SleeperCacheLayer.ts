/**
 * Sleeper API Cache Layer
 *
 * ALL Sleeper API calls should go through this layer.
 * Data is fetched from DB cache first; external API is only called
 * when cache is stale or missing.
 *
 * This cuts Sleeper RPMs dramatically by:
 * 1. Caching player data (24h TTL)
 * 2. Caching league data (5min TTL)
 * 3. Caching roster data (5min TTL)
 * 4. Caching user data (1h TTL)
 * 5. Caching matchup data (2min TTL during games, 30min otherwise)
 * 6. Deduplicating concurrent requests for the same resource
 */

import { prisma } from '@/lib/prisma'

// This module IS the DB-first cache gateway for Sleeper — all other call sites
// must go through it, and it hydrates the DB cache on miss/stale.
const BASE_URL = 'https://api.sleeper.app/v1' // db-first-exception: canonical cache gateway

type CacheEntry = {
  data: unknown
  fetchedAt: number
  ttlMs: number
}

// In-memory cache for hot data (prevents DB reads on every request)
const memoryCache = new Map<string, CacheEntry>()
const MAX_MEMORY_ENTRIES = 500

// Inflight request deduplication
const inflightRequests = new Map<string, Promise<unknown>>()

// TTL configuration (milliseconds)
const TTL = {
  players: 24 * 60 * 60 * 1000, // 24 hours
  league: 5 * 60 * 1000, // 5 minutes
  rosters: 5 * 60 * 1000, // 5 minutes
  users: 60 * 60 * 1000, // 1 hour
  matchups: 2 * 60 * 1000, // 2 minutes (live)
  matchups_stale: 30 * 60 * 1000, // 30 minutes (non-live)
  drafts: 10 * 60 * 1000, // 10 minutes
  transactions: 5 * 60 * 1000, // 5 minutes
  user_lookup: 60 * 60 * 1000, // 1 hour
}

/**
 * Fetch from cache first, then external API if stale.
 * Deduplicates concurrent requests for the same key.
 */
async function cachedFetch<T>(
  cacheKey: string,
  ttlMs: number,
  fetchFn: () => Promise<T>,
): Promise<T> {
  // 1. Check memory cache
  const memEntry = memoryCache.get(cacheKey)
  if (memEntry && Date.now() - memEntry.fetchedAt < memEntry.ttlMs) {
    return memEntry.data as T
  }

  // 2. Check DB cache
  const dbEntry = await prisma.sportsDataCache?.findUnique?.({
    where: { cacheKey },
    select: { data: true, expiresAt: true },
  }).catch(() => null)

  if (dbEntry?.expiresAt && Date.now() < dbEntry.expiresAt.getTime()) {
    const data = dbEntry.data as T
    setMemoryCache(cacheKey, data, ttlMs)
    return data
  }

  // 3. Deduplicate concurrent requests
  const inflight = inflightRequests.get(cacheKey)
  if (inflight) return inflight as Promise<T>

  // 4. Fetch from external API
  const promise = fetchFn().then(async (data) => {
    // Persist to DB
    await prisma.sportsDataCache?.upsert?.({
      where: { cacheKey },
      create: {
        cacheKey,
        data: data as object,
        expiresAt: new Date(Date.now() + ttlMs),
      },
      update: {
        data: data as object,
        expiresAt: new Date(Date.now() + ttlMs),
      },
      // Keep RETURNING to the key: `players:all` is 15 MB and was echoed back on every write.
      select: { cacheKey: true },
    }).catch(() => {})

    // Persist to memory
    setMemoryCache(cacheKey, data, ttlMs)
    inflightRequests.delete(cacheKey)
    return data
  }).catch((err) => {
    inflightRequests.delete(cacheKey)
    // If fetch fails, return stale cache if available
    if (memEntry) return memEntry.data as T
    if (dbEntry?.data) return dbEntry.data as T
    throw err
  })

  inflightRequests.set(cacheKey, promise)
  return promise
}

/** Exported only as a test seam for the eviction order; callers go through cachedFetch. */
export function setMemoryCache(key: string, data: unknown, ttlMs: number): void {
  if (memoryCache.size > MAX_MEMORY_ENTRIES) {
    // Evict the entries CLOSEST TO EXPIRY, not the ones fetched longest ago. Ordering by fetch
    // time always evicted `players:all` first — a 24h entry is by construction the oldest — so
    // once ~500 league/roster keys accumulated, the next trades-dashboard load re-read 15 MB
    // from Postgres. Expired entries sort first, which is the right first thing to drop.
    const soonest = [...memoryCache.entries()]
      .sort((a, b) => a[1].fetchedAt + a[1].ttlMs - (b[1].fetchedAt + b[1].ttlMs))
      .slice(0, 50)
    for (const [k] of soonest) memoryCache.delete(k)
  }
  memoryCache.set(key, { data, fetchedAt: Date.now(), ttlMs })
}

/** Test seam: which keys the in-memory layer currently holds. */
export function memoryCacheKeysForTest(): string[] {
  return [...memoryCache.keys()]
}

/**
 * A Sleeper failure that carries its HTTP status as a FIELD, not only in its message.
 *
 * ⚠ THE STATUS IS THE DIFFERENCE BETWEEN "RETRY" AND "NEVER". A 404 on a league means the league
 * is gone from Sleeper — permanent, same answer on every render. A 429 or 5xx is a blip. Callers
 * that treat those alike either hold a window open forever or close it over data they never read;
 * both have happened here. The message keeps the status too, for logs, but nothing should have to
 * parse it back out.
 */
export class SleeperHttpError extends Error {
  constructor(readonly status: number, path: string) {
    super(`Sleeper API ${status}: ${path}`)
    this.name = 'SleeperHttpError'
  }
}

async function sleeperGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Accept': 'application/json' },
    next: { revalidate: 60 },
  })
  if (!res.ok) throw new SleeperHttpError(res.status, path)
  return res.json() as Promise<T>
}

// ============================================================================
// PUBLIC API — All Sleeper calls should use these functions
// ============================================================================

/**
 * Get all NFL players (cached 24h).
 */
export async function getAllPlayers(): Promise<Record<string, unknown>> {
  return cachedFetch('players:all', TTL.players, () =>
    sleeperGet<Record<string, unknown>>('/players/nfl'),
  )
}

/**
 * Get league info (cached 5min).
 */
export async function getLeagueInfo(leagueId: string): Promise<Record<string, unknown>> {
  return cachedFetch(`league:${leagueId}`, TTL.league, () =>
    sleeperGet<Record<string, unknown>>(`/league/${leagueId}`),
  )
}

/**
 * Get league users (cached 5min).
 */
export async function getLeagueUsers(leagueId: string): Promise<Array<Record<string, unknown>>> {
  return cachedFetch(`league_users:${leagueId}`, TTL.league, () =>
    sleeperGet<Array<Record<string, unknown>>>(`/league/${leagueId}/users`),
  )
}

/**
 * Get league rosters (cached 5min).
 */
export async function getLeagueRosters(leagueId: string): Promise<Array<Record<string, unknown>>> {
  return cachedFetch(`rosters:${leagueId}`, TTL.rosters, () =>
    sleeperGet<Array<Record<string, unknown>>>(`/league/${leagueId}/rosters`),
  )
}

/**
 * Get league matchups for a week (cached 2min during games, 30min otherwise).
 */
export async function getLeagueMatchups(leagueId: string, week: number): Promise<Array<Record<string, unknown>>> {
  const isGameDay = isLikelyGameDay()
  const ttl = isGameDay ? TTL.matchups : TTL.matchups_stale
  return cachedFetch(`matchups:${leagueId}:${week}`, ttl, () =>
    sleeperGet<Array<Record<string, unknown>>>(`/league/${leagueId}/matchups/${week}`),
  )
}

/**
 * Get league drafts (cached 10min).
 */
export async function getLeagueDrafts(leagueId: string): Promise<Array<Record<string, unknown>>> {
  return cachedFetch(`drafts:${leagueId}`, TTL.drafts, () =>
    sleeperGet<Array<Record<string, unknown>>>(`/league/${leagueId}/drafts`),
  )
}

/**
 * Get draft picks (cached 10min).
 */
export async function getDraftPicks(draftId: string): Promise<Array<Record<string, unknown>>> {
  return cachedFetch(`draft_picks:${draftId}`, TTL.drafts, () =>
    sleeperGet<Array<Record<string, unknown>>>(`/draft/${draftId}/picks`),
  )
}

/**
 * Get league transactions (cached 5min).
 */
export async function getLeagueTransactions(leagueId: string, week: number): Promise<Array<Record<string, unknown>>> {
  return cachedFetch(`transactions:${leagueId}:${week}`, TTL.transactions, () =>
    sleeperGet<Array<Record<string, unknown>>>(`/league/${leagueId}/transactions/${week}`),
  )
}

/**
 * Get traded draft picks (cached 10min).
 */
export async function getTradedDraftPicks(leagueId: string): Promise<Array<Record<string, unknown>>> {
  return cachedFetch(`traded_picks:${leagueId}`, TTL.drafts, () =>
    sleeperGet<Array<Record<string, unknown>>>(`/league/${leagueId}/traded_picks`),
  )
}

/**
 * Lookup Sleeper user by username (cached 1h).
 */
export async function resolveSleeperUser(username: string): Promise<Record<string, unknown> | null> {
  return cachedFetch(`user:${username}`, TTL.user_lookup, () =>
    sleeperGet<Record<string, unknown> | null>(`/user/${username}`),
  )
}

/**
 * Get user's leagues for a sport/season (cached 1h).
 */
export async function getUserLeagues(userId: string, sport: string, season: string): Promise<Array<Record<string, unknown>>> {
  return cachedFetch(`user_leagues:${userId}:${sport}:${season}`, TTL.user_lookup, () =>
    sleeperGet<Array<Record<string, unknown>>>(`/user/${userId}/leagues/${sport}/${season}`),
  )
}

/**
 * Invalidate cache for a specific key.
 */
export async function invalidateCache(cacheKey: string): Promise<void> {
  memoryCache.delete(cacheKey)
  await prisma.sportsDataCache?.delete?.({ where: { cacheKey } }).catch(() => {})
}

/**
 * Invalidate all cache for a league (after import/sync).
 */
export async function invalidateLeagueCache(leagueId: string): Promise<void> {
  const keys = [...memoryCache.keys()].filter((k) => k.includes(leagueId))
  for (const k of keys) memoryCache.delete(k)
  await prisma.sportsDataCache?.deleteMany?.({
    where: { cacheKey: { contains: leagueId } },
  }).catch(() => {})
}

// ============================================================================
// HELPERS
// ============================================================================

function isLikelyGameDay(): boolean {
  const now = new Date()
  const day = now.getUTCDay()
  const hour = now.getUTCHours()
  // NFL: Thursday (4), Sunday (0), Monday (1) during game hours (17-05 UTC)
  if ([0, 1, 4].includes(day) && (hour >= 17 || hour <= 5)) return true
  // NBA/MLB/NHL: most weekdays during evening hours
  if (day >= 1 && day <= 5 && hour >= 23) return true
  return false
}

/**
 * Get cache stats for monitoring.
 */
export function getCacheStats(): { memoryEntries: number; inflightRequests: number } {
  return {
    memoryEntries: memoryCache.size,
    inflightRequests: inflightRequests.size,
  }
}
