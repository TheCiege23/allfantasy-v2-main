import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { DATA_TTLS, isFreshDate, triggerBackgroundRefresh } from '@/lib/data/shared'
import { runInjuryImporter } from '@/lib/workers/injury-importer'
import { runNewsImporter } from '@/lib/workers/news-importer'
import { runSportsDataImporter } from '@/lib/workers/sports-data-importer'
import { requestPlayerImportRefresh, requestPlayerNewsRefresh } from '@/lib/workers/sports-data-import-coordinator'

// Phase 21 rollback flag. Default OFF (existing synchronous-await behavior), matching
// this codebase's established convention for behavior-changing flags (Waiver/Trade shadow
// flags all default off). Set to 'true' to enable non-blocking refresh on a cache miss.
function isNonBlockingRefreshEnabled(): boolean {
  return process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH === 'true'
}

export async function getPlayer(playerId: string) {
  let row = await prisma.sportsPlayerRecord.findUnique({ where: { id: playerId } })
  if (!row) {
    const sport = normalizeToSupportedSport(playerId.split(':')[0] || undefined)
    if (isNonBlockingRefreshEnabled()) {
      requestPlayerImportRefresh(sport, 'get_player_miss')
      return null
    }
    await runSportsDataImporter({ sports: [sport] })
    row = await prisma.sportsPlayerRecord.findUnique({ where: { id: playerId } })
    return row
  }

  if (!isFreshDate(row.lastUpdated, DATA_TTLS.players)) {
    triggerBackgroundRefresh(`players:${row.sport}`, () => runSportsDataImporter({ sports: [row!.sport] }))
  }

  return row
}

export async function searchPlayers(query: string, sport: string) {
  const normalizedSport = normalizeToSupportedSport(sport)
  let rows = await prisma.sportsPlayerRecord.findMany({
    where: {
      sport: normalizedSport,
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { team: { equals: query.toUpperCase() } },
      ],
    },
    orderBy: [{ lastUpdated: 'desc' }, { name: 'asc' }],
    take: 30,
  })

  if (rows.length === 0) {
    if (isNonBlockingRefreshEnabled()) {
      requestPlayerImportRefresh(normalizedSport, 'search_players_miss')
      return rows
    }
    await runSportsDataImporter({ sports: [normalizedSport] })
    rows = await prisma.sportsPlayerRecord.findMany({
      where: {
        sport: normalizedSport,
        name: { contains: query, mode: 'insensitive' },
      },
      orderBy: [{ lastUpdated: 'desc' }, { name: 'asc' }],
      take: 30,
    })
  } else if (!isFreshDate(rows[0]?.lastUpdated, DATA_TTLS.players)) {
    triggerBackgroundRefresh(`players:${normalizedSport}`, () => runSportsDataImporter({ sports: [normalizedSport] }))
  }

  return rows
}

export async function getPlayersByTeam(team: string, sport: string) {
  const normalizedSport = normalizeToSupportedSport(sport)
  let rows = await prisma.sportsPlayerRecord.findMany({
    where: {
      sport: normalizedSport,
      team: team.toUpperCase(),
    },
    orderBy: [{ lastUpdated: 'desc' }, { name: 'asc' }],
    take: 100,
  })

  if (rows.length === 0) {
    if (isNonBlockingRefreshEnabled()) {
      requestPlayerImportRefresh(normalizedSport, 'get_players_by_team_miss')
      return rows
    }
    await runSportsDataImporter({ sports: [normalizedSport] })
    rows = await prisma.sportsPlayerRecord.findMany({
      where: {
        sport: normalizedSport,
        team: team.toUpperCase(),
      },
      orderBy: [{ lastUpdated: 'desc' }, { name: 'asc' }],
      take: 100,
    })
  } else if (!isFreshDate(rows[0]?.lastUpdated, DATA_TTLS.players)) {
    triggerBackgroundRefresh(`players-team:${normalizedSport}:${team}`, () => runSportsDataImporter({ sports: [normalizedSport] }))
  }

  return rows
}

export async function getInjuryReport(sport: string, week?: number) {
  const normalizedSport = normalizeToSupportedSport(sport)
  let rows = await prisma.injuryReportRecord.findMany({
    where: {
      sport: normalizedSport,
      ...(typeof week === 'number' ? { week } : {}),
    },
    orderBy: { reportDate: 'desc' },
    take: 250,
  })

  if (rows.length === 0) {
    await runInjuryImporter({ sports: [normalizedSport], week })
    rows = await prisma.injuryReportRecord.findMany({
      where: {
        sport: normalizedSport,
        ...(typeof week === 'number' ? { week } : {}),
      },
      orderBy: { reportDate: 'desc' },
      take: 250,
    })
  } else if (!isFreshDate(rows[0]?.reportDate, DATA_TTLS.injuries)) {
    triggerBackgroundRefresh(`injuries:${normalizedSport}:${week ?? 'all'}`, () =>
      runInjuryImporter({ sports: [normalizedSport], week })
    )
  }

  return rows
}

export async function getPlayerNews(playerId: string, limit: number = 10) {
  let rows = await prisma.playerNewsRecord.findMany({
    where: {
      OR: [{ playerId }, { playerName: { contains: playerId, mode: 'insensitive' } }],
    },
    orderBy: { publishedAt: 'desc' },
    take: limit,
  })

  if (rows.length === 0) {
    if (isNonBlockingRefreshEnabled()) {
      requestPlayerNewsRefresh('get_player_news_miss')
      return rows
    }
    await runNewsImporter()
    rows = await prisma.playerNewsRecord.findMany({
      where: {
        OR: [{ playerId }, { playerName: { contains: playerId, mode: 'insensitive' } }],
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
    })
  } else if (!isFreshDate(rows[0]?.publishedAt, DATA_TTLS.news)) {
    triggerBackgroundRefresh(`player-news:${playerId}`, () => runNewsImporter())
  }

  return rows
}
