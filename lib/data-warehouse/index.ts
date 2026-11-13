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
  getPlayerFantasyPointsByPeriod,
  getTeamPointsByPeriodForLeague,
  getStandingsBySeasonForLeague,
  getTransactionVolumeByLeague,
  getLeagueWarehouseSummaryForAI,
  type LeagueHistorySummary as WarehouseLeagueHistorySummary,
} from './WarehouseQueryService'
export {
  isSportSupported,
} from './SportWarehouseResolver'
export {
  type MaterializedPlayerTrend,
  type MaterializedLeagueSummary,
} from './AnalyticsFactMaterializer'
export {
  runGameStatsIngestionPipeline,
  runMatchupScoringPipeline,
  runRosterSnapshotPipeline,
  runStandingsIngestionPipeline,
  runDraftIngestionPipeline,
  runTransactionIngestionPipeline,
} from './pipelines'
export {
  type BackfillOptions,
  type BackfillResult,
} from './backfill'
export {
  buildWarehouseStoreBundleResult,
} from './FantasyDataWarehouse'
export {
  buildWarehouseOverview,
  buildWarehouseActivityFeed,
  buildWarehouseSimulationAnalytics,
} from './AnalyticsQueryLayer'
