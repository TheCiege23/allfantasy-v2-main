import { prisma as appPrisma } from '@/lib/prisma'
import crypto from 'crypto'

type PrismaLike = typeof appPrisma

export type CacheTier = 'news_context' | 'rolling_insights' | 'enrichment_aggregate' | 'news_intelligence' | 'player_outlook'

const TTL_MINUTES: Record<CacheTier, number> = {
  news_context: 15,
  rolling_insights: 10,
  enrichment_aggregate: 5,
  news_intelligence: 20,
  player_outlook: 60,
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const pairs = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
  return `{${pairs.join(',')}}`
}

function buildCacheKey(tier: CacheTier, params: Record<string, unknown>): string {
  const stable = stableStringify(params)
  const hash = crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16)
  return `${tier}:${hash}`
}

export async function readCache<T = unknown>(
  prisma: PrismaLike,
  tier: CacheTier,
  params: Record<string, unknown>
): Promise<{ data: T; fetchedAt: string } | null> {
  const key = buildCacheKey(tier, params)

  try {
    const row = await prisma.sportsDataCache.findUnique({
      where: { cacheKey: key },
      select: {
        data: true,
        createdAt: true,
        expiresAt: true,
      },
    })

    if (!row) return null

    if (row.expiresAt < new Date()) {
      prisma.sportsDataCache.deleteMany({ where: { cacheKey: key } }).catch(() => {})
      return null
    }

    return {
      data: row.data as T,
      fetchedAt: row.createdAt.toISOString(),
    }
  } catch (err) {
    console.warn(`[EnrichmentCache] Read failed for ${tier}:`, err)
    return null
  }
}

export async function writeCache(
  prisma: PrismaLike,
  tier: CacheTier,
  params: Record<string, unknown>,
  data: unknown,
  _source: string = 'enrichment'
): Promise<void> {
  const key = buildCacheKey(tier, params)
  const ttlMs = TTL_MINUTES[tier] * 60 * 1000
  const expiresAt = new Date(Date.now() + ttlMs)

  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: key },
      update: {
        data: data as any,
        expiresAt,
      },
      create: {
        cacheKey: key,
        data: data as any,
        expiresAt,
      },
    })
  } catch (err) {
    console.warn(`[EnrichmentCache] Write failed for ${tier}:`, err)
  }
}

export async function purgeExpiredCache(prisma: PrismaLike): Promise<number> {
  try {
    const result = await prisma.sportsDataCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
    return result.count
  } catch (err) {
    console.warn('[EnrichmentCache] Purge failed:', err)
    return 0
  }
}