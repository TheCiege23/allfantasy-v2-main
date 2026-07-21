/**
 * Truthful warehouse availability: distinguishes "no historical events exist" from "historical
 * data was never imported". `PlayerGameStat` sat at ZERO production rows while the warehouse
 * API served empty arrays that the UI rendered as legitimate empty history — this module is the
 * shared source of truth for that distinction, used by /api/warehouse/league-history and the
 * admin production-health surface.
 */

import { prisma } from '@/lib/prisma'

export type WarehouseDataStatus = 'AVAILABLE' | 'PARTIAL' | 'PENDING_IMPORT' | 'UNAVAILABLE'

export interface WarehouseCoverage {
  sourcePlayerGameStats: number
  generatedPlayerFacts: number
  sourceWeeks: number
  factWeeks: number
  earliestSeason: number | null
  latestSeason: number | null
}

export interface WarehouseDataState {
  status: WarehouseDataStatus
  coverage: WarehouseCoverage
  warnings: string[]
}

/**
 * Compute the player-stat data state for a sport (optionally scoped to a season).
 *
 * PENDING_IMPORT — no source stats at all: ingestion has not run; empty history is NOT real.
 * UNAVAILABLE   — stats exist but facts were never generated from them.
 * PARTIAL       — facts exist but cover fewer weeks than the source stats do.
 * AVAILABLE     — facts exist and cover every week the source does.
 */
export async function computeWarehouseDataState(
  sport: string,
  season?: number | null
): Promise<WarehouseDataState> {
  const sportKey = sport.trim().toUpperCase()
  const statWhere = { sportType: sportKey, ...(season != null ? { season } : {}) }
  const factWhere = { sport: sportKey, ...(season != null ? { season } : {}) }

  const [statCount, factCount, statWeeks, factWeeks, statSeasons] = await Promise.all([
    prisma.playerGameStat.count({ where: statWhere }),
    prisma.playerGameFact.count({ where: factWhere }),
    prisma.playerGameStat.groupBy({ by: ['weekOrRound'], where: statWhere }),
    prisma.playerGameFact.groupBy({ by: ['weekOrRound'], where: factWhere }),
    prisma.playerGameStat.aggregate({ where: { sportType: sportKey }, _min: { season: true }, _max: { season: true } }),
  ])

  const coverage: WarehouseCoverage = {
    sourcePlayerGameStats: statCount,
    generatedPlayerFacts: factCount,
    sourceWeeks: statWeeks.length,
    factWeeks: factWeeks.length,
    earliestSeason: statSeasons._min.season ?? null,
    latestSeason: statSeasons._max.season ?? null,
  }

  const warnings: string[] = []
  let status: WarehouseDataStatus

  if (statCount === 0 && factCount === 0) {
    status = 'PENDING_IMPORT'
    warnings.push(
      `No ${sportKey} player game statistics have been imported${season != null ? ` for season ${season}` : ''} — empty history reflects a missing import, not real data.`
    )
  } else if (factCount === 0) {
    status = 'UNAVAILABLE'
    warnings.push(
      `${statCount} ${sportKey} player game stat rows exist but no warehouse facts were generated from them.`
    )
  } else if (factWeeks.length < statWeeks.length) {
    status = 'PARTIAL'
    warnings.push(
      `Warehouse facts cover ${factWeeks.length} of ${statWeeks.length} weeks with source statistics.`
    )
  } else {
    status = 'AVAILABLE'
  }

  return { status, coverage, warnings }
}

export interface SportsWarehouseHealth {
  status: 'HEALTHY' | 'DEGRADED' | 'CRITICAL'
  playerGameStats: number
  playerGameFacts: number
  latestIngestionRun: {
    status: string
    startedAt: string
    completedAt: string | null
    rowsWritten: number
    errorMessage: string | null
  } | null
  collegeTeamCodeFallbacks: number
  /** Weeks (latest ingested season) whose stat/fact counts do not reconcile. null = metric unavailable, NOT zero. */
  mismatchedWeeks: number[] | null
  /** `running` telemetry rows older than the stale threshold. null = metric unavailable. */
  staleRunningJobs: number | null
  /** Timed-out runs + abandoned/provider-timeout ledger rows in the last 24h. null = metric unavailable. */
  recentTimeouts: number | null
  /** Source-vs-imported player gap per college sport. null = metric unavailable. */
  collegeBacklog: Record<string, number> | null
  warnings: string[]
}

