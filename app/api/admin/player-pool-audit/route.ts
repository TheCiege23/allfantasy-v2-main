/**
 * GET /api/admin/player-pool-audit
 *
 * Sport+season player-pool quality audit. Reads SportsPlayer rows for the
 * requested sport, enriches them with PlayerSeasonStats (FPPG) and
 * AllFantasyAdpSnapshot (ADP) for the requested season, and runs the shared
 * `buildPlayerPoolAudit` reducer.
 *
 * Dev-only by default. In production, requires `x-audit-secret` matching
 * `PLAYER_POOL_AUDIT_SECRET`.
 *
 * Query params:
 *   - sport   (default: NFL) — NFL | NBA | MLB | NHL | NCAAF | NCAAB | SOCCER
 *   - season  (default: 2025)
 *   - limit   (default: 300, max: 2000)
 */
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  buildPlayerPoolAudit,
  normalizeAuditPlayerName,
  type PlayerPoolAuditRow,
} from '@/lib/draft-room/player-pool-audit'
import { buildAllFantasyAdpPlayerKey, normalizeAdpPosition } from '@/lib/adp/playerKey'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 300
const MAX_LIMIT = 2000
const SUPPORTED_SPORTS = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER'] as const
type SupportedSport = (typeof SUPPORTED_SPORTS)[number]

function parseSport(raw: string | null): SupportedSport {
  const v = (raw ?? 'NFL').trim().toUpperCase()
  return (SUPPORTED_SPORTS as readonly string[]).includes(v) ? (v as SupportedSport) : 'NFL'
}

function parseSeason(raw: string | null): string {
  const v = (raw ?? '').trim()
  return /^\d{4}$/.test(v) ? v : '2025'
}

function parseLimit(raw: string | null): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(Math.floor(n), MAX_LIMIT)
}

type SampleMode = 'draftable' | 'raw'
function parseSample(raw: string | null): SampleMode {
  return (raw ?? '').trim().toLowerCase() === 'raw' ? 'raw' : 'draftable'
}

// Position normalization is centralized in @/lib/adp/playerKey (normalizeAdpPosition).

export async function GET(request: NextRequest) {
  // Gate: dev-open, prod requires shared secret header.
  const isDev = process.env.NODE_ENV !== 'production'
  if (!isDev) {
    const expected = process.env.PLAYER_POOL_AUDIT_SECRET
    const provided = request.headers.get('x-audit-secret')
    if (!expected || provided !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const url = new URL(request.url)
  const sport = parseSport(url.searchParams.get('sport'))
  const season = parseSeason(url.searchParams.get('season'))
  const limit = parseLimit(url.searchParams.get('limit'))
  const sample = parseSample(url.searchParams.get('sample'))

  const startedAt = Date.now()

  // `draftable` (default) excludes retired/FA-style rows so the audit reflects rows that could
  // actually appear in the live pool. `sample=raw` keeps the unfiltered slice for ingestion debugging.
  const draftableWhere =
    sample === 'draftable'
      ? {
          team: { notIn: ['', 'FA', 'fa', 'Fa'] as string[], not: null as string | null },
        }
      : {}

  const players = await prisma.sportsPlayer.findMany({
    where: { sport: { equals: sport, mode: 'insensitive' }, ...draftableWhere },
    take: limit,
    orderBy: { fetchedAt: 'desc' },
    select: {
      id: true,
      sport: true,
      externalId: true,
      source: true,
      name: true,
      position: true,
      team: true,
      imageUrl: true,
      sleeperId: true,
      status: true,
      dob: true,
    },
  })

  // Pull full season stats for the sport without narrowing by raw playerName — names drift across
  // ingestion sources ("T.J. Hockenson" vs "TJ Hockenson"), so we join by normalized name below.
  const [stats, adpSnapshots] = await Promise.all([
    prisma.playerSeasonStats.findMany({
      where: { sport: { equals: sport, mode: 'insensitive' }, season },
      select: {
        playerName: true,
        position: true,
        fantasyPointsPerGame: true,
        fantasyPoints: true,
      },
    }),
    prisma.allFantasyAdpSnapshot.findMany({
      where: { sport: { equals: sport, mode: 'insensitive' }, season },
      select: { playerKey: true, averageOverallPick: true },
    }),
  ])

  // Normalized-name → FPPG (with position-qualified key as primary, name-only as fallback).
  // Position-qualified protects against same-name collisions (e.g., two "Josh Allen"s).
  const fppgByNamePos = new Map<string, number>()
  const fppgByName = new Map<string, number>()
  for (const s of stats) {
    const v = s.fantasyPointsPerGame
    if (v == null || !Number.isFinite(v)) continue
    const nKey = normalizeAuditPlayerName(s.playerName)
    if (!nKey) continue
    if (!fppgByName.has(nKey)) fppgByName.set(nKey, v)
    const posKey = `${nKey}|${normalizeAdpPosition(s.position)}`
    if (!fppgByNamePos.has(posKey)) fppgByNamePos.set(posKey, v)
  }

  // playerKey shape per schema: `${normalizedName}|${position}`.
  const adpByKey = new Map<string, number>()
  for (const a of adpSnapshots) {
    if (!a.playerKey) continue
    if (!Number.isFinite(a.averageOverallPick)) continue
    if (!adpByKey.has(a.playerKey)) adpByKey.set(a.playerKey, a.averageOverallPick)
  }

  let statsJoinHits = 0
  let adpJoinHits = 0
  const rows: PlayerPoolAuditRow[] = players.map((p) => {
    // ADP playerKey shared with writer/resolver via @/lib/adp/playerKey.
    const adpKey = buildAllFantasyAdpPlayerKey({ name: p.name, position: p.position })
    const nKey = normalizeAuditPlayerName(p.name)
    const fppg =
      fppgByNamePos.get(`${nKey}|${normalizeAdpPosition(p.position)}`) ??
      fppgByName.get(nKey) ??
      null
    if (fppg != null) statsJoinHits++
    const adp = adpByKey.get(adpKey) ?? null
    if (adp != null) adpJoinHits++
    return {
      id: p.id,
      providerPlayerId: p.externalId,
      name: p.name,
      position: p.position,
      team: p.team,
      sport: p.sport,
      birthDate: p.dob,
      imageUrl: p.imageUrl,
      status: p.status,
      source: p.source,
      sleeperId: p.sleeperId,
      fantasyPointsPerGame: fppg,
      adp,
    }
  })

  const report = buildPlayerPoolAudit(rows)
  const elapsedMs = Date.now() - startedAt

  return NextResponse.json({
    request: { sport, season, limit, sample },
    meta: {
      elapsedMs,
      sourceTable: 'SportsPlayer',
      enrichments: {
        playerSeasonStatsLoaded: stats.length,
        playerSeasonStatsJoinHits: statsJoinHits,
        adpSnapshotsLoaded: adpSnapshots.length,
        adpJoinHits,
      },
    },
    report,
  })
}
