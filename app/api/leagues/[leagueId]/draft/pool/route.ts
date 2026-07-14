/**
 * GET: Normalized draft pool for league (sport-aware).
 * Returns NormalizedDraftEntry[] with PlayerDisplayModel, assets, and fallbacks.
 * Core implementation: `getResolvedDraftPoolForLeague`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import type { LeagueSport } from '@prisma/client'
import {
  API_CACHE_TTL,
  buildApiCacheKey,
  dedupeInFlight,
  getApiCached,
  setApiCached,
} from '@/lib/api-performance'
import {
  getResolvedDraftPoolForLeague,
  type DraftPoolRawRow,
  type PoolType,
} from '@/lib/draft-room/getResolvedDraftPoolForLeague'
import { dbFirstMode } from '@/lib/db-first-mode'
import { prisma } from '@/lib/prisma'
import { buildUnifiedPlayerProductView, type UnifiedPlayerAugment } from '@/lib/player-data/unifiedPlayerProductView'
import {
  buildPlayerFallbackDiagnostics,
  logPrefixForSurface,
  resolveIncludePlayerDataDiagnostics,
  type ProviderFallbackDiagnostics,
} from '@/lib/player-data/providerFallbackDiagnostics'
import { soccerLeagueHintFromLeagueSettings } from '@/lib/player-data/leagueSoccerLeagueHint'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import { dedupeCanonicalNflDraftPoolEntries, enrichCanonicalNflDraftPoolEntries } from '@/lib/nfl-data-foundation'
import { buildDraftPoolCacheKey, resolveDraftPoolCacheContext } from '@/lib/draft-room/ensureDraftPoolReady'

export const dynamic = 'force-dynamic'

/** @deprecated Import from `@/lib/draft-room/getResolvedDraftPoolForLeague` */
export type { DraftPoolRawRow, PoolType }

const DEFAULT_LIMIT = 300
const DRAFT_POOL_CACHE_CONTROL = (() => {
  const ttl = Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds)
  const swr = Math.max(ttl, ttl * 2)
  return `private, max-age=${ttl}, stale-while-revalidate=${swr}`
})()

async function loadNflFoundationTiming(leagueId: string): Promise<{ season: number; week: number }> {
  const row = await prisma.redraftSeason
    .findFirst({
      where: { leagueId, sport: 'NFL' },
      orderBy: { createdAt: 'desc' },
      select: { season: true, currentWeek: true },
    })
    .catch(() => null)
  return {
    season: Number(row?.season ?? new Date().getUTCFullYear()),
    week: Math.max(1, Number(row?.currentWeek ?? 1)),
  }
}

type DraftPoolMetaSource = 'db-cache' | 'rebuilt'

type DraftPoolResponseMeta = {
  source: DraftPoolMetaSource
  entryCount: number
  elapsedMs: number
  cacheKey: string
  cachedAt: string | null
}

type DraftPoolResponseBody = {
  entries?: unknown[]
  count?: number
  meta?: Partial<DraftPoolResponseMeta>
  /** First 10 pool rows only — `?debugPlayerData=1` or dev */
  normalizedPlayerDataDiagnostics?: ProviderFallbackDiagnostics[]
  [key: string]: unknown
}

async function injectDraftPoolDiagnosticsIfRequested(
  payload: DraftPoolResponseBody,
  leagueId: string,
  req: NextRequest,
): Promise<void> {
  if (!resolveIncludePlayerDataDiagnostics(req.nextUrl.searchParams)) return
  const entries = payload.entries
  if (!Array.isArray(entries) || entries.length === 0) return
  const leagueRow = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const soccerHint = soccerLeagueHintFromLeagueSettings(leagueRow?.settings ?? null) ?? undefined
  const augment: UnifiedPlayerAugment | undefined = soccerHint ? { soccerLeague: soccerHint } : undefined
  const sample = entries.slice(0, 10) as NormalizedDraftEntry[]
  payload.normalizedPlayerDataDiagnostics = sample.map((e) =>
    buildPlayerFallbackDiagnostics(
      buildUnifiedPlayerProductView(e, augment ? { augment } : undefined),
      'draft',
    ),
  )
  if (process.env.NODE_ENV === 'development') {
    for (const d of payload.normalizedPlayerDataDiagnostics.slice(0, 5)) {
      console.info(logPrefixForSurface('draft-room', d))
    }
  }
}

