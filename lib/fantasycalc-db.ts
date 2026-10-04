import { prisma } from '@/lib/prisma'
import type { FantasyCalcPlayer, FantasyCalcPlayerIdentity, FantasyCalcSettings, PlayerValueLookup } from '@/lib/fantasycalc'
import { buildPlayerValuesForNames } from '@/lib/fantasycalc'
import { fetchFantasyCalcValues } from '@/lib/fantasycalc-fetch'
import {
  buildFantasyCalcCacheKey,
  packProfileCapture,
  profileCaptureDay,
  profileCaptureKey,
  PROFILE_CAPTURE_EXPIRES_AT,
} from '@/lib/fantasycalc-profile-capture'
import { toPrismaJsonInput } from '@/lib/prisma-json'

const KEY_PREFIX = 'fantasycalc:values:'

type CachedFantasyCalcPayload = {
  players: FantasyCalcPlayer[]
  settings: FantasyCalcSettings
  syncedAt: string
}

// The key format lives with the profile capture, which needs it without importing this module.
export { buildFantasyCalcCacheKey }

function parseCachedPayload(data: unknown): CachedFantasyCalcPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const payload = data as Partial<CachedFantasyCalcPayload>
  if (!Array.isArray(payload.players)) return null
  if (!payload.settings || typeof payload.settings !== 'object') return null
  if (typeof payload.syncedAt !== 'string') return null
  return payload as CachedFantasyCalcPayload
}

/**
 * Every player identity held in ANY cached FantasyCalc profile — one Postgres read, never a fetch.
 *
 * FantasyCalc hands us each player's id on several platforms at once (`sleeperId`, `mflId`,
 * `fleaflickerId`, `espnId`). That makes the cache the cheapest honest bridge from those platforms'
 * roster ids to Sleeper ids (`lib/player-identity/fantasyCalcIdentityBridge.ts`). A stale row is as
 * good as a fresh one for this: a player's ids do not change when his value does.
 */
export async function readCachedFantasyCalcIdentities(): Promise<FantasyCalcPlayerIdentity[]> {
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: KEY_PREFIX } },
    select: { data: true },
  })
  const out: FantasyCalcPlayerIdentity[] = []
  for (const row of rows) {
    const payload = parseCachedPayload(row.data)
    if (!payload) continue
    for (const v of payload.players) if (v?.player) out.push(v.player)
  }
  return out
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

/**
 * Every settings profile this deployment has actually been asked for, newest sync first.
 *
 * 🛑 THE WARM LIST IS DERIVED FROM DEMAND, NOT HARDCODED. `scripts/sync-fantasycalc-valuations.ts`
 * warms three fixed profiles; production holds **22** (measured 2026-09-06), spanning teams
 * 8/10/12/14/16/32 and ppr 0.5/1 — so a fixed list covers ~14% and every other league shape still
 * pays a live fetch. The analyze path requests `{ isDynasty: true, numQbs, numTeams: leagueSize,
 * ppr: pprNfl }`, i.e. two of the four fields vary per league; no fixed list can keep up with that.
 *
 * ⚠ THE SETTINGS COME FROM THE ROW, NOT FROM PARSING THE KEY. `CachedFantasyCalcPayload` already
 * stores `settings`, so there is no need for an inverse of `buildFantasyCalcCacheKey` — and
 * therefore no second implementation of the key format to drift out of sync with the first. If you
 * are tempted to parse `cacheKey`, read the payload instead.
 */
export async function listCachedFantasyCalcProfiles(
  options?: { limit?: number }
): Promise<Array<{ cacheKey: string; settings: FantasyCalcSettings; syncedAt: string }>> {
  const rows = await prisma.sportsDataCache.findMany({
    where: { cacheKey: { startsWith: KEY_PREFIX } },
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 60,
    select: { cacheKey: true, data: true },
  })

  const out: Array<{ cacheKey: string; settings: FantasyCalcSettings; syncedAt: string }> = []
  for (const row of rows) {
    const payload = parseCachedPayload(row.data)
    // A row whose payload will not parse is skipped rather than guessed at: warming a profile we
    // cannot describe would write under a key derived from invented settings.
    if (!payload) continue
    out.push({ cacheKey: row.cacheKey, settings: payload.settings, syncedAt: payload.syncedAt })
  }
  return out
}

