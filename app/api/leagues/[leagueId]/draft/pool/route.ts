/**
 * GET: Normalized draft pool for league (sport-aware).
 * Returns NormalizedDraftEntry[] with PlayerDisplayModel, assets, and fallbacks.
 * Core implementation: `getResolvedDraftPoolForLeague`.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft } from '@/lib/live-draft-engine/auth'
import {
  getEffectiveLeagueRosterTemplate,
  starterEligiblePlayerPositionsFromTemplate,
} from '@/lib/league/getEffectiveLeagueRosterTemplate'
import type { LeagueSport } from '@prisma/client'
import { apiChain } from '@/lib/workers/api-chain'
import { legacySupportedSportToApiChain } from '@/lib/workers/api-config'
import {
  API_CACHE_TTL,
  buildApiCacheKey,
  dedupeInFlight,
  getApiCached,
  setApiCached,
} from '@/lib/api-performance'
import { rosterFingerprintFromEligible } from '@/lib/draft-room/draft-pool-eligible-positions'
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

export const dynamic = 'force-dynamic'

/** @deprecated Import from `@/lib/draft-room/getResolvedDraftPoolForLeague` */
export type { DraftPoolRawRow, PoolType }

const DEFAULT_LIMIT = 300
const DRAFT_POOL_CACHE_CONTROL = (() => {
  const ttl = Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds)
  const swr = Math.max(ttl, ttl * 2)
  return `private, max-age=${ttl}, stale-while-revalidate=${swr}`
})()

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

  const starterEligible = starterEligiblePlayerPositionsFromTemplate(effectiveLeagueTemplate.template)
  const rosterFp = `${effectiveLeagueTemplate.hasPersistedRosterSchema ? 'cfg' : 'nocfg'}:starters:${rosterFingerprintFromEligible(
    starterEligible.size > 0 ? starterEligible : new Set(effectiveLeagueTemplate.allowedPositions),
  )}`
  const cacheKey = `draft_pool:${leagueId}:${rosterFp}:dbmerge_v4:nflproj_v1:${buildApiCacheKey('GET', req.url)}`
  // dbFirstMode persistent DB cache layer. Guarded because the DraftPoolCache
  // Prisma client may not be generated yet (the model is in schema.prisma but
  // requires `prisma generate` to surface on the client). Falls back to the
  // in-memory cache + cold compute below.
  const draftPoolCacheModel = (prisma as { draftPoolCache?: { findFirst: Function; upsert: Function } }).draftPoolCache
  if (draftPoolCacheModel?.findFirst) {
    try {
      const dbCached = await draftPoolCacheModel.findFirst({
        where: {
          cacheKey,
          expiresAt: { gt: new Date() },
        },
        select: { payload: true, entryCount: true, syncedAt: true },
      })
      if (dbCached?.payload && typeof dbCached.payload === 'object') {
        const payload = withDraftPoolMeta(dbCached.payload as DraftPoolResponseBody, {
          source: 'db-cache',
          entryCount: Number(dbCached.entryCount ?? 0),
          elapsedMs: Date.now() - routeStartedAt,
          cacheKey,
          cachedAt: dbCached.syncedAt instanceof Date ? dbCached.syncedAt.toISOString() : null,
        })
        console.info('[draft/pool GET] cache hit', {
          layer: 'db',
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
    const payload = withDraftPoolMeta(cachedBody, {
      source: existingMeta?.source === 'db-cache' ? 'db-cache' : 'rebuilt',
      entryCount: existingMeta?.entryCount,
      elapsedMs: Date.now() - routeStartedAt,
      cacheKey,
      cachedAt: typeof existingMeta?.cachedAt === 'string' ? existingMeta.cachedAt : null,
    })
    console.info('[draft/pool GET] cache hit', {
      layer: 'memory',
      leagueId,
      cacheKey,
      elapsedMs: Date.now() - routeStartedAt,
    })
    const outward = { ...payload } as DraftPoolResponseBody
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

      const responsePayload = withDraftPoolMeta({
        entries: resolved.entries,
        sport: resolved.sport,
        count: resolved.count,
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
      })
      setApiCached(cacheKey, responsePayload, {
        ttlMs: API_CACHE_TTL.MEDIUM, // Phase 3b — 5 min server-side cache (was SHORT/30s)
        status: 200,
        headers: { 'Cache-Control': DRAFT_POOL_CACHE_CONTROL },
      })
      return responsePayload
    })

    if (
      payload &&
      typeof payload === 'object' &&
      'sport' in payload &&
      !dbFirstMode.useDbCacheOnly &&
      !dbFirstMode.disableLiveApiOnPageLoad
    ) {
      const s = (payload as { sport: LeagueSport }).sport
      const chainSport = legacySupportedSportToApiChain(s)
      void Promise.allSettled([
        apiChain.fetch({ sport: chainSport, dataType: 'injuries' }),
        apiChain.fetch({ sport: chainSport, dataType: 'schedule' }),
      ]).catch(() => {})
    }

    const outward = { ...payload } as DraftPoolResponseBody
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