/**
 * Remove redundant and diagnostic-only fields from every pool entry to reduce
 * response payload size. Stripped fields are never read by SleeperPoolTable:
 *
 *   display.assets: headshotFallbackUrl + teamLogoFallbackUrl — same encoded
 *     SVG for every player (~640 bytes × 300 rows = ~190 KB). Already
 *     stripped from DB cache rows so both paths benefit.
 *
 *   display.stats: rollingInsightsSupplemental — diagnostic supplement object,
 *     not in DraftStatPlayerSource; never used by stat column rendering.
 *     projectionSource — diagnostic tag duplicated at top-level NormalizedDraftEntry.
 *
 *   display.metadata: rookieYearsExpSource — provenance enum for debugging only;
 *     never displayed, never filtered on.
 */
function stripPoolEntryFallbacks(payload: DraftPoolResponseBody): DraftPoolResponseBody {
  if (!Array.isArray(payload.entries) || payload.entries.length === 0) return payload
  return {
    ...payload,
    entries: payload.entries.map((entry: unknown) => {
      const e = entry as Record<string, unknown>
      if (!e.display || typeof e.display !== 'object') return e
      const display = e.display as Record<string, unknown>

      // Strip fallback SVGs from display.assets
      let strippedDisplay = display
      if (display.assets && typeof display.assets === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { headshotFallbackUrl: _hf, teamLogoFallbackUrl: _tf, headshotFallbackUsed: _hu, teamLogoFallbackUsed: _tu, ...assets } = display.assets as Record<string, unknown>
        strippedDisplay = { ...strippedDisplay, assets }
      }

      // Strip diagnostic-only stats fields
      if (strippedDisplay.stats && typeof strippedDisplay.stats === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { rollingInsightsSupplemental: _ris, projectionSource: _ps, ...stats } = strippedDisplay.stats as Record<string, unknown>
        strippedDisplay = { ...strippedDisplay, stats }
      }

      // Strip diagnostic-only metadata fields
      if (strippedDisplay.metadata && typeof strippedDisplay.metadata === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { rookieYearsExpSource: _rys, ...metadata } = strippedDisplay.metadata as Record<string, unknown>
        strippedDisplay = { ...strippedDisplay, metadata }
      }

      const assets =
        strippedDisplay.assets && typeof strippedDisplay.assets === 'object'
          ? (strippedDisplay.assets as Record<string, unknown>)
          : null
      const headshotUrl =
        typeof e.headshotUrl === 'string' && e.headshotUrl.trim()
          ? e.headshotUrl
          : typeof assets?.headshotUrl === 'string' && assets.headshotUrl.trim()
            ? assets.headshotUrl
            : null
      const teamLogoUrl =
        typeof e.teamLogoUrl === 'string' && e.teamLogoUrl.trim()
          ? e.teamLogoUrl
          : typeof assets?.teamLogoUrl === 'string' && assets.teamLogoUrl.trim()
            ? assets.teamLogoUrl
            : null

      return {
        ...e,
        display: strippedDisplay,
        headshotUrl,
        imageUrl:
          typeof e.imageUrl === 'string' && e.imageUrl.trim()
            ? e.imageUrl
            : headshotUrl,
        teamLogoUrl,
      }
    }),
  }
}

