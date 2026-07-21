import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Narrow, additive health surface for the P0 production-repair pipelines — reuses existing
 * tables/models only (no new migration, no new observability subsystem). Wired into the
 * existing GET /api/admin/sports/sync response.
 */
export interface SportsP0PipelineHealth {
  playerSeasonStats: { rowCount: number; newestUpdatedAt: string | null }
  playerGameStat: { rowCount: number; newestUpdatedAt: string | null }
  playerGameFact: { rowCount: number; newestUpdatedAt: string | null }
  statIngestionJobs: {
    lastSucceededAt: string | null
    lastFailedAt: string | null
    lastFailureMessage: string | null
  }
  collegeTeamNormalization: {
    /** Live count of NCAAF/NCAAB SportsPlayerRecord rows whose `team` doesn't match any known
     * SportsTeam short code — i.e. rows that fell through to a derived/bounded code rather than
     * a canonical mapping. Computed on demand; not a persisted counter (no new table). */
    unmappedTeamCodeCount: number
  }
  cronAuth: {
    cronSecretConfigured: boolean
    legacyLeagueCronSecretConfigured: boolean
  }
  notes: string[]
}

export async function getSportsP0PipelineHealth(): Promise<SportsP0PipelineHealth> {
  const notes: string[] = [
    'Historical draft/roster skip-vs-refetch counters are returned per-call by the sync ' +
      'functions (see SleeperHistoricalDraftSyncService/SleeperHistoricalSeasonStateSyncService) ' +
      'but are not persisted anywhere yet — no historical trend is queryable here without a new ' +
      'run-log table, which this P0 deliberately avoids.',
  ]

  const [
    playerSeasonStatsCount,
    playerSeasonStatsNewest,
    playerGameStatCount,
    playerGameStatNewest,
    playerGameFactCount,
    playerGameFactNewest,
    lastSucceededJob,
    lastFailedJob,
    ncaaSportsPlayerRecords,
    ncaaTeamCodes,
  ] = await Promise.all([
    prisma.playerSeasonStats.count(),
    prisma.playerSeasonStats.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
    prisma.playerGameStat.count(),
    prisma.playerGameStat.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    prisma.playerGameFact.count(),
    prisma.playerGameFact.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    prisma.statIngestionJob.findFirst({ where: { status: 'completed' }, orderBy: { completedAt: 'desc' }, select: { completedAt: true } }),
    prisma.statIngestionJob.findFirst({ where: { status: 'failed' }, orderBy: { completedAt: 'desc' }, select: { completedAt: true, errorMessage: true } }),
    prisma.sportsPlayerRecord.findMany({
      where: { sport: { in: ['NCAAF', 'NCAAB'] } },
      select: { team: true },
      take: 5000,
    }),
    prisma.sportsTeam.findMany({
      where: { sport: { in: ['NCAAF', 'NCAAB'] } },
      select: { shortName: true },
    }),
  ]).catch((error) => {
    notes.push(`Health query failed: ${error instanceof Error ? error.message : String(error)}`)
    return [0, null, 0, null, 0, null, null, null, [], []] as const
  })

  const knownCodes = new Set(
    (ncaaTeamCodes as Array<{ shortName: string | null }>).map((t) => t.shortName?.trim().toUpperCase()).filter(Boolean),
  )
  const unmappedTeamCodeCount = (ncaaSportsPlayerRecords as Array<{ team: string }>).filter(
    (row) => row.team && row.team !== 'FA' && !knownCodes.has(row.team.trim().toUpperCase()),
  ).length

  return {
    playerSeasonStats: {
      rowCount: playerSeasonStatsCount as number,
      newestUpdatedAt: (playerSeasonStatsNewest as { fetchedAt: Date } | null)?.fetchedAt?.toISOString() ?? null,
    },
    playerGameStat: {
      rowCount: playerGameStatCount as number,
      newestUpdatedAt: (playerGameStatNewest as { updatedAt: Date } | null)?.updatedAt?.toISOString() ?? null,
    },
    playerGameFact: {
      rowCount: playerGameFactCount as number,
      newestUpdatedAt: (playerGameFactNewest as { createdAt: Date } | null)?.createdAt?.toISOString() ?? null,
    },
    statIngestionJobs: {
      lastSucceededAt: (lastSucceededJob as { completedAt: Date | null } | null)?.completedAt?.toISOString() ?? null,
      lastFailedAt: (lastFailedJob as { completedAt: Date | null } | null)?.completedAt?.toISOString() ?? null,
      lastFailureMessage: (lastFailedJob as { errorMessage: string | null } | null)?.errorMessage ?? null,
    },
    collegeTeamNormalization: { unmappedTeamCodeCount },
    cronAuth: {
      cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      legacyLeagueCronSecretConfigured: Boolean(process.env.LEAGUE_CRON_SECRET?.trim()),
    },
    notes,
  }
}