const STALE_RUNNING_THRESHOLD_MS = 10 * 60 * 1000
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000
const COLLEGE_BACKLOG_DEGRADED_THRESHOLD = 500

/**
 * Admin health rollup for the sports/warehouse pipeline.
 * CRITICAL — a stat/fact table is empty (the exact silent state the P0 release repaired).
 * DEGRADED — the latest run failed, weeks don't reconcile, stale `running` rows linger,
 *   recent provider timeouts occurred, truncated team-code fallbacks appeared, or the college
 *   import backlog is material.
 * Metrics that cannot be computed are reported as null with a warning — never collapsed to 0.
 */
export async function getSportsWarehouseHealth(): Promise<SportsWarehouseHealth> {
  const warnings: string[] = []

  const [playerGameStats, playerGameFacts, latestRun, latestImportRun] = await Promise.all([
    prisma.playerGameStat.count(),
    prisma.playerGameFact.count(),
    prisma.syncJobRun.findFirst({
      where: { jobName: 'import-player-game-stats' },
      orderBy: { startedAt: 'desc' },
      select: { status: true, startedAt: true, completedAt: true, rowsWritten: true, errorMessage: true },
    }),
    prisma.syncJobRun.findFirst({
      where: { jobName: 'import-players' },
      orderBy: { startedAt: 'desc' },
      select: { metadata: true },
    }),
  ])

  if (playerGameStats === 0) warnings.push('PlayerGameStat has zero rows — game-stat ingestion has never completed.')
  if (playerGameFacts === 0) warnings.push('PlayerGameFact has zero rows — warehouse fact generation has never completed.')
  if (latestRun?.status === 'failed') warnings.push(`Latest game-stat ingestion run failed: ${latestRun.errorMessage ?? 'unknown error'}`)

  let collegeTeamCodeFallbacks = 0
  const meta = latestImportRun?.metadata
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const counts = (meta as Record<string, unknown>).teamCodeCounts
    if (counts && typeof counts === 'object') {
      for (const sportCounts of Object.values(counts as Record<string, unknown>)) {
        const fallback = (sportCounts as Record<string, unknown> | null)?.truncated_fallback
        if (typeof fallback === 'number') collegeTeamCodeFallbacks += fallback
      }
    }
  }
  if (collegeTeamCodeFallbacks > 0) {
    warnings.push(`${collegeTeamCodeFallbacks} player rows used truncated team-code fallbacks in the latest import.`)
  }

  // Stat/fact reconciliation per week for the latest ingested season.
  let mismatchedWeeks: number[] | null = null
  try {
    const latestSeasonAgg = await prisma.playerGameStat.aggregate({ _max: { season: true } })
    const season = latestSeasonAgg._max.season
    if (season != null) {
      const [statWeeks, factWeeks] = await Promise.all([
        prisma.playerGameStat.groupBy({ by: ['weekOrRound'], where: { season }, _count: { _all: true } }),
        prisma.playerGameFact.groupBy({ by: ['weekOrRound'], where: { season }, _count: { _all: true } }),
      ])
      const factCounts = new Map(factWeeks.map((row) => [row.weekOrRound ?? -1, row._count._all]))
      mismatchedWeeks = statWeeks
        .filter((row) => (factCounts.get(row.weekOrRound) ?? 0) !== row._count._all)
        .map((row) => row.weekOrRound)
        .sort((a, b) => a - b)
      if (mismatchedWeeks.length > 0) {
        warnings.push(`Season ${season}: stat/fact counts do not reconcile for week(s) ${mismatchedWeeks.join(', ')}.`)
      }
    } else {
      mismatchedWeeks = []
    }
  } catch (err) {
    warnings.push(`mismatched-weeks metric unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }

  let staleRunningJobs: number | null = null
  try {
    staleRunningJobs = await prisma.syncJobRun.count({
      where: { status: 'running', startedAt: { lt: new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS) } },
    })
    if (staleRunningJobs > 0) warnings.push(`${staleRunningJobs} stale 'running' job row(s) past the 10-minute threshold.`)
  } catch (err) {
    warnings.push(`stale-running metric unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }

  let recentTimeouts: number | null = null
  try {
    const since = new Date(Date.now() - RECENT_WINDOW_MS)
    const [timedOutRuns, abandonedLedger, providerTimeouts] = await Promise.all([
      prisma.syncJobRun.count({ where: { status: 'timed_out', completedAt: { gt: since } } }),
      prisma.statIngestionJob.count({ where: { status: 'abandoned', completedAt: { gt: since } } }),
      prisma.statIngestionJob.count({
        where: { status: 'failed', completedAt: { gt: since }, errorMessage: { contains: 'timeout' } },
      }),
    ])
    recentTimeouts = timedOutRuns + abandonedLedger + providerTimeouts
    if (recentTimeouts > 0) warnings.push(`${recentTimeouts} timeout/abandonment event(s) in the last 24h.`)
  } catch (err) {
    warnings.push(`recent-timeouts metric unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }

  let collegeBacklog: Record<string, number> | null = null
  try {
    const [sourceCounts, importedCounts] = await Promise.all([
      prisma.sportsPlayer.groupBy({ by: ['sport'], where: { sport: { in: ['NCAAF', 'NCAAB'] } }, _count: { _all: true } }),
      prisma.sportsPlayerRecord.groupBy({ by: ['sport'], where: { sport: { in: ['NCAAF', 'NCAAB'] } }, _count: { _all: true } }),
    ])
    const imported = new Map(importedCounts.map((row) => [row.sport, row._count._all]))
    collegeBacklog = {}
    for (const row of sourceCounts) {
      collegeBacklog[row.sport] = Math.max(0, row._count._all - (imported.get(row.sport) ?? 0))
    }
    const materialBacklog = Object.entries(collegeBacklog).filter(([, gap]) => gap > COLLEGE_BACKLOG_DEGRADED_THRESHOLD)
    if (materialBacklog.length > 0) {
      warnings.push(
        `College import backlog: ${materialBacklog.map(([sport, gap]) => `${sport} ${gap}`).join(', ')} source players not yet imported.`
      )
    }
  } catch (err) {
    warnings.push(`college-backlog metric unavailable: ${err instanceof Error ? err.message : String(err)}`)
  }

  const degraded =
    latestRun?.status === 'failed' ||
    collegeTeamCodeFallbacks > 0 ||
    (mismatchedWeeks?.length ?? 0) > 0 ||
    (staleRunningJobs ?? 0) > 0 ||
    (recentTimeouts ?? 0) > 0 ||
    Object.values(collegeBacklog ?? {}).some((gap) => gap > COLLEGE_BACKLOG_DEGRADED_THRESHOLD)

  return {
    status: playerGameStats === 0 || playerGameFacts === 0 ? 'CRITICAL' : degraded ? 'DEGRADED' : 'HEALTHY',
    playerGameStats,
    playerGameFacts,
    latestIngestionRun: latestRun
      ? {
          status: latestRun.status,
          startedAt: latestRun.startedAt.toISOString(),
          completedAt: latestRun.completedAt?.toISOString() ?? null,
          rowsWritten: latestRun.rowsWritten,
          errorMessage: latestRun.errorMessage,
        }
      : null,
    collegeTeamCodeFallbacks,
    mismatchedWeeks,
    staleRunningJobs,
    recentTimeouts,
    collegeBacklog,
    warnings,
  }
}