/**
 * Store today's board for one profile — ONCE per profile per UTC day, never overwritten. The first
 * successful warm of the day is the capture, with its real time recorded (`capturedAt`); every later
 * warm that day is a no-op here. See `lib/fantasycalc-profile-capture.ts` for the key and payload,
 * and `lib/decision-os/trade/datedMarket.ts` for the reader (a completed trade graded more than a day
 * after it happened is priced on its league's own profile from the trade date).
 *
 * `createMany` + `skipDuplicates` is `INSERT … ON CONFLICT DO NOTHING`: two overlapping warms cannot
 * both write, and neither can replace the other's row. Ingestion only — the warm cron is its caller.
 *
 * Resolves `true` when this call wrote the day's capture, `false` when one already existed.
 */
export async function captureFantasyCalcProfileDaily(
  settings: FantasyCalcSettings,
  players: FantasyCalcPlayer[],
  capturedAt: Date,
): Promise<boolean> {
  // An empty board is a vendor hiccup, not a market: it must not take the day's only slot.
  if (players.length === 0) return false
  const payload = packProfileCapture(settings, players, capturedAt)
  const written = await prisma.sportsDataCache.createMany({
    data: [{
      cacheKey: profileCaptureKey(settings, profileCaptureDay(capturedAt)),
      data: toPrismaJsonInput(payload),
      expiresAt: PROFILE_CAPTURE_EXPIRES_AT,
      createdAt: capturedAt,
    }],
    skipDuplicates: true,
  })
  return written.count > 0
}

export type FantasyCalcWarmResult = {
  attempted: number
  refreshed: number
  failed: number
  skippedFresh: number
  timedOut: boolean
  /** Profiles whose daily capture this run wrote (the first successful warm of the UTC day). */
  captured: number
  /** Capture writes that FAILED — the warm itself still succeeded. */
  captureFailed: number
  profiles: Array<{ cacheKey: string; ok: boolean; count?: number; error?: string; captured?: boolean; captureError?: string }>
}

/**
 * Refresh every demanded profile so a request never pays the vendor fetch itself.
 *
 * ⚠ ONE VENDOR CALL PER PROFILE, SEQUENTIAL, UNDER A DEADLINE. Sequential because 22 parallel
 * fetches at an unauthenticated public endpoint is the shape that gets an IP throttled, and the
 * whole point is that nobody is waiting on this. The deadline is checked BEFORE each fetch so a
 * slow vendor truncates the run instead of overrunning the cron budget; `timedOut` reports it
 * rather than letting a partial run look complete.
 *
 * ⚠ `minAgeMs` SKIPS PROFILES SYNCED VERY RECENTLY. Without it, two overlapping runs would each
 * re-fetch everything. It is not a freshness compromise — the default is well under the warm
 * interval.
 */
