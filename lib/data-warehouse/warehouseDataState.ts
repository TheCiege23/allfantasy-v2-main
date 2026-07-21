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
  warnings: string[]
}

/**
 * Admin health rollup for the sports/warehouse pipeline. CRITICAL when the stat or fact table
 * is empty (the exact silent state this P0 repaired); DEGRADED when the latest ingestion run
 * failed or college imports needed truncated team-code fallbacks.
 */
export async function getSportsWarehouseHealth(): Promise<SportsWarehouseHealth> {
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

  const warnings: string[] = []
  if (playerGameStats === 0) warnings.push('PlayerGameStat has zero rows — game-stat ingestion has never completed.')
  if (playerGameFacts === 0) warnings.push('PlayerGameFact has zero rows — warehouse fact generation has never completed.')
  if (latestRun?.status === 'failed') warnings.push(`Latest game-stat ingestion run failed: ${latestRun.errorMessage ?? 'unknown error'}`)

  // Surfaced by the sports-data importer's teamCodeCounts report when it lands in run metadata.
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

  return {
    status:
      playerGameStats === 0 || playerGameFacts === 0
        ? 'CRITICAL'
        : latestRun?.status === 'failed' || collegeTeamCodeFallbacks > 0
          ? 'DEGRADED'
          : 'HEALTHY',
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
    warnings,
  }
}
