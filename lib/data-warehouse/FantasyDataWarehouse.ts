/**
 * FantasyDataWarehouse (PROMPT 138) central analytics storage facade.
 * Stores player stats, league results, draft logs, trade logs, and simulation outputs.
 */

import type { WarehouseDatasetCounts } from './types'

interface WarehouseStoreIds {
  playerStats: string[]
  teamGameStats: string[]
  rosterSnapshots: string[]
  matchupResults: string[]
  standings: string[]
  draftLogs: string[]
  tradeLogs: string[]
  matchupSimulations: string[]
  seasonSimulations: string[]
}

interface WarehouseStoreBundleResult {
  counts: WarehouseDatasetCounts
  totalRecords: number
  ids: WarehouseStoreIds
}

export function buildWarehouseStoreBundleResult(ids: WarehouseStoreIds): WarehouseStoreBundleResult {
  const counts: WarehouseDatasetCounts = {
    playerStats: ids.playerStats.length,
    teamStats: ids.teamGameStats.length,
    rosterSnapshots: ids.rosterSnapshots.length,
    leagueMatchups: ids.matchupResults.length,
    seasonStandings: ids.standings.length,
    draftLogs: ids.draftLogs.length,
    tradeLogs: ids.tradeLogs.length,
    matchupSimulations: ids.matchupSimulations.length,
    seasonSimulations: ids.seasonSimulations.length,
  }
  const totalRecords = Object.values(counts).reduce((sum, count) => sum + count, 0)

  return {
    counts,
    totalRecords,
    ids,
  }
}

