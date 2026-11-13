/**
 * Fantasy Data Warehouse — central export.
 * Layers: Raw (ingested APIs) → Normalized (StatNormalizationService) → Analytics (AnalyticsFactMaterializer).
 */

export * from './types'
export { normalizeStatPayload, type NormalizedStatMap } from './StatNormalizationService'
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
  type GameStatsPipelineResult,
  type MatchupScoringPipelineResult,
  type RosterSnapshotPipelineResult,
  type StandingsPipelineResult,
  type DraftPipelineResult,
  type TransactionPipelineResult,
} from './pipelines'
export {
  type BackfillOptions,
  type BackfillResult,
  type BackfillPipeline,
} from './backfill'
export {
  FantasyDataWarehouse,
  buildWarehouseStoreBundleResult,
  storePlayerStats,
  storePlayerStatsBatch,
  storeTeamGameStats,
  storeTeamGameStatsBatch,
  storeRosterSnapshot,
  storeRosterSnapshotsBatch,
  storeLeagueResults,
  storeLeagueResultMatchup,
  storeLeagueResultStanding,
  storeDraftLog,
  storeDraftLogsBatch,
  storeTradeLog,
  storeTradeLogsBatch,
  storeMatchupSimulationOutput,
  storeSeasonSimulationOutput,
  storeSimulationOutputs,
  storeWarehouseBundle,
  type StorePlayerStatsInput,
  type StoreTeamGameStatsInput,
  type StoreRosterSnapshotInput,
  type StoreLeagueResultMatchupInput,
  type StoreLeagueResultStandingInput,
  type StoreDraftLogInput,
  type StoreTradeLogInput,
  type StoreMatchupSimulationInput,
  type StoreSeasonSimulationInput,
  type StoreWarehouseBundleInput,
  type WarehouseStoreIds,
  type WarehouseStoreBundleResult,
} from './FantasyDataWarehouse'
export {
  AnalyticsQueryLayer,
  buildWarehouseOverview,
  buildWarehouseActivityFeed,
  buildWarehouseSimulationAnalytics,
  queryPlayerStats,
  queryPlayerFantasyPointsByPeriod,
  queryLeagueResults,
  queryStandingsBySeason,
  queryTeamPointsByPeriod,
  queryDraftLogs,
  queryTradeLogs,
  queryTransactionVolume,
  querySimulationOutputs,
  querySimulationAnalytics,
  queryRosterSnapshots,
  getLeagueSummary,
  getLeagueSummaryForAI,
  queryWarehouseOverview,
  queryWarehouseActivityFeed,
  queryCentralAnalyticsSnapshot,
  type QueryPlayerStatsOptions,
  type QueryLeagueResultsOptions,
  type QueryDraftLogsOptions,
  type QueryTradeLogsOptions,
  type QuerySimulationOutputsOptions,
  type QuerySimulationAnalyticsOptions,
  type QueryWarehouseOverviewOptions,
  type QueryWarehouseActivityFeedOptions,
  type QueryCentralAnalyticsSnapshotOptions,
} from './AnalyticsQueryLayer'
