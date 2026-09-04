import { createHash } from 'crypto'

/**
 * Generic DB-first cache for any external API call.
 * Uses the SportsDataCache table (key/value + TTL).
 *
 * Usage:
 *   const data = await cachedFetch('openai:waiver:leagueX', 3600, () => openaiCall(...))
 */

function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 64)
}

function buildCacheKey(prefix: string, identifier: string): string {
  return `${prefix}:${hashKey(identifier)}`
}

/** Lazy prisma import — prevents client-side bundle contamination. */
async function getPrisma() {
  const { prisma } = await import('@/lib/prisma')
  return prisma
}

/**
 * Check DB cache first. On miss or stale, call `fetcher()`, save result, return it.
 * @param key   Unique cache key (e.g. "grok:injury-digest:nfl")
 * @param ttlSeconds  How long the cached value is valid
 * @param fetcher  Async function that calls the external API
 * @param shouldCache  Optional guard: skip the write when it returns false (e.g. an
 *   empty array that might be a transient read racing a writer, not a real answer).
 *   Defaults to always caching, matching every existing caller's behavior.
 * @returns The cached or freshly fetched data
 */
export async function cachedFetch<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  shouldCache: (data: T) => boolean = () => true,
): Promise<T> {
  const cacheKey = buildCacheKey('api', key)

  // 1. Check DB
  try {
    const prisma = await getPrisma()
    const cached = await prisma.sportsDataCache.findUnique({
      where: { cacheKey },
    })
    if (cached && cached.expiresAt > new Date()) {
      return cached.data as T
    }
  } catch {
    // Cache read failed — proceed to fetch
  }

  // 2. Fetch from external API
  const data = await fetcher()

  // 3. Save to DB (fire-and-forget), unless the caller says this result shouldn't be
  // trusted for the TTL window — writing a miss would turn one transient read into a
  // long-lived wrong answer for everyone hitting this key until it expires.
  if (shouldCache(data)) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    try {
      const prisma = await getPrisma()
      await prisma.sportsDataCache.upsert({
        where: { cacheKey },
        update: { data: data as object, expiresAt },
        create: { cacheKey, data: data as object, expiresAt },
      })
    } catch {
      // Cache write failed — non-fatal
    }
  }

  return data
}

/**
 * Build a stable cache key from a prefix + arbitrary params.
 * Deterministic: same inputs always produce the same key.
 */
export function cacheKey(prefix: string, ...parts: unknown[]): string {
  return `${prefix}:${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(':')}`
}
