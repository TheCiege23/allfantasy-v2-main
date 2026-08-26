import { prisma } from '@/lib/prisma'
import type { FantasyCalcPlayer, FantasyCalcSettings, PlayerValueLookup } from '@/lib/fantasycalc'
import { fetchFantasyCalcValues, buildPlayerValuesForNames } from '@/lib/fantasycalc'
import { toPrismaJsonInput } from '@/lib/prisma-json'

const KEY_PREFIX = 'fantasycalc:values:'

type CachedFantasyCalcPayload = {
  players: FantasyCalcPlayer[]
  settings: FantasyCalcSettings
  syncedAt: string
}

export function buildFantasyCalcCacheKey(settings: FantasyCalcSettings): string {
  return `${KEY_PREFIX}dynasty:${settings.isDynasty ? '1' : '0'}:qbs:${settings.numQbs}:teams:${settings.numTeams}:ppr:${settings.ppr}`
}

function parseCachedPayload(data: unknown): CachedFantasyCalcPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const payload = data as Partial<CachedFantasyCalcPayload>
  if (!Array.isArray(payload.players)) return null
  if (!payload.settings || typeof payload.settings !== 'object') return null
  if (typeof payload.syncedAt !== 'string') return null
  return payload as CachedFantasyCalcPayload
}

export async function writeFantasyCalcValuesToDb(
  settings: FantasyCalcSettings,
  players: FantasyCalcPlayer[],
  options?: { ttlMs?: number; syncedAt?: Date }
): Promise<{ cacheKey: string; expiresAt: Date; count: number }> {
  const now = new Date()
  const ttlMs = options?.ttlMs ?? 1000 * 60 * 60 * 6
  const syncedAt = options?.syncedAt ?? now
  const expiresAt = new Date(now.getTime() + ttlMs)
  const cacheKey = buildFantasyCalcCacheKey(settings)

  const payload: CachedFantasyCalcPayload = {
    players,
    settings,
    syncedAt: syncedAt.toISOString(),
  }

  await prisma.sportsDataCache.upsert({
    where: { cacheKey },
    update: {
      data: toPrismaJsonInput(payload),
      expiresAt,
      createdAt: syncedAt,
    },
    create: {
      cacheKey,
      data: toPrismaJsonInput(payload),
      expiresAt,
      createdAt: syncedAt,
    },
  })

  return {
    cacheKey,
    expiresAt,
    count: players.length,
  }
}

export async function readFantasyCalcValuesFromDb(
  settings: FantasyCalcSettings,
  options?: { allowStale?: boolean }
): Promise<{
  players: FantasyCalcPlayer[]
  stale: boolean
  syncedAt: string | null
  expiresAt: string | null
}> {
  const allowStale = options?.allowStale ?? true
  const cacheKey = buildFantasyCalcCacheKey(settings)
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey } })

  if (!row) {
    return { players: [], stale: false, syncedAt: null, expiresAt: null }
  }

  const parsed = parseCachedPayload(row.data)
  if (!parsed) {
    return { players: [], stale: false, syncedAt: null, expiresAt: row.expiresAt.toISOString() }
  }

  const stale = row.expiresAt.getTime() <= Date.now()
  if (stale && !allowStale) {
    return {
      players: [],
      stale: true,
      syncedAt: parsed.syncedAt,
      expiresAt: row.expiresAt.toISOString(),
    }
  }

  return {
    players: parsed.players,
    stale,
    syncedAt: parsed.syncedAt,
    expiresAt: row.expiresAt.toISOString(),
  }
}

/**
 * Server-only path: read FantasyCalc valuations from `sportsDataCache` when fresh or tolerably stale;
 * otherwise fetch from FantasyCalc API once, persist, then return. Use this instead of calling
 * `fetchFantasyCalcValues` directly from API routes so calculations are DB-backed.
 */
export async function getFantasyCalcValuesDbFirst(
  settings: FantasyCalcSettings,
  options?: { maxStaleMs?: number }
): Promise<FantasyCalcPlayer[]> {
  const fromDb = await readFantasyCalcValuesFromDb(settings, { allowStale: true })
  const maxStale = options?.maxStaleMs ?? 1000 * 60 * 60 * 6

  if (fromDb.players.length > 0) {
    const syncedMs = fromDb.syncedAt ? Date.now() - new Date(fromDb.syncedAt).getTime() : Infinity
    if (!fromDb.stale || syncedMs <= maxStale) {
      return fromDb.players
    }
  }

  const fresh = await fetchFantasyCalcValues(settings)
  await writeFantasyCalcValuesToDb(settings, fresh)
  return fresh
}

/**
 * DB-first equivalent of `getPlayerValuesForNames`.
 *
 * Same shape, same empty-map-on-failure contract, but the values come through
 * `getFantasyCalcValuesDbFirst` instead of a live vendor call on the request
 * path. The name lookup itself is the adapter's own pure helper, so the two
 * paths cannot drift in how they shape a `PlayerValueLookup`.
 */
export async function getPlayerValuesForNamesDbFirst(
  names: string[],
  settings: FantasyCalcSettings = { isDynasty: true, numQbs: 2, numTeams: 12, ppr: 1 },
  options?: { maxStaleMs?: number }
): Promise<Map<string, PlayerValueLookup>> {
  try {
    const players = await getFantasyCalcValuesDbFirst(settings, options)
    return buildPlayerValuesForNames(players, names)
  } catch (error) {
    console.error('[fantasycalc-db] getPlayerValuesForNamesDbFirst failed:', error)
    return new Map<string, PlayerValueLookup>()
  }
}

/**
 * Age of the DB-backed valuation snapshot, or null when nothing is cached.
 *
 * The DB-first counterpart to `getValuationCacheAgeMs`, which reads the
 * adapter's in-process Map. Any surface that has moved to
 * `getFantasyCalcValuesDbFirst` MUST use this one instead: the in-process Map is
 * no longer populated on that path, so the old accessor silently answers null —
 * a freshness readout that reports "unknown" for data that is actually fresh.
 */
export async function getFantasyCalcCacheAgeMs(
  settings: FantasyCalcSettings
): Promise<number | null> {
  const { syncedAt } = await readFantasyCalcValuesFromDb(settings, { allowStale: true })
  if (!syncedAt) return null
  const ms = Date.now() - new Date(syncedAt).getTime()
  return Number.isFinite(ms) ? ms : null
}

export async function getFantasyCalcCacheHealth(): Promise<{
  totalKeys: number
  freshKeys: number
  latestSyncedAt: string | null
}> {
  const now = new Date()
  const [totalKeys, freshKeys, latest] = await Promise.all([
    prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: KEY_PREFIX } } }),
    prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: KEY_PREFIX }, expiresAt: { gt: now } } }),
    prisma.sportsDataCache.findFirst({
      where: { cacheKey: { startsWith: KEY_PREFIX } },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    }),
  ])

  const latestParsed = latest ? parseCachedPayload(latest.data) : null

  return {
    totalKeys,
    freshKeys,
    latestSyncedAt: latestParsed?.syncedAt ?? null,
  }
}
