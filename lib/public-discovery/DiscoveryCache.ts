/**
 * In-memory TTL cache for discovery league results (PROMPT 226).
 * Reduces DB load and speeds up pagination by reusing cached bracket/creator/fantasy lists.
 */

import type { DiscoveryCard } from "./types"

const TTL_MS = 60 * 1000 // 60 seconds
const MAX_CACHE_ENTRIES = 300

interface CacheEntry<T> {
  data: T
  expiresAt: number
}

const bracketCache = new Map<string, CacheEntry<DiscoveryCard[]>>()
const creatorCache = new Map<string, CacheEntry<DiscoveryCard[]>>()
const fantasyCache = new Map<string, CacheEntry<DiscoveryCard[]>>()
const computedDiscoveryListCache = new Map<
  string,
  CacheEntry<{
    cards: DiscoveryCard[]
    viewerTier: number
    hiddenByTierPolicy: number
  }>
>()

function now() {
  return Date.now()
}

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key)
  if (!entry || entry.expiresAt <= now()) {
    if (entry) map.delete(key)
    return null
  }
  return entry.data
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, data: T): void {
  map.set(key, { data, expiresAt: now() + TTL_MS })
  if (map.size > MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value
    if (oldestKey) map.delete(oldestKey)
  }
}

/** Cache key for bracket leagues: baseUrl + sport + query (query changes DB filter). */
function getBracketCacheKey(baseUrl: string, sport: string | null, query: string | null): string {
  return `bracket:${baseUrl}:${sport ?? "all"}:${(query ?? "").slice(0, 80)}`
}

/** Cache key for creator leagues: baseUrl + sport (query is applied in-memory after). */
function getCreatorCacheKey(baseUrl: string, sport: string | null): string {
  return `creator:${baseUrl}:${sport ?? "all"}`
}

/** Cache key for public fantasy leagues: baseUrl + sport + query (query changes DB filter). */
function getFantasyCacheKey(baseUrl: string, sport: string | null, query: string | null): string {
  return `fantasy:${baseUrl}:${sport ?? "all"}:${(query ?? "").slice(0, 80)}`
}

export function getCachedBracketCards(
  baseUrl: string,
  sport: string | null,
  query: string | null
): DiscoveryCard[] | null {
  return getCached(bracketCache, getBracketCacheKey(baseUrl, sport, query))
}

export function setCachedBracketCards(
  baseUrl: string,
  sport: string | null,
  query: string | null,
  cards: DiscoveryCard[]
): void {
  setCached(bracketCache, getBracketCacheKey(baseUrl, sport, query), cards)
}

export function getCachedCreatorCards(baseUrl: string, sport: string | null): DiscoveryCard[] | null {
  return getCached(creatorCache, getCreatorCacheKey(baseUrl, sport))
}

export function setCachedCreatorCards(
  baseUrl: string,
  sport: string | null,
  cards: DiscoveryCard[]
): void {
  setCached(creatorCache, getCreatorCacheKey(baseUrl, sport), cards)
}

export function getCachedFantasyCards(
  baseUrl: string,
  sport: string | null,
  query: string | null
): DiscoveryCard[] | null {
  return getCached(fantasyCache, getFantasyCacheKey(baseUrl, sport, query))
}

export function setCachedFantasyCards(
  baseUrl: string,
  sport: string | null,
  query: string | null,
  cards: DiscoveryCard[]
): void {
  setCached(fantasyCache, getFantasyCacheKey(baseUrl, sport, query), cards)
}

/** Private "ask to join" cards (privateLeagueRequests.ts): sport + query, kept apart from public ones. */
function getPrivateFantasyCacheKey(sport: string | null, query: string | null): string {
  return `private-fantasy:${sport ?? "all"}:${(query ?? "").slice(0, 80)}`
}

export function getCachedPrivateFantasyCards(sport: string | null, query: string | null): DiscoveryCard[] | null {
  return getCached(fantasyCache, getPrivateFantasyCacheKey(sport, query))
}

export function setCachedPrivateFantasyCards(sport: string | null, query: string | null, cards: DiscoveryCard[]): void {
  setCached(fantasyCache, getPrivateFantasyCacheKey(sport, query), cards)
}

/** Cache key for computed discovery lists (post-filter/sort, pre-pagination). */
export function getComputedDiscoveryListCacheKey(
  baseUrl: string,
  keyPayload: Record<string, unknown>
): string {
  return `computed:${baseUrl}:${JSON.stringify(keyPayload)}`
}

export function getCachedComputedDiscoveryList(
  key: string
): {
  cards: DiscoveryCard[]
  viewerTier: number
  hiddenByTierPolicy: number
} | null {
  return getCached(computedDiscoveryListCache, key)
}

export function setCachedComputedDiscoveryList(
  key: string,
  value: {
    cards: DiscoveryCard[]
    viewerTier: number
    hiddenByTierPolicy: number
  }
): void {
  setCached(computedDiscoveryListCache, key, value)
}

/** Optional: clear caches (e.g. after league create/update in admin). */
export function clearDiscoveryCache(): void {
  bracketCache.clear()
  creatorCache.clear()
  fantasyCache.clear()
  computedDiscoveryListCache.clear()
}
