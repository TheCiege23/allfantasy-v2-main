/**
 * Read-only product-surface audit for unified player data (no external APIs).
 *
 * Usage:
 *   npx tsx scripts/audit-player-surfaces.ts -- --surface draft --sport NFL --limit 10
 *   npx tsx scripts/audit-player-surfaces.ts -- --surface waivers --sport NCAAF --missing class --limit 5
 *   npx tsx scripts/audit-player-surfaces.ts -- --surface roster --sport SOCCER --league EPL --limit 5
 *
 * Requires AF_AUDIT_LEAGUE_ID or --leagueId for draft/waivers/roster.
 */

import { getPlayerDataForSurface } from '@/lib/player-data/getPlayerDataForSurface'
import type { PlayerDataSurface } from '@/lib/player-data/unifiedPlayerProductView'
import type { LeagueSport } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { normalizeSoccerLeague, type RollingInsightsSoccerLeagueCode } from '@/lib/providers/rollingInsightsSoccerLeague'

type MissingFilter = 'class' | 'league' | 'rookie' | 'image' | 'stats' | 'projections' | 'live' | 'none'

function parseArgs(argv: string[]) {
  let surface: PlayerDataSurface = 'draft'
  let sport: LeagueSport | null = null
  let limit = 50
  let leagueId: string | null = process.env.AF_AUDIT_LEAGUE_ID ?? null
  let userId: string | null = null
  let missing: MissingFilter = 'none'
  let soccerLeague: RollingInsightsSoccerLeagueCode | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--surface' && argv[i + 1]) {
      surface = argv[++i] as PlayerDataSurface
    } else if (a === '--sport' && argv[i + 1]) {
      sport = normalizeToSupportedSport(argv[++i] as string) as LeagueSport
    } else if (a === '--league' && argv[i + 1]) {
      const raw = argv[++i]
      soccerLeague = normalizeSoccerLeague(raw)
    } else if (a === '--leagueId' && argv[i + 1]) {
      leagueId = argv[++i] ?? null
    } else if (a === '--userId' && argv[i + 1]) {
      userId = argv[++i] ?? null
    } else if (a === '--limit' && argv[i + 1]) {
      limit = Math.min(2000, Math.max(1, Number(argv[++i]) || 50))
    } else if (a === '--missing' && argv[i + 1]) {
      const m = argv[++i] as MissingFilter
      if (m === 'class' || m === 'league' || m === 'rookie' || m === 'image' || m === 'stats' || m === 'projections' || m === 'live') {
        missing = m
      }
    }
  }
  return { surface, sport, limit, leagueId, userId, missing, soccerLeague }
}

async function resolveLeagueIdForSport(wanted: LeagueSport | null): Promise<string | null> {
  if (wanted) {
    const row = await prisma.league.findFirst({
      where: { sport: wanted },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    })
    return row?.id ?? null
  }
  const row = await prisma.league.findFirst({
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
  })
  return row?.id ?? null
}

function passesMissing(u: Awaited<ReturnType<typeof getPlayerDataForSurface>>[number], missing: MissingFilter): boolean {
  if (missing === 'none') return true
  const x = u.unified
  if (missing === 'class') return x.sport === 'NCAAF' && x.collegeClass === 'unknown'
  if (missing === 'league') return x.sport === 'SOCCER' && x.soccerLeague == null
  if (missing === 'rookie') return x.sport === 'NFL' && x.nflRookie?.source === 'unknown'
  if (missing === 'image') return !x.headshotUrl || x.imageSource?.includes('placeholder') || x.imageSource === 'null'
  if (missing === 'stats')
    return (
      x.normalizedStats.cacheStats == null &&
      Object.keys(x.normalizedStats).filter((k) => k !== 'projectionSource').length <= 2
    )
  if (missing === 'projections') return Object.keys(x.normalizedProjections).length <= 1
  if (missing === 'live') return x.liveStats == null
  return true
}

async function main() {
  const { surface, sport, limit, leagueId, userId, missing, soccerLeague } = parseArgs(process.argv.slice(2))
  const effectiveLeagueId = leagueId ?? (await resolveLeagueIdForSport(sport))
  if (!effectiveLeagueId) {
    console.error('No league found. Set AF_AUDIT_LEAGUE_ID or pass --leagueId.')
    process.exitCode = 1
    return
  }

  const rows = await getPlayerDataForSurface({
    surface,
    leagueId: effectiveLeagueId,
    userId: userId ?? undefined,
    limit,
    soccerLeague: soccerLeague ?? undefined,
  })

  let filtered = rows.filter((r) => passesMissing(r, missing))
  if (missing !== 'none') {
    /** When filtering for "missing", show up to `limit` bad rows. */
    filtered = filtered.slice(0, limit)
  } else {
    filtered = rows
  }

  const total = rows.length
  const withImage = rows.filter((r) => r.unified.headshotUrl && r.unified.imageSource === 'http_headshot').length
  const withProfile = rows.filter((r) => r.unified.profileSource).length
  const withStats = rows.filter((r) => r.unified.statsSource).length
  const withProj = rows.filter((r) => r.unified.projectionsSource).length
  const withLive = rows.filter((r) => r.unified.liveSource).length
  const withNormStats = rows.filter((r) => Object.keys(r.unified.normalizedStats).length > 2).length
  const missingTeam = rows.filter((r) => !r.unified.team && !r.unified.teamAbbr).length
  const nflRookieUnknown = rows.filter((r) => r.unified.sport === 'NFL' && r.unified.nflRookie?.source === 'unknown')
    .length
  const ncaafbClassUnknown = rows.filter((r) => r.unified.sport === 'NCAAF' && r.unified.collegeClass === 'unknown')
    .length
  const soccerLeagueMissing = rows.filter((r) => r.unified.sport === 'SOCCER' && r.unified.soccerLeague == null).length

  console.log(JSON.stringify({
    surface,
    leagueId: effectiveLeagueId,
    sport: sport ?? 'from_league',
    missingFilter: missing,
    counts: {
      totalSurfaced: total,
      withHttpHeadshot: withImage,
      withProfileSource: withProfile,
      withStatsSource: withStats,
      withProjectionsSource: withProj,
      withLiveSource: withLive,
      withNormalizedStatsPayload: withNormStats,
      missingTeamOrAbbr: missingTeam,
      nflRookieSignalUnknown: nflRookieUnknown,
      ncaafbClassUnknown,
      soccerLeagueMissing,
    },
    sample: filtered.slice(0, Math.min(5, filtered.length)).map((r) => ({
      playerId: r.unified.playerId,
      name: r.unified.fullName,
      sport: r.unified.sport,
      team: r.unified.team,
      position: r.unified.position,
      soccerLeague: r.unified.soccerLeague,
      collegeClass: r.unified.collegeClass,
      nflRookie: r.unified.nflRookie,
      lowConfidence: r.unified.lowConfidence,
    })),
  }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
