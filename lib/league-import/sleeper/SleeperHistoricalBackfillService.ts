import { runDynastyBackfill } from '@/lib/dynasty-import'
import { refreshHistoricalDerivedData } from '@/lib/league-import/refreshHistoricalDerivedData'
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
import {
  syncSleeperHistoricalTransactionsAfterImport,
  type SleeperHistoricalTransactionSyncSummary,
} from './SleeperHistoricalTransactionSyncService'

export interface SleeperHistoricalBackfillSummary {
  attempted: boolean
  skipped: boolean
  reason?: string
  drafts?: SleeperHistoricalDraftSyncSummary
  seasonState?: SleeperHistoricalSeasonStateSyncSummary
  matchups?: SleeperHistoricalMatchupSyncSummary
  transactions?: SleeperHistoricalTransactionSyncSummary
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
  /*
   * Drafts, season snapshots and transactions own separate warehouse tables, so making each
   * one wait for the previous service only stretches the import's critical path. Start them
   * together. Matchups deliberately wait for seasonState: both services merge fields into the
   * same LeagueDynastySeason.metadata row, and overlapping those read/merge/write cycles can
   * lose one service's metadata.
   */
  const draftsPromise = syncSleeperHistoricalDraftFactsAfterImport({
    leagueId: args.leagueId,
    force: args.force,
  })
  const seasonStatePromise = syncSleeperHistoricalSeasonStateAfterImport({
    leagueId: args.leagueId,
    force: args.force,
  })
  /*
   * The fourth sibling, added 2026-09-01. Draft, season state and matchups were built and this
   * one never was — so the import fetched 18 weeks of `/transactions/{week}` per league and threw
   * the result away. Waivers and free agents reached NO table at all; trades reached
   * `TransactionFact` only via the psych-profile rotation, which laps 543 leagues in ~45 days.
   *
   * Carries `force` like the draft and season-state siblings so the completion gate can be
   * overridden deliberately rather than by accident.
   */
  const transactionsPromise = syncSleeperHistoricalTransactionsAfterImport({
    leagueId: args.leagueId,
    force: args.force,
  })

  const seasonState = await seasonStatePromise
  const matchupsPromise = syncSleeperHistoricalMatchupsAfterImport({
    leagueId: args.leagueId,
  })
  const [drafts, matchups, transactions] = await Promise.all([
    draftsPromise,
    matchupsPromise,
    transactionsPromise,
  ])

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
      transactions,
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

    /*
     * These derived rebuilds only read the now-complete history and write independent outputs.
     * Run them together so a slow graph rebuild does not hold the Hall of Fame refresh behind it.
     */
    const derived = await refreshHistoricalDerivedData({ leagueId: args.leagueId })
    summary.graph = derived.graph
    summary.hallOfFame = derived.hallOfFame

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
      transactions,
      graph: {
        refreshed: false,
      },
      hallOfFame: {
        refreshed: false,
      },
    }
  }
}
