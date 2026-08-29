import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'

/**
 * liveAdpFallback — ADP for the players the static CSV cannot see.
 *
 * WHY THIS EXISTS. `data/nfl-adp-multiplatform.csv` is a hand-placed export dated
 * 2026-03-08 — BEFORE the April 2026 draft — and no generator for it exists in this
 * repo, so it cannot be refreshed from here. It supplies four of the six ADP sources
 * (fantrax, sleeper, espn, mfl); only `ffc` is a live fetch. The consequence, measured
 * against production at season week 35:
 *
 *   2026 draft class present, by source
 *     defenders (data/nfl-draft-capital.json, n=123)   espn 1   consensus 1
 *       — the same file scores 2023 at 125/127, 2024 at 116/119, 2025 at 124/126
 *     skill-position rookies (SportsPlayer.yearsExp=0)
 *       consensus 29   ffc 24   sleeper 4   espn 1   fantrax 0   mfl 0
 *
 * So the CSV contributes essentially NO 2026 rookie, and every rookie that does reach
 * `adp_data` arrives from `ffc` alone. `lib/multi-platform-adp.ts` reads the CSV and
 * nothing else, so its lookups return null for those players — and a null is not
 * rendered as "unknown", it is rendered as nothing at all. In chat enrichment a veteran
 * gets `ConsensusADP: 4.2 (5 platforms)` appended to their line and a rookie gets
 * silence, which reads as a player with no draft cost.
 *
 * This module is the DB-first half: `adp_data` already holds those rookies, written by
 * the ingestion worker. It reads Postgres, never a provider.
 *
 * ⚠ IT REPORTS THE PROVIDER COUNT, AND THAT IS HALF THE POINT. A rookie priced here is
 * priced by one source. Surfacing the number is what stops a single-source figure from
 * being read as the agreement of five platforms — see the confidence note in
 * lib/workers/adp-importer.ts, where a lone provider was scored as perfect consensus.
 */

export interface LiveAdpEntry {
  /** The name as `adp_data` stores it, not the normalized key. */
  name: string
  adp: number
  position: string | null
  team: string | null
  /**
   * How many distinct sources produced this figure. 1 means uncorroborated.
   *
   * ⚠ NULL MEANS "THE ROW DID NOT SAY", WHICH IS NOT THE SAME AS 1. This used to coalesce a
   * missing `provider_count` with an empty `provider_breakdown` down to the literal 1, and a
   * caller then rendered "1 source" — a provenance claim the data never made. Callers must
   * render an unknown count as unknown.
   */
  providerCount: number | null
  /** The sources themselves, so a caller can name them rather than imply a census. */
  providers: string[]
  /** Null when providerCount < 2: there is no spread between a single value and itself. */
  adpSpread: number | null
  season: number
  week: number
  /**
   * The board this came from. Carried because the DEFAULTS below are deliberately NOT the
   * caller's league scoring — a surface that renders the number owes the reader the basis,
   * or it shows a standard-scoring ADP inside a PPR comparison with nothing saying so.
   */
  format: string
  scoring: string
}

export interface LiveAdpQuery {
  sport?: string
  format?: string
  scoring?: string
}

/**
 * `redraft`/`standard` is the blended board (2,935 consensus rows at week 35, drawing on
 * espn, fantrax, mfl, sleeper and ffc). `redraft`/`ppr` is pure ffc. The blended board is
 * the right default because it is a superset: it carries the CSV's veterans AND ffc's
 * rookies.
 */
const DEFAULTS = { sport: 'NFL', format: 'redraft', scoring: 'standard' } as const

/**
 * One query per period per process, not one per enriched player. Chat enrichment runs this
 * on a request path and the underlying rows only change when the importer rolls the week.
 */
const CACHE_TTL_MS = 15 * 60 * 1000

type CacheEntry = { loadedAt: number; byName: Map<string, LiveAdpEntry> }

const cache = new Map<string, CacheEntry>()

/**
 * 🛑 A TTL CACHE ALONE DOES NOT STOP A THUNDERING HERD, AND EVERY CALLER HERE FANS OUT.
 *
 * The cache is only written AFTER both queries resolve, so on a cold process N concurrent
 * callers all miss, all query, and all materialise the same ~2,935-row board into N separate
 * Maps before any of them writes. That is not hypothetical: the comparison lab resolves up to
 * 6 players through `Promise.all`, and `lib/agents/anthropic-pipeline.ts` fans out over an
 * unbounded name list. Six players meant twelve queries and six full boards.
 *
 * So the in-flight PROMISE is shared, not just the settled result. The second caller awaits
 * the first one's load instead of starting its own.
 */
const inFlight = new Map<string, Promise<Map<string, LiveAdpEntry>>>()

/** Test seam. */
export function __resetLiveAdpFallbackCache(): void {
  cache.clear()
  inFlight.clear()
}

