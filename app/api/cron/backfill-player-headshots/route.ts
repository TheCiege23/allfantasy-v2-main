/**
 * Scheduled NFL player headshot backfill.
 *
 * Walks the `SportsPlayer` cache for the requested sport, finds rows whose
 * `imageUrl` is missing or invalid (data-URI placeholder, team-logo, or
 * non-HTTP), and resolves a real headshot via the canonical provider chain:
 *
 *   NFL: TheSportsDB → ClearSports → Sleeper CDN
 *   Other sports: ClearSports → TheSportsDB
 *
 * Provider order is owned by `lib/player-assets/resolvePlayerHeadshot.ts` and
 * is asserted by the cron's contract test. We use the batch resolver so the
 * full ClearSports player list is pre-fetched once per run.
 *
 * Schedule: daily at 5:15 AM UTC (low traffic). See `vercel.json`.
 *
 * Auth: requires the shared cron secret helper. Returns 401 otherwise.
 *
 * Modes:
 *   - default `apply=0` → dry-run; counts what would change without writing
 *   - `apply=1` → actually upserts `SportsPlayer.imageUrl`
 *   - `force=1` → also overwrite existing `imageUrl`s that classify as a
 *                 real headshot (rare; useful when a provider URL goes 404)
 *
 * Pagination: `limit` (default 100, capped at 500). Rows are processed in
 * `updatedAt ASC` order with `imageUrl IS NULL` first, so the universe
 * naturally rotates over successive cron runs without explicit cursors.
 *
 * Phase 1 scope (this branch):
 *   - Reads + writes `SportsPlayer.imageUrl`, and touches `updatedAt` when
 *     a scanned row has no replacement so unresolved rows do not block paging.
 *   - Source / confidence / lastCheckedAt metadata is returned in the JSON
 *     summary for cron-run observability but NOT persisted to the row yet.
 *   - Phase 2 follow-up branch will add `imageSource` / `imageLastCheckedAt`
 *     / `imageConfidence` columns via a Prisma migration and update this
 *     route to persist them.
 */

import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import {
  createBatchPlayerHeadshotResolver,
  isValidHeadshotUrl,
  type HeadshotConfidence,
  type HeadshotProvider,
} from '@/lib/player-assets/resolvePlayerHeadshot'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// Vercel max function duration (Pro tier). Cron-only — never user-facing.
export const maxDuration = 300

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500
const invalidImageUrlFilters: Prisma.SportsPlayerWhereInput[] = [
  { imageUrl: { startsWith: 'data:' } },
  { imageUrl: { contains: '/teamLogos/', mode: 'insensitive' } },
  { imageUrl: { contains: '/teamLogo/', mode: 'insensitive' } },
  { imageUrl: { not: { startsWith: 'http', mode: 'insensitive' } } },
]

interface CronSummary {
  sport: string
  apply: boolean
  force: boolean
  scanned: number
  updated: number
  wouldUpdate: number
  skippedAlreadyValid: number
  noMatch: number
  bySource: Record<HeadshotProvider, number>
  byConfidence: Record<HeadshotConfidence, number>
  providerErrors: number
  durationMs: number
  clearSportsCacheSize: number
  sampleUpdated: Array<{
    name: string
    position: string | null
    team: string | null
    source: HeadshotProvider
    confidence: HeadshotConfidence
  }>
  sampleNoMatch: Array<{ name: string; position: string | null; team: string | null }>
}

function parseQuery(req: NextRequest): {
  sport: string
  limit: number
  apply: boolean
  force: boolean
} {
  const url = req.nextUrl
  const sport = (url.searchParams.get('sport') ?? 'NFL').toUpperCase()
  const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(MAX_LIMIT, rawLimit) : DEFAULT_LIMIT
  const apply = url.searchParams.get('apply') === '1'
  const force = url.searchParams.get('force') === '1'
  return { sport, limit, apply, force }
}

async function touchScannedRow(id: string): Promise<boolean> {
  try {
    await prisma.sportsPlayer.update({
      where: { id },
      data: { updatedAt: new Date() },
    })
    return true
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const { sport, limit, apply, force } = parseQuery(req)

  // Pull oldest-touched rows first; rows with no image at all jump to the
  // front. Default mode scans missing and known-invalid images; force mode
  // additionally scans rows with valid existing headshots.
  const rows = await prisma.sportsPlayer.findMany({
    where: {
      sport,
      OR: force
        ? [{ imageUrl: null }, { imageUrl: { not: null } }]
        : [{ imageUrl: null }, ...invalidImageUrlFilters],
    },
    select: {
      id: true,
      name: true,
      position: true,
      team: true,
      sleeperId: true,
      imageUrl: true,
    },
    orderBy: [{ imageUrl: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'asc' }],
    take: limit,
  })

  const resolver = await createBatchPlayerHeadshotResolver({ sport })
  const cacheSize = resolver.stats().clearSportsCacheSize

  const summary: CronSummary = {
    sport,
    apply,
    force,
    scanned: rows.length,
    updated: 0,
    wouldUpdate: 0,
    skippedAlreadyValid: 0,
    noMatch: 0,
    bySource: { sleeper: 0, clearsports: 0, sportsdb: 0, none: 0 },
    byConfidence: { exact: 0, name_team_position: 0, name_only: 0, none: 0 },
    providerErrors: 0,
    durationMs: 0,
    clearSportsCacheSize: cacheSize,
    sampleUpdated: [],
    sampleNoMatch: [],
  }

  for (const row of rows) {
    // Defensive: skip rows that already have a valid image when not forcing.
    if (!force && isValidHeadshotUrl(row.imageUrl)) {
      summary.skippedAlreadyValid += 1
      continue
    }

    let result
    try {
      result = await resolver.resolve({
        name: row.name,
        sport,
        team: row.team ?? null,
        position: row.position ?? null,
        externalIds: row.sleeperId ? { sleeperId: row.sleeperId } : undefined,
      })
    } catch {
      summary.providerErrors += 1
      continue
    }

    summary.bySource[result.source] += 1
    summary.byConfidence[result.confidence] += 1

    const newUrl = result.imageUrl
    if (!newUrl || !isValidHeadshotUrl(newUrl)) {
      summary.noMatch += 1
      if (summary.sampleNoMatch.length < 25) {
        summary.sampleNoMatch.push({ name: row.name, position: row.position, team: row.team })
      }
      if (apply && !(await touchScannedRow(row.id))) {
        summary.providerErrors += 1
      }
      continue
    }

    if (!force && row.imageUrl && row.imageUrl === newUrl) {
      summary.skippedAlreadyValid += 1
      if (apply && !(await touchScannedRow(row.id))) {
        summary.providerErrors += 1
      }
      continue
    }

    if (apply) {
      try {
        await prisma.sportsPlayer.update({
          where: { id: row.id },
          data: { imageUrl: newUrl },
        })
        summary.updated += 1
      } catch {
        summary.providerErrors += 1
        continue
      }
    } else {
      summary.wouldUpdate += 1
    }

    if (summary.sampleUpdated.length < 25) {
      summary.sampleUpdated.push({
        name: row.name,
        position: row.position,
        team: row.team,
        source: result.source,
        confidence: result.confidence,
      })
    }
  }

  summary.durationMs = Date.now() - startedAt
  return NextResponse.json({ ok: true, summary })
}