function withDraftPoolMeta(
  payload: DraftPoolResponseBody,
  meta: Omit<DraftPoolResponseMeta, 'entryCount'> & { entryCount?: number },
): DraftPoolResponseBody {
  const currentMeta =
    payload.meta && typeof payload.meta === 'object' ? (payload.meta as Partial<DraftPoolResponseMeta>) : {}
  const inferredEntryCount =
    typeof meta.entryCount === 'number'
      ? meta.entryCount
      : Array.isArray(payload.entries)
        ? payload.entries.length
        : Number(payload.count ?? 0)

  return {
    ...payload,
    meta: {
      ...currentMeta,
      source: meta.source,
      entryCount: Number(inferredEntryCount),
      elapsedMs: Number(meta.elapsedMs),
      cacheKey: meta.cacheKey,
      cachedAt: meta.cachedAt,
    },
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const routeStartedAt = Date.now()
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let effectiveLeagueTemplate: Awaited<ReturnType<typeof getEffectiveLeagueRosterTemplate>>
  try {
    effectiveLeagueTemplate = await getEffectiveLeagueRosterTemplate(leagueId)
  } catch {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const cacheContext = await resolveDraftPoolCacheContext(leagueId, { effectiveLeagueTemplate })
  const rosterFp = cacheContext.rosterFp
  const cacheKey = buildDraftPoolCacheKey(leagueId, rosterFp, buildApiCacheKey('GET', req.url))
  // dbFirstMode persistent DB cache layer. Guarded because the DraftPoolCache
  // Prisma client may not be generated yet (the model is in schema.prisma but
  // requires `prisma generate` to surface on the client). Falls back to the
  // in-memory cache + cold compute below.
  const draftPoolCacheModel = (prisma as { draftPoolCache?: { findFirst: Function; upsert: Function } }).draftPoolCache
  if (draftPoolCacheModel?.findFirst) {
    try {
      let dbCached = await draftPoolCacheModel.findFirst({
        where: {
          cacheKey,
          expiresAt: { gt: new Date() },
        },
        select: { payload: true, entryCount: true, syncedAt: true },
      })
      let cacheLayer: 'db' | 'db-league-fallback' = 'db'
      if (!dbCached?.payload) {
        dbCached = await draftPoolCacheModel.findFirst({
          where: {
            leagueId,
            sourceFingerprint: rosterFp,
            expiresAt: { gt: new Date() },
          },
          orderBy: { syncedAt: 'desc' },
          select: { payload: true, entryCount: true, syncedAt: true },
        })
        if (dbCached?.payload) {
          cacheLayer = 'db-league-fallback'
        }
      }
      if (dbCached?.payload && typeof dbCached.payload === 'object') {
        const payload = stripPoolEntryFallbacks(withDraftPoolMeta(dbCached.payload as DraftPoolResponseBody, {
          source: 'db-cache',
          entryCount: Number(dbCached.entryCount ?? 0),
          elapsedMs: Date.now() - routeStartedAt,
          cacheKey,
          cachedAt: dbCached.syncedAt instanceof Date ? dbCached.syncedAt.toISOString() : null,
        }))
        console.info('[draft/pool GET] cache hit', {
          layer: cacheLayer,
          leagueId,
          cacheKey,
          entryCount: Number(dbCached.entryCount ?? 0),
          elapsedMs: Date.now() - routeStartedAt,
        })
        setApiCached(cacheKey, payload, {
          ttlMs: Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds) * 1000,
          status: 200,
          headers: { 'Cache-Control': DRAFT_POOL_CACHE_CONTROL },
        })
        const outward = { ...payload } as DraftPoolResponseBody
        await injectDraftPoolDiagnosticsIfRequested(outward, leagueId, req)
        const response = NextResponse.json(outward, { status: 200 })
        response.headers.set('Cache-Control', DRAFT_POOL_CACHE_CONTROL)
        return response
      }
    } catch (err) {
      console.warn('[draft/pool GET] DB cache read failed (non-fatal):', (err as Error).message)
    }
  }

  const cached = getApiCached(cacheKey)
  if (cached) {
    const cachedBody =
      cached.body && typeof cached.body === 'object' ? (cached.body as DraftPoolResponseBody) : ({ entries: [] } as DraftPoolResponseBody)
    const existingMeta =
      cachedBody.meta && typeof cachedBody.meta === 'object' ? (cachedBody.meta as Partial<DraftPoolResponseMeta>) : null
    const payload = stripPoolEntryFallbacks(withDraftPoolMeta(cachedBody, {
      source: existingMeta?.source === 'db-cache' ? 'db-cache' : 'rebuilt',
      entryCount: existingMeta?.entryCount,
      elapsedMs: Date.now() - routeStartedAt,
      cacheKey,
      cachedAt: typeof existingMeta?.cachedAt === 'string' ? existingMeta.cachedAt : null,
    }))
    console.info('[draft/pool GET] cache hit', {
      layer: 'memory',
      leagueId,
      cacheKey,
      elapsedMs: Date.now() - routeStartedAt,
    })
    const payloadBody =
      payload && typeof payload === 'object'
        ? (payload as DraftPoolResponseBody)
        : ({ entries: [] } as DraftPoolResponseBody)
    const outward = { ...payloadBody } as DraftPoolResponseBody
    await injectDraftPoolDiagnosticsIfRequested(outward, leagueId, req)
    const response = NextResponse.json(outward, { status: cached.status })
    for (const [header, value] of Object.entries(cached.headers)) {
      response.headers.set(header, value)
    }
    if (!cached.headers['Cache-Control']) {
      response.headers.set('Cache-Control', DRAFT_POOL_CACHE_CONTROL)
    }
    return response
  }

  try {
    console.info('[draft/pool GET] cache miss', {
      leagueId,
      cacheKey,
      elapsedMs: Date.now() - routeStartedAt,
    })
    const payload = await dedupeInFlight(cacheKey, async () => {
      const hotCached = getApiCached(cacheKey)
      if (hotCached) return hotCached.body

      const limit = Math.min(
        parseInt(req.nextUrl.searchParams?.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
        500,
      )
      const poolType = req.nextUrl.searchParams?.get('poolType') as PoolType | null

      const rebuildStartedAt = Date.now()
      const resolved = await getResolvedDraftPoolForLeague(leagueId, {
        limit,
        poolType,
        effectiveLeagueTemplate,
      })
      console.info('[draft/pool GET] rebuild complete', {
        leagueId,
        cacheKey,
        rebuildDurationMs: Date.now() - rebuildStartedAt,
        resolvedCount: Number(resolved.count ?? 0),
        rosterConfigurationIncomplete: resolved.rosterConfigurationIncomplete,
      })

      if (resolved.rosterConfigurationIncomplete) {
        const responsePayload = withDraftPoolMeta({
          entries: [],
          sport: resolved.sport,
          count: 0,
          rosterConfigurationIncomplete: true as const,
          isIdp: resolved.isIdp,
        }, {
          source: 'rebuilt',
          entryCount: 0,
          elapsedMs: Date.now() - routeStartedAt,
          cacheKey,
          cachedAt: new Date().toISOString(),
        })
        setApiCached(cacheKey, responsePayload, {
          ttlMs: API_CACHE_TTL.MEDIUM, // Phase 3b — 5 min server-side cache
          status: 200,
          headers: { 'Cache-Control': DRAFT_POOL_CACHE_CONTROL },
        })
        return responsePayload
      }

      const nflFoundationTiming = resolved.sport === 'NFL' ? await loadNflFoundationTiming(leagueId) : null
      const entries =
        resolved.sport === 'NFL'
          ? dedupeCanonicalNflDraftPoolEntries(
              await enrichCanonicalNflDraftPoolEntries(leagueId, resolved.entries, nflFoundationTiming ?? undefined),
            )
          : resolved.entries

      const responsePayload = stripPoolEntryFallbacks(withDraftPoolMeta({
        entries,
        sport: resolved.sport,
        count: entries.length,
        rosterConfigurationIncomplete: false as const,
        poolType: resolved.poolType,
        devyConfig: resolved.devyConfig,
        c2cConfig: resolved.c2cConfig,
        isIdp: resolved.isIdp,
      }, {
        source: 'rebuilt',
        entryCount: Number(resolved.count ?? resolved.entries.length),
        elapsedMs: Date.now() - routeStartedAt,
        cacheKey,
        cachedAt: new Date().toISOString(),
      }))
      setApiCached(cacheKey, responsePayload, {
        ttlMs: API_CACHE_TTL.MEDIUM, // Phase 3b — 5 min server-side cache (was SHORT/30s)
        status: 200,
        headers: { 'Cache-Control': DRAFT_POOL_CACHE_CONTROL },
      })
      return responsePayload
    })

    const payloadBody =
      payload && typeof payload === 'object'
        ? (payload as DraftPoolResponseBody)
        : ({ entries: [] } as DraftPoolResponseBody)
    const outward = { ...payloadBody } as DraftPoolResponseBody
    await injectDraftPoolDiagnosticsIfRequested(outward, leagueId, req)
    const res = NextResponse.json(outward)
    res.headers.set('Cache-Control', DRAFT_POOL_CACHE_CONTROL)

    const payloadObj = payload as {
      sport?: LeagueSport
      poolType?: PoolType
      count?: number
    }
    const expiresAt = new Date(Date.now() + Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds) * 1000)
    // Guarded — see read side. Only persist if the model was generated.
    if (draftPoolCacheModel?.upsert) {
      void draftPoolCacheModel
        .upsert({
          where: { cacheKey },
          create: {
            leagueId,
            cacheKey,
            sport: payloadObj.sport,
            poolType: payloadObj.poolType,
            sourceFingerprint: rosterFp,
            entryCount: Number(payloadObj.count ?? 0),
            payload: payload as unknown as object,
            expiresAt,
          },
          update: {
            sport: payloadObj.sport,
            poolType: payloadObj.poolType,
            sourceFingerprint: rosterFp,
            entryCount: Number(payloadObj.count ?? 0),
            payload: payload as unknown as object,
            syncedAt: new Date(),
            expiresAt,
          },
        })
        .then((row: { entryCount?: number; cacheKey?: string }) => {
          console.info('[draft/pool GET] persisted DraftPoolCache row', {
            leagueId,
            cacheKey: row?.cacheKey ?? cacheKey,
            persistedRowCount: Number(row?.entryCount ?? payloadObj.count ?? 0),
            elapsedMs: Date.now() - routeStartedAt,
          })
        })
        .catch((error: unknown) => {
          console.error('[draft/pool GET] failed to persist DraftPoolCache', error)
        })
    }

    return res
  } catch (e) {
    console.error('[draft/pool GET]', e)
    return NextResponse.json(
      { error: (e as Error).message ?? 'Failed to load draft pool' },
      { status: 500 }
    )
  }
}
