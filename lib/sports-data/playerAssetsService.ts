import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeRiInjuries } from '@/lib/injuries/rollingInsightsInjuries'

/**
 * playerAssetsService — headshot fallbacks + injury flags from the configured
 * sports APIs.
 *
 *  - TheSportsDB (THESPORTSDB_API_KEY, free key '3' as documented fallback):
 *    player cutout/thumb images by name search, for players Sleeper's CDN
 *    doesn't cover (rookies, some IDPs). Cached 7 days per name.
 *  - Rolling Insights DataFeeds (ROLLING_INSIGHTS_* env): documented
 *    GET /injuries/NFL endpoint with RSC_token query auth. Only used when the
 *    token is configured; the response is normalized defensively and reports
 *    {configured:false} / {available:false} honestly instead of guessing.
 *
 * Neither source is ever invented client-side: components render nothing when
 * an asset is absent.
 */

const TSDB_CACHE_PREFIX = 'assets:tsdb:v1:'
const TSDB_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7d
const RSC_CACHE_KEY = 'assets:rsc:injuries:v1'
const RSC_TTL_MS = 60 * 60 * 1000 // 1h

function tsdbKey(): string {
  return process.env.THESPORTSDB_API_KEY?.trim() || '3'
}

function rscToken(): string | null {
  return (
    process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim() ||
    process.env.ROLLING_INSIGHTS_API_KEY?.trim() ||
    null
  )
}

/**
 * The two env spellings carry DIFFERENT semantics and both are configured in the
 * wild: `ROLLING_INSIGHTS_REST_BASE` is the host root, `ROLLING_INSIGHTS_REST_BASE_URL`
 * already includes `/api/v1`. This reader previously consulted only `_REST_BASE`
 * and defaulted to a bare host, so with `_REST_BASE_URL` set (as it is in every
 * environment) it built `https://rest.datafeeds.rolling-insights.com/injuries/NFL`
 * — a 404 on every call. `getNflInjuries` swallows that into
 * `{configured:true, available:false}`, so the Command Center, player profile and
 * player-assets surfaces reported "no injury data" rather than an error, and the
 * `assets:rsc:injuries:v1` cache row was never written (measured: 0 rows, vs 98
 * for the TheSportsDB cache alongside it).
 *
 * Matches the resolution already used by lib/injuries/rollingInsightsInjuries.ts,
 * lib/stats/rollingInsightsPlayerStats.ts and lib/sports-live-scores-service.ts.
 */
function rscBase(): string {
  const raw =
    process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() ||
    process.env.ROLLING_INSIGHTS_REST_BASE?.trim() ||
    'https://rest.datafeeds.rolling-insights.com/api/v1'
  const trimmed = raw.replace(/\/+$/, '')
  return /\/api\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`
}

async function cachedJson<T extends { version: 1 }>(
  cacheKey: string,
  ttlMs: number,
  build: () => Promise<T | null>,
): Promise<T | null> {
  const now = new Date()
  const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey } }).catch(() => null)
  const payload =
    cached && cached.data && typeof cached.data === 'object' ? (cached.data as unknown as T) : null
  if (payload?.version === 1 && cached && cached.expiresAt > now) return payload
  const fresh = await build()
  if (fresh) {
    await prisma.sportsDataCache
      .upsert({
        where: { cacheKey },
        update: { data: fresh as unknown as object, expiresAt: new Date(now.getTime() + ttlMs) },
        create: { cacheKey, data: fresh as unknown as object, expiresAt: new Date(now.getTime() + ttlMs) },
      })
      .catch(() => null)
    return fresh
  }
  return payload?.version === 1 ? payload : null
}

// ── TheSportsDB headshots ────────────────────────────────────────────────────
export type TsdbHeadshot = { cutout: string | null; thumb: string | null }
type TsdbCacheRow = { version: 1; found: boolean; cutout: string | null; thumb: string | null }

type TsdbPlayer = {
  strPlayer?: string | null
  strSport?: string | null
  strCutout?: string | null
  strThumb?: string | null
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ')
}

export async function theSportsDbHeadshot(name: string): Promise<TsdbHeadshot | null> {
  const norm = normalizeName(name)
  if (!norm) return null
  const row = await cachedJson<TsdbCacheRow>(
    `${TSDB_CACHE_PREFIX}${norm}`,
    TSDB_TTL_MS,
    async () => {
      try {
        const res = await fetch(
          `https://www.thesportsdb.com/api/v1/json/${tsdbKey()}/searchplayers.php?p=${encodeURIComponent(name.trim())}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return null
        const data = (await res.json()) as { player?: TsdbPlayer[] | null }
        const match =
          (data.player ?? []).find(
            (p) => p.strSport === 'American Football' && (p.strCutout || p.strThumb),
          ) ?? null
        return {
          version: 1,
          found: Boolean(match),
          cutout: match?.strCutout ?? null,
          thumb: match?.strThumb ?? null,
        }
      } catch {
        return null
      }
    },
  )
  if (!row || !row.found) return null
  return { cutout: row.cutout, thumb: row.thumb }
}

