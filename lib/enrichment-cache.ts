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
      prisma.sportsDataCache.delete({ where: { cacheKey: key } }).catch(() => {})
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

/* ─────────────────────────── the expired-row purge ─────────────────────────── */

/**
 * The key families the purge may delete: every reader of these treats an expired row exactly as a
 * missing one, so deleting it changes nothing anyone sees.
 *
 * 🛑 AN ALLOW-LIST, NOT A TABLE-WIDE `expiresAt < now`. A census of every reader (2026-09-17)
 * found families that are read ON PURPOSE after they expire, several with nothing that rebuilds
 * them: `trade-grades:v2:` and `draft-report:v1:` (career and receipts history), `h2h:v2:` (read
 * with "EXPIRY IS IGNORED ON PURPOSE"), `fantasycalc:values:` (the warm list is built from these
 * rows), `player-valuations:` (unscheduled writer), `college-team-directory:v1` (writer never
 * called), `projection_accuracy:`, `league-context:rules:v1:`, the sports-router `<SPORT>:<type>:`
 * keys and `nfl-redraft-provider:` (served stale at any age), plus a dozen that fall back to an
 * expired row when a live fetch fails (`transactions:`, `rosters:`, `league-context:v1:`…).
 * A table-wide purge would have deleted all of them.
 *
 * ⚠ ADDING A FAMILY IS A CLAIM ABOUT EVERY READER OF IT. Name the reader line that ignores
 * expired rows, and check no other reader of the prefix serves them. A prefix is matched with
 * `startsWith`, so it must not be the start of any other family's keys.
 */
export const PURGEABLE_KEY_PREFIXES: readonly string[] = [
  // readCache above: an expired row returns null (and is deleted lazily). Keys are `<tier>:<16 hex>`.
  'rolling_insights:',
  'news_context:',
  'enrichment_aggregate:',
  'news_intelligence:',
  'player_outlook:',
  // lib/api-cache.ts cachedFetch: `expiresAt > now` or refetch. Keys are `api:<64 hex>`.
  'api:',
  // lib/ai/aiCache.ts getCachedAiAnswer returns null past expiry; aiUsageMonitor counts `gt now` only.
  'aic:',
  // lib/cfb-player-data.ts getCachedOrFetch, the only reader of `cfbd-*`: `expiresAt > now` or refetch.
  'cfbd-',
  // app/api/cron/morning-briefing: reads today's key only; rows live 7 days.
  'briefing-sent:v1:',
  // lib/adp-data.ts: both reads require `expiresAt > now`.
  'adp-multi-',
  'ffc-adp-',
  // lib/chat-core: lists filter `expiresAt > now`; the presence write throttle is 45s against a 15m row.
  'chat:presence:',
  'chat:typing:',
  // app/api/brackets/world-cup/[challengeId]/chat: null past expiry.
  'world-cup-chat:gifs:',
  // lib/sports-os/durableTier.ts read(): null past expiry. Rows are kept 24h, past every stale window.
  'sos:sum:',
  // lib/core-app/careerProfile.ts readStored(): null past expiry.
  'core-career:profile:v',
  // lib/core-app/portfolioInsightsSummary.ts: reads at most 36 days back; rows live 400 days.
  'core-portfolio:totals:v1:',
]

/** Rows deleted per statement. */
export const PURGE_BATCH_SIZE = 500
/** Statements per call. 10 × 500 clears the ~700 purgeable rows measured 2026-09-17 in one hourly fire. */
export const PURGE_MAX_BATCHES = 10
/** Wall-clock cap per call, checked between batches. The host route's own `maxDuration` is 30s. */
export const PURGE_BUDGET_MS = 10_000
/**
 * How long past `expiresAt` a row is kept. Zero, because every family above already reads an
 * expired row as absent — a grace window would only matter for a family that should not be listed.
 */
export const PURGE_GRACE_MS = 0

export type CachePurgeResult = {
  /** False when the purge did not run — a zero `deleted` then means "did not look", not "nothing expired". */
  available: boolean
  deleted: number
  batches: number
  /** True when a cap stopped the purge, so expired rows may be left for the next call. */
  capped: boolean
  /** Rows whose `expiresAt` is strictly before this instant are eligible. */
  cutoff: string
  error?: string
}

/**
 * Delete expired `SportsDataCache` rows in the `PURGEABLE_KEY_PREFIXES` families, a bounded number
 * per call. Rows in any other family are never touched, expired or not.
 *
 * Scheduled from `/api/cron/reap-sync-runs` (hourly). Before 2026-09-17 nothing called this, and
 * 78% of the production table (3,448 of 4,436 rows) was expired. ~700 of those are in the families
 * above; the rest belong to readers that still use them.
 *
 * ⚠ SELECT, THEN DELETE WITH THE CUTOFF RE-ASSERTED. Prisma's `deleteMany` takes no `take`, so a
 * batch is chosen by key first. A writer can upsert one of those keys in between — a refresh moves
 * its `expiresAt` into the future — so the delete repeats `expiresAt < cutoff`, and a row refreshed
 * after it was selected survives. Deleting by key alone would throw away a value written a moment ago.
 * The delete repeats the family filter too, so the allow-list holds even if the read is changed.
 *
 * `lt`, not `lte`: a row expiring exactly at the cutoff has not yet passed it.
 *
 * `SPORTS_DATA_CACHE_PURGE_DISABLED=true` turns it off.
 */
export async function purgeExpiredCache(
  prisma: PrismaLike,
  opts: {
    now?: Date
    graceMs?: number
    batchSize?: number
    maxBatches?: number
    budgetMs?: number
    clock?: () => number
  } = {},
): Promise<CachePurgeResult> {
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - Math.max(0, opts.graceMs ?? PURGE_GRACE_MS))
  const out: CachePurgeResult = { available: true, deleted: 0, batches: 0, capped: false, cutoff: cutoff.toISOString() }
  if (String(process.env.SPORTS_DATA_CACHE_PURGE_DISABLED ?? '').toLowerCase() === 'true') {
    return { ...out, available: false, error: 'disabled' }
  }
  const batchSize = Math.max(1, opts.batchSize ?? PURGE_BATCH_SIZE)
  const maxBatches = Math.max(1, opts.maxBatches ?? PURGE_MAX_BATCHES)
  const budgetMs = opts.budgetMs ?? PURGE_BUDGET_MS
  const clock = opts.clock ?? Date.now
  const started = clock()
  const inFamilies = PURGEABLE_KEY_PREFIXES.map((prefix) => ({ cacheKey: { startsWith: prefix } }))

  try {
    for (;;) {
      if (out.batches >= maxBatches || clock() - started >= budgetMs) {
        out.capped = true
        break
      }
      const rows = await prisma.sportsDataCache.findMany({
        where: { expiresAt: { lt: cutoff }, OR: inFamilies },
        select: { cacheKey: true },
        orderBy: { expiresAt: 'asc' },
        take: batchSize,
      })
      if (rows.length === 0) break
      const result = await prisma.sportsDataCache.deleteMany({
        where: {
          AND: [{ cacheKey: { in: rows.map((r) => r.cacheKey) } }, { expiresAt: { lt: cutoff } }, { OR: inFamilies }],
        },
      })
      out.batches += 1
      out.deleted += result.count
      // A short page means the backlog is gone, so skip the extra empty read.
      if (rows.length < batchSize) break
    }
  } catch (err) {
    console.warn('[EnrichmentCache] Purge failed:', err)
    return { ...out, available: false, error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) }
  }
  return out
}