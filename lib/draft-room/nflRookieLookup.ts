/**
 * D.7 — NFL rookie / years-of-experience lookup.
 *
 * Sleeper's player payload (cached 24h in `lib/sleeper-client`) includes a
 * `years_exp` field that is the authoritative source of "first NFL season"
 * for redraft / dynasty rookie filtering. We build a Map keyed by
 * `<normalized name>|<position>` so the resolved draft pool can attach
 * `yearsExp` (and a derived `isRookie` flag) onto each row before
 * `normalizeDraftPlayer` runs.
 *
 * DB-FIRST cold-start resilience: when Sleeper is reachable we persist a
 * compact `{ bySleeperId, byNamePos, byName }` map to `SportsDataCache`
 * (key `sleeper:nfl:yearsexp:compact:v1`, TTL 24 h). On a cold-start process
 * restart where Sleeper is unreachable the lookup is rebuilt from that cached
 * row instead, so `yearsExp` / `isRookie` remain reliable without a live API
 * call.
 *
 * Keep this module side-effect-free regarding Sleeper: it does NOT mutate
 * Sleeper's cache and NEVER throws — Sleeper failures degrade to "rookie data
 * unavailable" in the UI rather than breaking the pool fetch.
 */

import { getAllPlayers, type SleeperPlayer } from '@/lib/sleeper-client'
import { prisma } from '@/lib/prisma'

const DB_CACHE_KEY = 'sleeper:nfl:yearsexp:compact:v1'
const DB_CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 h

type CompactYearsExpPayload = {
  v: 1
  bySleeperId: Record<string, number>
  byNamePos: Record<string, number>
  byName: Record<string, number>
}

/** Persist a compact yearsExp map to SportsDataCache. Fire-and-forget — never throws. */
async function saveYearsExpToDb(
  bySleeperId: Map<string, RookieMetadataRow>,
  byNamePos: Map<string, RookieMetadataRow>,
  byName: Map<string, RookieMetadataRow>,
): Promise<void> {
  try {
    const payload: CompactYearsExpPayload = {
      v: 1,
      bySleeperId: Object.fromEntries(
        Array.from(bySleeperId.entries())
          .filter(([, v]) => v.yearsExp != null)
          .map(([k, v]) => [k, v.yearsExp as number]),
      ),
      byNamePos: Object.fromEntries(
        Array.from(byNamePos.entries())
          .filter(([, v]) => v.yearsExp != null)
          .map(([k, v]) => [k, v.yearsExp as number]),
      ),
      byName: Object.fromEntries(
        Array.from(byName.entries())
          .filter(([, v]) => v.yearsExp != null)
          .map(([k, v]) => [k, v.yearsExp as number]),
      ),
    }
    const expiresAt = new Date(Date.now() + DB_CACHE_TTL_MS)
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: DB_CACHE_KEY },
      update: { data: payload as object, expiresAt },
      create: { cacheKey: DB_CACHE_KEY, data: payload as object, expiresAt },
    })
  } catch {
    // Non-fatal: DB write failure does not affect the current lookup.
  }
}

/** Try to rebuild lookup maps from a previously persisted SportsDataCache row. */
async function loadYearsExpFromDb(): Promise<NflRookieLookup | null> {
  try {
    const cached = await prisma.sportsDataCache.findUnique({
      where: { cacheKey: DB_CACHE_KEY },
      select: { data: true, expiresAt: true },
    })
    if (!cached || cached.expiresAt <= new Date()) return null
    const payload = cached.data as Partial<CompactYearsExpPayload>
    if (payload?.v !== 1) return null

    const byNamePos = new Map<string, RookieMetadataRow>()
    const byName = new Map<string, RookieMetadataRow>()
    const bySleeperId = new Map<string, RookieMetadataRow>()

    for (const [k, v] of Object.entries(payload.bySleeperId ?? {})) {
      if (Number.isFinite(v)) bySleeperId.set(k, { yearsExp: v, sleeperId: k })
    }
    for (const [k, v] of Object.entries(payload.byNamePos ?? {})) {
      if (Number.isFinite(v)) byNamePos.set(k, { yearsExp: v })
    }
    for (const [k, v] of Object.entries(payload.byName ?? {})) {
      if (Number.isFinite(v)) byName.set(k, { yearsExp: v })
    }

    const hasData = bySleeperId.size > 0 || byNamePos.size > 0
    if (!hasData) return null
    return { byNamePos, byName, bySleeperId, hasData }
  } catch {
    return null
  }
}

export type RookieMetadataRow = {
  yearsExp: number | null
  /** Sleeper's player_id when present; useful for diagnostics. */
  sleeperId?: string | null
}