export async function theSportsDbHeadshots(
  names: string[],
): Promise<Record<string, TsdbHeadshot | null>> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))].slice(0, 24)
  const out: Record<string, TsdbHeadshot | null> = {}
  // Small sequential batches — TheSportsDB free tier dislikes bursts.
  for (let i = 0; i < unique.length; i += 4) {
    const batch = unique.slice(i, i + 4)
    const results = await Promise.all(batch.map((n) => theSportsDbHeadshot(n)))
    batch.forEach((n, idx) => {
      out[n] = results[idx]
    })
  }
  return out
}

// ── Rolling Insights injuries ────────────────────────────────────────────────
export type InjuryFlag = { status: string; note: string | null }
export type InjuriesPayload =
  | { configured: false }
  | { configured: true; available: false }
  | { configured: true; available: true; byName: Record<string, InjuryFlag> }

type RscInjuriesCache = { version: 1; byName: Record<string, InjuryFlag> }

/**
 * Maps the live Rolling Insights injuries payload to name-keyed flags.
 *
 * The previous local normalizer searched each row for `status` / `injury_status` /
 * `designation`. Measured against the live feed, an RI injury row carries NONE of
 * those — its fields are `player`, `player_id`, `injury` (body part), `returns`
 * (the designation, as prose) and `date_injured`. So it matched nothing and
 * returned `{}` on a perfectly good 200, which `getNflInjuries` then reported as
 * `available:false`. Reusing the parser that already backs the `sportsInjury`
 * table (3,892 rows, minutes fresh) rather than keeping a second, weaker one.
 *
 * `parseInjuryDesignation` returns `status: null` when the prose states no
 * designation for THIS week ("Expected To Return Week 3"). That is a first-class
 * outcome, not a parse failure, and it must not become a badge — every consumer
 * of `InjuryFlag` renders `status` directly. Those rows are therefore withheld
 * here, which `injuryForName` already expresses as "no designation stated".
 * Surfaces that model a null designation read the richer `lib/injuries/injuryReadPort`
 * instead, which carries them with full fidelity plus staleness.
 */
function extractInjuries(data: unknown): Record<string, InjuryFlag> {
  const byName: Record<string, InjuryFlag> = {}
  for (const row of normalizeRiInjuries(data, 'NFL')) {
    if (!row.status || !row.playerName) continue
    byName[normalizeName(row.playerName)] = {
      status: row.status,
      // Body part ("Knee") is the useful hover detail; fall back to the full prose.
      note: row.type ?? row.description ?? null,
    }
  }
  return byName
}

export async function getNflInjuries(): Promise<InjuriesPayload> {
  const token = rscToken()
  if (!token) return { configured: false }
  const row = await cachedJson<RscInjuriesCache>(RSC_CACHE_KEY, RSC_TTL_MS, async () => {
    try {
      const res = await fetch(`${rscBase()}/injuries/NFL?RSC_token=${encodeURIComponent(token)}`, {
        cache: 'no-store',
      })
      if (!res.ok) return null
      const byName = extractInjuries(await res.json())
      if (Object.keys(byName).length === 0) return null
      return { version: 1, byName }
    } catch {
      return null
    }
  })
  if (!row) return { configured: true, available: false }
  return { configured: true, available: true, byName: row.byName }
}

export function injuryForName(payload: InjuriesPayload, name: string): InjuryFlag | null {
  if (!('available' in payload) || payload.available !== true) return null
  return payload.byName[normalizeName(name)] ?? null
}
