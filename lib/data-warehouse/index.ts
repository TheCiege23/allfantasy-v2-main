/**
 * Fantasy Data Warehouse — central export.
 * Layers: Raw (ingested APIs) → Normalized (StatNormalizationService) → Analytics (AnalyticsFactMaterializer).
 */

export * from './types'
export { normalizeStatPayload } from './StatNormalizationService'
export { WarehouseIngestionService } from './WarehouseIngestionService'
export {
  generateGameFactsFromExistingStats,
  generateMatchupFactsFromLeague,
  generateStandingFactsFromLeague,
  generateRosterSnapshotsFromLeague,
  generateDraftFactsFromLeague,
  generateDraftFactsFromMockDraft,
  generateTransactionFactsFromLeague,
} from './HistoricalFactGenerator'
export {
  getLeagueHistorySummary,
  getMatchupHistory,
  getStandingsHistory,
  getRosterSnapshotsForTeam,
  getPlayerGameFactsForPlayer,
  getDraftHistoryForLeague,
  getTransactionHistoryForLeague,
  type LeagueHistorySummary,
} from './LeagueHistoryAggregator'
export {
  getLeagueWarehouseSummaryForAI,
  type LeagueHistorySummary as WarehouseLeagueHistorySummary,
} from './WarehouseQueryService'
export {
  buildWarehouseStoreBundleResult,
} from './FantasyDataWarehouse'
export {
  buildWarehouseOverview,
  buildWarehouseActivityFeed,
  buildWarehouseSimulationAnalytics,
} from './AnalyticsQueryLayer'