export async function warmFantasyCalcCache(options?: {
  limit?: number
  ttlMs?: number
  deadlineMs?: number
  minAgeMs?: number
}): Promise<FantasyCalcWarmResult> {
  const startedAt = Date.now()
  const deadlineMs = options?.deadlineMs ?? 120_000
  const minAgeMs = options?.minAgeMs ?? 1000 * 60 * 10
  const profiles = await listCachedFantasyCalcProfiles({ limit: options?.limit })

  const result: FantasyCalcWarmResult = {
    attempted: 0, refreshed: 0, failed: 0, skippedFresh: 0, timedOut: false, captured: 0, captureFailed: 0, profiles: [],
  }

  for (const profile of profiles) {
    const syncedMs = Date.parse(profile.syncedAt)
    if (Number.isFinite(syncedMs) && Date.now() - syncedMs < minAgeMs) {
      result.skippedFresh += 1
      continue
    }
    if (Date.now() - startedAt > deadlineMs) {
      result.timedOut = true
      break
    }
    result.attempted += 1
    try {
      const players = await fetchFantasyCalcValues(profile.settings)
      const syncedAt = new Date()
      const written = await writeFantasyCalcValuesToDb(profile.settings, players, {
        ttlMs: options?.ttlMs,
        syncedAt,
      })
      result.refreshed += 1
      const entry: FantasyCalcWarmResult['profiles'][number] = { cacheKey: written.cacheKey, ok: true, count: written.count }
      // After the warm landed, and contained: a failed capture must not mark a good warm as failed.
      try {
        entry.captured = await captureFantasyCalcProfileDaily(profile.settings, players, syncedAt)
        if (entry.captured) result.captured += 1
      } catch (error) {
        result.captureFailed += 1
        entry.captureError = error instanceof Error ? error.message : 'unknown error'
      }
      result.profiles.push(entry)
    } catch (error) {
      // One vendor failure must not abandon the remaining profiles.
      result.failed += 1
      result.profiles.push({
        cacheKey: profile.cacheKey,
        ok: false,
        error: error instanceof Error ? error.message : 'unknown error',
      })
    }
  }

  return result
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
  return (await getFantasyCalcChartDbFirst(settings, options)).players
}

/**
 * `getFantasyCalcValuesDbFirst`, plus WHEN the chart was synced from FantasyCalc — so a trade grade
 * can record the age of every market value it was taken on (2026-09-28).
 *
 * 🛑 `maxStaleMs` IS AN AGE LIMIT, AND UNTIL 2026-09-28 IT WAS NOT ONE. The old test was
 * `!stale || age <= maxStale`, and a row is only `stale` once past its 6 h expiry — so any unexpired
 * row was served whatever its age, and the trade chart's 2 h limit never applied: the real bound was
 * 6 h (trade price coverage audit). Guap chose freshness over speed (see the warm cron): the hourly
 * warm keeps rows under an hour old, and the 2 h limit is what forces a live fetch when it lapses.
 * Now a row older than the limit IS refetched.
 *
 * ⚠ AN OUTAGE STILL SERVES THE RECENT CHART. If that live fetch fails, a row still inside its own
 * expiry is returned with its TRUE sync time (every grade line now records it) rather than failing
 * a request the old code would have answered. Only a row past its expiry, or none, rethrows.
 */
export async function getFantasyCalcChartDbFirst(
  settings: FantasyCalcSettings,
  options?: { maxStaleMs?: number }
): Promise<{ players: FantasyCalcPlayer[]; syncedAt: string | null }> {
  const fromDb = await readFantasyCalcValuesFromDb(settings, { allowStale: true })
  const maxStale = options?.maxStaleMs ?? 1000 * 60 * 60 * 6
  const cached = fromDb.players.length > 0 ? { players: fromDb.players, syncedAt: fromDb.syncedAt } : null
  // No sync time means an unknown age, which is not "fresh enough".
  const ageMs = fromDb.syncedAt ? Date.now() - new Date(fromDb.syncedAt).getTime() : Infinity

  if (cached && ageMs <= maxStale) return cached

  let fresh: FantasyCalcPlayer[]
  try {
    fresh = await fetchFantasyCalcValues(settings)
  } catch (error) {
    // Only the VENDOR call falls back; a failed write below behaves exactly as it always has.
    if (cached && !fromDb.stale) return cached
    throw error
  }
  const syncedAt = new Date()
  await writeFantasyCalcValuesToDb(settings, fresh, { syncedAt })
  return { players: fresh, syncedAt: syncedAt.toISOString() }
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
