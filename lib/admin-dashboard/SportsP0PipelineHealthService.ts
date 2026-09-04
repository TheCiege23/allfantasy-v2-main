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

/**
 * Runs one query, isolated. Failure sticks a note on `notes` and resolves to `fallback` instead
 * of rejecting.
 *
 * 🛑 WITHOUT THIS, ONE FAILING QUERY BLANKED ALL TEN METRICS. The original code ran all ten
 * queries in a single `Promise.all(...).catch(...)` — any one of them throwing (a table not yet
 * migrated in some environment, a transient timeout on the NCAA team-code scan) fell through to a
 * fixed fallback array, and playerSeasonStats/playerGameStat/playerGameFact all reported
 * `rowCount: 0, newestUpdatedAt: null` — "no data ever imported" — even though those three tables
 * are completely unrelated to whichever query actually failed and were perfectly healthy.
 *
 * Isolating each query is the same shape AdminProviderHealthService.ts's own `safeCount`/
 * `safeFindMany` already use for exactly this reason — this file just never had it.
 */
async function safeQuery<T>(fn: () => Promise<T>, fallback: T, notes: string[], label: string): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    notes.push(`${label} query failed: ${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
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
    safeQuery(() => prisma.playerSeasonStats.count(), 0, notes, 'playerSeasonStats.count'),
    safeQuery(
      () => prisma.playerSeasonStats.findFirst({ orderBy: { fetchedAt: 'desc' }, select: { fetchedAt: true } }),
      null,
      notes,
      'playerSeasonStats.findFirst',
    ),
    safeQuery(() => prisma.playerGameStat.count(), 0, notes, 'playerGameStat.count'),
    safeQuery(
      () => prisma.playerGameStat.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      null,
      notes,
      'playerGameStat.findFirst',
    ),
    safeQuery(() => prisma.playerGameFact.count(), 0, notes, 'playerGameFact.count'),
    safeQuery(
      () => prisma.playerGameFact.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
      null,
      notes,
      'playerGameFact.findFirst',
    ),
    safeQuery(
      () =>
        prisma.statIngestionJob.findFirst({
          where: { status: 'completed' },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true },
        }),
      null,
      notes,
      'statIngestionJob.completed',
    ),
    safeQuery(
      () =>
        prisma.statIngestionJob.findFirst({
          where: { status: 'failed' },
          orderBy: { completedAt: 'desc' },
          select: { completedAt: true, errorMessage: true },
        }),
      null,
      notes,
      'statIngestionJob.failed',
    ),
    safeQuery(
      () =>
        prisma.sportsPlayerRecord.findMany({
          where: { sport: { in: ['NCAAF', 'NCAAB'] } },
          select: { team: true },
          take: 5000,
        }),
      [],
      notes,
      'sportsPlayerRecord.findMany',
    ),
    safeQuery(
      () =>
        prisma.sportsTeam.findMany({
          where: { sport: { in: ['NCAAF', 'NCAAB'] } },
          select: { shortName: true },
        }),
      [],
      notes,
      'sportsTeam.findMany',
    ),
  ])

  const knownCodes = new Set(
    ncaaTeamCodes.map((t) => t.shortName?.trim().toUpperCase()).filter(Boolean),
  )
  const unmappedTeamCodeCount = ncaaSportsPlayerRecords.filter(
    (row) => row.team && row.team !== 'FA' && !knownCodes.has(row.team.trim().toUpperCase()),
  ).length

  return {
    playerSeasonStats: {
      rowCount: playerSeasonStatsCount,
      newestUpdatedAt: playerSeasonStatsNewest?.fetchedAt?.toISOString() ?? null,
    },
    playerGameStat: {
      rowCount: playerGameStatCount,
      newestUpdatedAt: playerGameStatNewest?.updatedAt?.toISOString() ?? null,
    },
    playerGameFact: {
      rowCount: playerGameFactCount,
      newestUpdatedAt: playerGameFactNewest?.createdAt?.toISOString() ?? null,
    },
    statIngestionJobs: {
      lastSucceededAt: lastSucceededJob?.completedAt?.toISOString() ?? null,
      lastFailedAt: lastFailedJob?.completedAt?.toISOString() ?? null,
      lastFailureMessage: lastFailedJob?.errorMessage ?? null,
    },
    collegeTeamNormalization: { unmappedTeamCodeCount },
    cronAuth: {
      cronSecretConfigured: Boolean(process.env.CRON_SECRET?.trim()),
      legacyLeagueCronSecretConfigured: Boolean(process.env.LEAGUE_CRON_SECRET?.trim()),
    },
    notes,
  }
}
