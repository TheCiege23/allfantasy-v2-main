import { buildLeagueGraph } from '@/lib/league-intelligence-graph'
import { rebuildHallOfFame } from '@/lib/rankings-engine/hall-of-fame'

export interface HistoricalDerivedRefreshSummary {
  graph: {
    refreshed: boolean
    nodeCount?: number
    edgeCount?: number
    snapshotId?: string
    error?: string
  }
  hallOfFame: {
    refreshed: boolean
    count?: number
    error?: string
  }
}

interface HistoricalDerivedRefreshDependencies {
  buildGraph: typeof buildLeagueGraph
  rebuildHallOfFame: typeof rebuildHallOfFame
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Unknown error'
}

/**
 * Refresh the two history-derived league views after a provider import.
 * Both jobs read completed history and write independent models, so serial
 * execution only lengthens the import. allSettled preserves either result
 * when the other derived view fails.
 */
export async function refreshHistoricalDerivedData(
  args: { leagueId: string },
  dependencies: HistoricalDerivedRefreshDependencies = {
    buildGraph: buildLeagueGraph,
    rebuildHallOfFame,
  },
): Promise<HistoricalDerivedRefreshSummary> {
  const [graphResult, hallOfFameResult] = await Promise.allSettled([
    dependencies.buildGraph({
      leagueId: args.leagueId,
      season: null,
      includeTrades: true,
      includeRivalries: true,
    }),
    dependencies.rebuildHallOfFame({ leagueId: args.leagueId }),
  ])

  const graph: HistoricalDerivedRefreshSummary['graph'] = graphResult.status === 'fulfilled'
    ? {
        refreshed: true,
        nodeCount: graphResult.value.nodeCount,
        edgeCount: graphResult.value.edgeCount,
        snapshotId: graphResult.value.snapshotId,
      }
    : {
        refreshed: false,
        error: getErrorMessage(graphResult.reason),
      }

  const hallOfFame: HistoricalDerivedRefreshSummary['hallOfFame'] = hallOfFameResult.status === 'fulfilled'
    ? {
        refreshed: true,
        count: hallOfFameResult.value.count,
      }
    : {
        refreshed: false,
        error: getErrorMessage(hallOfFameResult.reason),
      }

  return { graph, hallOfFame }
}
