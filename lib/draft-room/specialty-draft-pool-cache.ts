import { createHash } from 'crypto'

import { dbFirstMode } from '@/lib/db-first-mode'
import { prisma } from '@/lib/prisma'

export type SpecialtyDraftKind = 'dispersal' | 'supplemental' | 'rookie' | 'specialty'

type SpecialtyDraftPoolRequest = {
  kind: SpecialtyDraftKind
  leagueId: string
  draftId?: string | null
  season?: string | null
  sport?: string | null
  draftType?: string | null
  scoring?: string | null
  poolType?: string | null
  teamCount?: number | null
  limit?: number | null
  scopeParts?: Array<string | number | null | undefined>
  forceRefresh?: boolean
}

type SpecialtyDraftPoolMeta = {
  source: 'db-cache' | 'rebuilt'
  cacheKey: string
  cachedAt: string | null
  ttlSeconds: number
}

type SpecialtyPoolPayload = {
  assets?: unknown[]
  entries?: unknown[]
  totalAssets?: number
  count?: number
  [key: string]: unknown
}

function normalizeText(value: string | number | null | undefined): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function normalizeTeamCount(value: number | null | undefined): number {
  if (!Number.isFinite(Number(value))) return 0
  return Math.max(0, Number(value))
}

function normalizeLimit(value: number | null | undefined): number {
  if (!Number.isFinite(Number(value))) return 0
  return Math.max(0, Number(value))
}

function scoringHash(value: string | null | undefined): string {
  const normalized = normalizeText(value || 'default') || 'default'
  return createHash('sha1').update(normalized).digest('hex').slice(0, 10)
}

function seasonBucket(value: string | null | undefined): string {
  const normalized = normalizeText(value)
  return normalized || new Date().getUTCFullYear().toString()
}

function scopeHash(parts: Array<string | number | null | undefined>): string {
  const joined = parts.map((part) => normalizeText(part)).join('|')
  return createHash('sha1').update(joined).digest('hex').slice(0, 12)
}

function entryCountFromPayload(payload: SpecialtyPoolPayload): number {
  if (typeof payload.totalAssets === 'number') return Number(payload.totalAssets)
  if (typeof payload.count === 'number') return Number(payload.count)
  if (Array.isArray(payload.assets)) return payload.assets.length
  if (Array.isArray(payload.entries)) return payload.entries.length
  return 0
}

function buildSourceFingerprint(params: SpecialtyDraftPoolRequest): string {
  return [
    `kind:${params.kind}`,
    `draft:${normalizeText(params.draftId) || 'preview'}`,
    `sport:${normalizeText(params.sport) || 'unknown'}`,
    `season:${seasonBucket(params.season)}`,
    `draftType:${normalizeText(params.draftType) || 'unknown'}`,
    `score:${scoringHash(params.scoring)}`,
    `poolType:${normalizeText(params.poolType) || 'default'}`,
    `teams:${normalizeTeamCount(params.teamCount)}`,
    `limit:${normalizeLimit(params.limit)}`,
    `scope:${scopeHash(params.scopeParts ?? [])}`,
  ].join('|')
}

function buildSpecialtyDraftPoolCacheKey(params: SpecialtyDraftPoolRequest): string {
  const baseKind = params.kind === 'rookie' ? 'rookie' : params.kind === 'supplemental' ? 'supplemental' : params.kind === 'dispersal' ? 'dispersal' : 'specialty'
  const draftSegment = normalizeText(params.draftId) || 'preview'
  const sportSegment = normalizeText(params.sport) || 'unknown'
  const draftTypeSegment = normalizeText(params.draftType) || 'unknown'
  const poolTypeSegment = normalizeText(params.poolType) || 'default'
  const scopeSegment = scopeHash(params.scopeParts ?? [])
  return `${baseKind}:${normalizeText(params.leagueId)}:${draftSegment}:${seasonBucket(params.season)}:${sportSegment}:${draftTypeSegment}:score:${scoringHash(params.scoring)}:pool:${poolTypeSegment}:teams:${normalizeTeamCount(params.teamCount)}:limit:${normalizeLimit(params.limit)}:scope:${scopeSegment}`
}

function logSpecialtyPool(kind: SpecialtyDraftKind, message: string, details: Record<string, unknown>): void {
  console.info(`[${kind}-pool] ${message}`, details)
}

export async function getCachedSpecialtyDraftPool<TPayload extends SpecialtyPoolPayload>(
  params: SpecialtyDraftPoolRequest,
  buildPayload: () => Promise<TPayload>,
): Promise<{ payload: TPayload; meta: SpecialtyDraftPoolMeta }> {
  const cacheKey = buildSpecialtyDraftPoolCacheKey(params)
  const ttlSeconds = Math.max(1, dbFirstMode.draftPoolCacheTtlSeconds)
  const draftPoolCacheModel = (prisma as { draftPoolCache?: { findFirst: Function; upsert: Function } }).draftPoolCache

  if (!params.forceRefresh && draftPoolCacheModel?.findFirst) {
    const cached = await draftPoolCacheModel.findFirst({
      where: { cacheKey, expiresAt: { gt: new Date() } },
      select: { payload: true, syncedAt: true },
    })
    if (cached?.payload && typeof cached.payload === 'object') {
      logSpecialtyPool(params.kind, 'cache hit', { cacheKey })
      return {
        payload: cached.payload as TPayload,
        meta: {
          source: 'db-cache',
          cacheKey,
          cachedAt: cached.syncedAt instanceof Date ? cached.syncedAt.toISOString() : null,
          ttlSeconds,
        },
      }
    }
  }

  logSpecialtyPool(params.kind, 'cache miss', { cacheKey })
  const rebuildStartedAt = Date.now()
  const payload = await buildPayload()
  logSpecialtyPool(params.kind, 'rebuild duration', {
    cacheKey,
    durationMs: Date.now() - rebuildStartedAt,
  })

  if (draftPoolCacheModel?.upsert) {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
    await draftPoolCacheModel.upsert({
      where: { cacheKey },
      create: {
        leagueId: params.leagueId,
        cacheKey,
        sport: params.sport ?? null,
        poolType: params.poolType ?? params.kind,
        sourceFingerprint: buildSourceFingerprint(params),
        entryCount: entryCountFromPayload(payload),
        payload: payload as unknown as object,
        expiresAt,
      },
      update: {
        sport: params.sport ?? null,
        poolType: params.poolType ?? params.kind,
        sourceFingerprint: buildSourceFingerprint(params),
        entryCount: entryCountFromPayload(payload),
        payload: payload as unknown as object,
        syncedAt: new Date(),
        expiresAt,
      },
    })
    logSpecialtyPool(params.kind, 'persisted row count', {
      cacheKey,
      entryCount: entryCountFromPayload(payload),
    })
  }

  return {
    payload,
    meta: {
      source: 'rebuilt',
      cacheKey,
      cachedAt: new Date().toISOString(),
      ttlSeconds,
    },
  }
}