function providersOf(breakdown: unknown): string[] {
  if (breakdown && typeof breakdown === 'object' && !Array.isArray(breakdown)) {
    const keys = Object.keys(breakdown as Record<string, unknown>)
    if (keys.length > 0) return keys.sort()
  }
  /*
   * A row written before provider_breakdown existed still carries provider_count, so the
   * caller can still say HOW MANY sources agreed even when it cannot name them.
   */
  return []
}

/**
 * Every consensus row for the most recent period, keyed by {@link normalizePlayerName} so
 * the keys line up with `lib/multi-platform-adp.ts`'s own index.
 *
 * Returns an empty map rather than throwing: this is a fallback, and a fallback that can
 * take down chat enrichment is worse than the gap it fills.
 */
export async function getLiveAdpByName(query: LiveAdpQuery = {}): Promise<Map<string, LiveAdpEntry>> {
  const sport = query.sport ?? DEFAULTS.sport
  const format = query.format ?? DEFAULTS.format
  const scoring = query.scoring ?? DEFAULTS.scoring
  const cacheKey = `${sport}:${format}:${scoring}`

  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.loadedAt < CACHE_TTL_MS) return hit.byName

  // Someone else is already loading this exact board — await theirs rather than adding a scan.
  const pending = inFlight.get(cacheKey)
  if (pending) return pending

  const load = loadBoard(sport, format, scoring)
    .then((byName) => {
      cache.set(cacheKey, { loadedAt: Date.now(), byName })
      return byName
    })
    .finally(() => {
      inFlight.delete(cacheKey)
    })

  inFlight.set(cacheKey, load)
  return load
}

/** The uncached read. Never throws — see {@link getLiveAdpByName}. */
async function loadBoard(
  sport: string,
  format: string,
  scoring: string,
): Promise<Map<string, LiveAdpEntry>> {
  const byName = new Map<string, LiveAdpEntry>()

  try {
    const latest = await prisma.adpDataRecord.findFirst({
      where: { sport, format, scoring, source: 'consensus' },
      orderBy: [{ season: 'desc' }, { week: 'desc' }],
      select: { season: true, week: true },
    })
    if (!latest) return byName

    const rows = await prisma.adpDataRecord.findMany({
      where: {
        sport,
        format,
        scoring,
        source: 'consensus',
        season: latest.season,
        week: latest.week,
      },
      select: {
        playerName: true,
        position: true,
        team: true,
        adp: true,
        providerCount: true,
        adpSpread: true,
        providerBreakdown: true,
      },
    })

    for (const row of rows) {
      if (!row.playerName || !Number.isFinite(row.adp)) continue
      const key = normalizePlayerName(row.playerName)
      if (!key) continue
      const providers = providersOf(row.providerBreakdown)
      /*
       * ⚠ DO NOT COALESCE AN UNKNOWN COUNT TO 1. A row that states neither `provider_count`
       * nor a `provider_breakdown` has told us nothing about corroboration, and defaulting it
       * to 1 let a caller print "1 source" as though the data had said so. Unknown stays null
       * and every consumer must handle it.
       */
      const providerCount = row.providerCount ?? (providers.length > 0 ? providers.length : null)
      const existing = byName.get(key)
      /*
       * A name can appear more than once across player ids. Prefer the better-corroborated
       * row, then the earlier ADP — never the last one seen, which is arbitrary. An unknown
       * count ranks below any known one, so a row that states its provenance wins.
       */
      const rank = (c: number | null) => (c == null ? -1 : c)
      if (
        existing &&
        (rank(existing.providerCount) > rank(providerCount) ||
          (rank(existing.providerCount) === rank(providerCount) && existing.adp <= row.adp))
      ) {
        continue
      }
      byName.set(key, {
        name: row.playerName,
        adp: row.adp,
        position: row.position ?? null,
        team: row.team ?? null,
        providerCount,
        providers,
        // Zero spread from a single source is absence of disagreement, not agreement.
        adpSpread: providerCount != null && providerCount >= 2 ? row.adpSpread ?? null : null,
        season: latest.season,
        week: latest.week,
        format,
        scoring,
      })
    }
  } catch {
    // Fall through with whatever was built; an empty map restores the previous behaviour.
  }

  // Caching is the wrapper's job — see getLiveAdpByName, which also shares the in-flight load.
  return byName
}

/**
 * Look one raw (un-normalized) name up in a map from {@link getLiveAdpByName}.
 *
 * Exported so callers never have to import the normalizer themselves — a consumer that
 * keys the map its own way silently misses every player whose name has punctuation.
 */
export function lookupLiveAdp(map: Map<string, LiveAdpEntry>, name: string): LiveAdpEntry | null {
  if (!name?.trim()) return null
  return map.get(normalizePlayerName(name)) ?? null
}

/** Single-player convenience over {@link getLiveAdpByName}. */
export async function findLiveAdp(name: string, query: LiveAdpQuery = {}): Promise<LiveAdpEntry | null> {
  if (!name?.trim()) return null
  const map = await getLiveAdpByName(query)
  return map.get(normalizePlayerName(name)) ?? null
}
