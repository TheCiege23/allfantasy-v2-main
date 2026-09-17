/**
 * The durable tier for `layeredCache`, backed by the `SportsDataCache` table.
 *
 * Memory alone is per-process, and this repo runs two web replicas in `sfo` plus a worker, with a
 * fresh process on every deploy. A summary that only lives in memory is rebuilt on every deploy, by
 * every replica, for every user — which for `/core/standings` means re-reading every `WeeklyMatchup`
 * row the league has.
 *
 * ⚠ SEPARATE FROM `lib/sports-os/layeredCache.ts` ON PURPOSE. That module must stay importable from
 * a unit test and out of the browser bundle's type graph, so it takes a `DurableCacheTier` rather
 * than importing prisma. This file is where prisma is allowed in.
 *
 * ⚠ THIS IS A CACHE, NOT A SOURCE OF TRUTH, AND EVERY READ PATH HERE TREATS IT THAT WAY. A row that
 * is expired, malformed, or from a shape that no longer exists reads as a MISS, never as an error
 * and never as data. The caller then recomputes — which is exactly what a read-through cache is
 * for, and why a schema change here cannot produce a wrong screen.
 */

import 'server-only'

import { prisma } from '@/lib/prisma'
import type { DurableCacheTier } from './layeredCache'
import type { Fresh, FreshnessSource } from './freshness'

const VALID_SOURCES: ReadonlySet<string> = new Set<FreshnessSource>(['live', 'cache', 'last-known', 'none'])

/**
 * Is this JSON blob a `Fresh<unknown>` we wrote?
 *
 * ⚠ VALIDATED RATHER THAN CAST. `SportsDataCache.data` is a `Json` column shared with several other
 * writers (`lib/sports-router.ts`, the AI cache, the weather geocode). A bare cast would hand a
 * caller somebody else's payload shaped as an envelope, and the `fetchedAt` it renders as an age
 * would be whatever happened to sit at that key.
 */
function asEnvelope(value: unknown): Fresh<unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  if (!('data' in candidate)) return null
  if (typeof candidate.fetchedAt !== 'number' || !Number.isFinite(candidate.fetchedAt)) return null
  if (typeof candidate.source !== 'string' || !VALID_SOURCES.has(candidate.source)) return null
  const ttl = candidate.staleAfterMs
  if (ttl !== null && (typeof ttl !== 'number' || !Number.isFinite(ttl))) return null
  return {
    data: candidate.data,
    fetchedAt: candidate.fetchedAt,
    source: candidate.source as FreshnessSource,
    staleAfterMs: ttl as number | null,
  }
}

/**
 * How long a row is kept BEYOND the entry's own staleness window.
 *
 * The row has to outlive the TTL, or stale-while-revalidate could never serve a stale value from
 * this tier — the row would already be gone at exactly the moment it is wanted. This is the
 * eviction horizon, not the freshness rule; freshness is decided from `fetchedAt` by the caller.
 */
const ROW_RETENTION_MS = 24 * 60 * 60 * 1000

export function createSportsDataCacheTier(): DurableCacheTier {
  return {
    async read(key) {
      const row = await prisma.sportsDataCache.findUnique({
        where: { cacheKey: key },
        select: { data: true, expiresAt: true },
      })
      if (!row) return null
      // Expired rows are swept by `purgeExpiredCache` (lib/enrichment-cache.ts, hourly; `sos:sum:`
      // is on its allow-list). Do not trust that to have run, and do not delete from a read path.
      if (row.expiresAt.getTime() <= Date.now()) return null
      return asEnvelope(row.data)
    },

    async write(key, entry) {
      const expiresAt = new Date(Date.now() + ROW_RETENTION_MS)
      // `data` must be plain JSON. An envelope carrying a Date or a BigInt would throw here rather
      // than at read time, which is the better end to find out.
      const data = JSON.parse(JSON.stringify(entry)) as object
      await prisma.sportsDataCache.upsert({
        where: { cacheKey: key },
        create: { cacheKey: key, data, expiresAt },
        update: { data, expiresAt },
      })
    },

    async remove(key) {
      await prisma.sportsDataCache.delete({ where: { cacheKey: key } }).catch(() => undefined)
    },

    /**
     * ⚠ BOUNDED BY CONTRACT, NOT BY HOPE. `invalidateScreenForLeague` is the only caller and it
     * always passes a prefix naming ONE league, so this deletes that league's members × seasons —
     * tens of rows, not a table. A screen-wide prefix would be an unbounded DELETE from a sync path.
     */
    async removePrefix(prefix) {
      await prisma.sportsDataCache.deleteMany({ where: { cacheKey: { startsWith: prefix } } })
    },
  }
}

let cached: DurableCacheTier | null = null

/** Process-wide singleton, so every caller shares one tier. */
export function sportsDataCacheTier(): DurableCacheTier {
  return (cached ??= createSportsDataCacheTier())
}