export type NflRookieLookup = {
  /** Look up by `<normalized lowercase name>|<uppercase position>`. */
  byNamePos: Map<string, RookieMetadataRow>
  /** Loose fallback by `<normalized lowercase name>` when position is missing/unknown. */
  byName: Map<string, RookieMetadataRow>
  /** Strongest key when present: Sleeper player_id. */
  bySleeperId: Map<string, RookieMetadataRow>
  /** True when the upstream Sleeper fetch returned at least one usable years_exp record. */
  hasData: boolean
}

/** Where `years_exp` map rows were materialized (for NFL rookie diagnostics). */
export type NflRookieFetchSource = 'sleeper_live' | 'sportsdatacache_compact'

export type NflRookieLookupResult = {
  lookup: NflRookieLookup
  fetchSource: NflRookieFetchSource
}

const EMPTY_LOOKUP: NflRookieLookup = {
  byNamePos: new Map(),
  byName: new Map(),
  bySleeperId: new Map(),
  hasData: false,
}

function normName(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase()
}

function normPos(pos: string | null | undefined): string {
  return String(pos ?? '').trim().toUpperCase()
}

/**
 * Build a lookup table from Sleeper's NFL player cache. Returns a snapshot —
 * callers should not mutate it. Cheap when the Sleeper cache is warm
 * (24h TTL, in-process).
 *
 * DB-FIRST: on Sleeper failure the lookup falls back to a previously
 * persisted compact map in `SportsDataCache`. On Sleeper success the compact
 * map is written to `SportsDataCache` asynchronously (fire-and-forget).
 */
export async function loadNflRookieLookup(): Promise<NflRookieLookupResult> {
  let players: Record<string, SleeperPlayer> = {}
  let sleeperSucceeded = false
  try {
    players = await getAllPlayers()
    sleeperSucceeded = true
  } catch {
    // Sleeper unreachable — try DB fallback below.
  }

  // If Sleeper is unreachable (cold start), try to serve from DB cache.
  if (!sleeperSucceeded || Object.keys(players).length === 0) {
    const dbLookup = await loadYearsExpFromDb()
    if (dbLookup) return { lookup: dbLookup, fetchSource: 'sportsdatacache_compact' }
    return { lookup: EMPTY_LOOKUP, fetchSource: 'sportsdatacache_compact' }
  }

  const byNamePos = new Map<string, RookieMetadataRow>()
  const byName = new Map<string, RookieMetadataRow>()
  const bySleeperId = new Map<string, RookieMetadataRow>()
  let hasData = false

  for (const sp of Object.values(players)) {
    const fullName = sp.full_name || `${sp.first_name ?? ''} ${sp.last_name ?? ''}`.trim()
    const nameKey = normName(fullName)
    const posKey = normPos(sp.position)
    if (!nameKey) continue

    const yearsExpRaw = (sp as { years_exp?: number }).years_exp
    if (yearsExpRaw == null || !Number.isFinite(Number(yearsExpRaw))) continue
    const yearsExp = Number(yearsExpRaw)
    hasData = true

    const row: RookieMetadataRow = { yearsExp, sleeperId: sp.player_id ?? null }
    const compoundKey = `${nameKey}|${posKey}`
    if (!byNamePos.has(compoundKey)) byNamePos.set(compoundKey, row)
    if (!byName.has(nameKey)) byName.set(nameKey, row)
    const sid = String(sp.player_id ?? '').trim()
    if (sid && !bySleeperId.has(sid)) bySleeperId.set(sid, row)
  }

  // Persist to DB asynchronously so future cold starts can serve from cache.
  if (hasData) {
    saveYearsExpToDb(bySleeperId, byNamePos, byName).catch(() => {})
  }

  return { lookup: { byNamePos, byName, bySleeperId, hasData }, fetchSource: 'sleeper_live' }
}

/**
 * Resolve `years_exp` for a single (name, position) pair using a prebuilt
 * lookup. Returns `null` when no record matches — caller should treat that as
 * "rookie data unavailable for this row".
 */
export function lookupYearsExp(
  lookup: NflRookieLookup,
  name: string | null | undefined,
  position: string | null | undefined,
  sleeperId?: string | null,
): number | null {
  const sid = String(sleeperId ?? '').trim()
  if (sid) {
    const idHit = lookup.bySleeperId.get(sid)
    if (idHit) return idHit.yearsExp
  }
  const nameKey = normName(name)
  if (!nameKey) return null
  const posKey = normPos(position)
  const compoundHit = posKey ? lookup.byNamePos.get(`${nameKey}|${posKey}`) : undefined
  if (compoundHit) return compoundHit.yearsExp
  const nameHit = lookup.byName.get(nameKey)
  return nameHit?.yearsExp ?? null
}
