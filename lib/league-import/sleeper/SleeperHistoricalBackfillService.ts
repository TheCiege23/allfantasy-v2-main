import { runDynastyBackfill } from '@/lib/dynasty-import'
import { buildLeagueGraph } from '@/lib/league-intelligence-graph'
import { rebuildHallOfFame } from '@/lib/rankings-engine/hall-of-fame'
import {
  syncSleeperHistoricalDraftFactsAfterImport,
  type SleeperHistoricalDraftSyncSummary,
} from './SleeperHistoricalDraftSyncService'
import {
  syncSleeperHistoricalSeasonStateAfterImport,
  type SleeperHistoricalSeasonStateSyncSummary,
} from './SleeperHistoricalSeasonStateSyncService'
import {
  syncSleeperHistoricalMatchupsAfterImport,
  type SleeperHistoricalMatchupSyncSummary,
} from './SleeperHistoricalMatchupSyncService'

export interface SleeperHistoricalBackfillSummary {
  attempted: boolean
  skipped: boolean
  reason?: string
  drafts?: SleeperHistoricalDraftSyncSummary
  seasonState?: SleeperHistoricalSeasonStateSyncSummary
  matchups?: SleeperHistoricalMatchupSyncSummary
  backfill?: {
    success: boolean
    status: string
    seasonsDiscovered: number
    seasonsImported: number
    seasonsSkipped: number
    tradesPersisted: number
    failureMessage?: string
  }
  graph?: {
    refreshed: boolean
    nodeCount?: number
    edgeCount?: number
    snapshotId?: string
    error?: string
  }
  hallOfFame?: {
    refreshed: boolean
    count?: number
    error?: string
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Unknown error'
}

/**
 * Reuse the existing dynasty backfill pipeline after a Sleeper league import so
 * standings/trades history actually lands in the core models used by the app.
 * This now runs for all Sleeper imports; non-dynasty leagues use the backfill
 * force flag so prior records and trades are still captured when history exists.
 */
export async function syncSleeperHistoricalBackfillAfterImport(args: {
  leagueId: string
  isDynasty: boolean
  /** Admin/internal-only escape hatch to force a full refetch of already-imported seasons. */
  force?: boolean
}): Promise<SleeperHistoricalBackfillSummary> {
  const drafts = await syncSleeperHistoricalDraftFactsAfterImport({
    leagueId: args.leagueId,
    force: args.force,
  })
  const seasonState = await syncSleeperHistoricalSeasonStateAfterImport({
    leagueId: args.leagueId,
    force: args.force,
  })
  const matchups = await syncSleeperHistoricalMatchupsAfterImport({
    leagueId: args.leagueId,
  })

  try {
    const backfill = await runDynastyBackfill({
      leagueId: args.leagueId,
      force: !args.isDynasty,
      skipExistingSeasons: true,
    })

    const summary: SleeperHistoricalBackfillSummary = {
      attempted: true,
      skipped: false,
      drafts,
      seasonState,
      matchups,
      backfill: {
        success: backfill.success,
        status: backfill.status,
        seasonsDiscovered: backfill.seasonsDiscovered,
        seasonsImported: backfill.seasonsImported,
        seasonsSkipped: backfill.seasonsSkipped,
        tradesPersisted: backfill.tradesPersisted,
        failureMessage: backfill.failureMessage,
      },
    }

    const shouldRefreshDerivedData =
      backfill.seasonsImported > 0 || backfill.seasonsSkipped > 0

    if (!shouldRefreshDerivedData) {
      summary.graph = {
        refreshed: false,
        error: 'No historical seasons were imported or detected, so graph refresh was skipped.',
      }
      summary.hallOfFame = {
        refreshed: false,
        error: 'No historical seasons were imported or detected, so hall of fame refresh was skipped.',
      }
      return summary
    }

    try {
      const graph = await buildLeagueGraph({
        leagueId: args.leagueId,
        season: null,
        includeTrades: true,
        includeRivalries: true,
      })
      summary.graph = {
        refreshed: true,
        nodeCount: graph.nodeCount,
        edgeCount: graph.edgeCount,
        snapshotId: graph.snapshotId,
      }
    } catch (error) {
      summary.graph = {
        refreshed: false,
        error: getErrorMessage(error),
      }
    }

    try {
      const hallOfFame = await rebuildHallOfFame({ leagueId: args.leagueId })
      summary.hallOfFame = {
        refreshed: true,
        count: hallOfFame.count,
      }
    } catch (error) {
      summary.hallOfFame = {
        refreshed: false,
        error: getErrorMessage(error),
      }
    }

    return summary
  } catch (error) {
    return {
      attempted: true,
      skipped: false,
      backfill: {
        success: false,
        status: 'failed',
        seasonsDiscovered: 0,
        seasonsImported: 0,
        seasonsSkipped: 0,
        tradesPersisted: 0,
        failureMessage: getErrorMessage(error),
      },
      drafts,
      seasonState,
      matchups,
      graph: {
        refreshed: false,
      },
      hallOfFame: {
        refreshed: false,
      },
    }
  }
}
