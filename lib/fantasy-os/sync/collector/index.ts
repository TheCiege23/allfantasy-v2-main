/**
 * Fantasy OS — durable Sleeper read-model sync collector (Launch Batch 2). Public surface.
 *
 * The live incremental collector that runs behind the provider-neutral `runSync` runner and the
 * season-aware cron heartbeat. Reuses the canonical import fetch/normalize/persist primitives; never
 * writes upstream to Sleeper; never creates a league (only refreshes existing canonical rows).
 */
export { runDueSleeperLeagues, type RunDueResult } from './runDueSleeperLeagues'
export { syncConnectedSleeperLeague, type SyncConnectedResult, type SyncConnectedDeps } from './syncConnectedSleeperLeague'
export {
  enumerateConnectedSleeperLeagues,
  resolveLeagueIdsForConnection,
  buildRunKey,
} from './enumerate'
export {
  manualRefreshConnectedSleeperLeague,
  getConnectedLeagueSyncState,
  type ManualRefreshResult,
  type SyncStateInspection,
} from './manualRefresh'
export { applySleeperScopeToLeague, type ApplyLeagueSyncOptions } from './applySleeperLeagueSync'
export { createPrismaSleeperSyncStore, type PrismaSleeperSyncStore } from './prismaSyncStore'
export { createSleeperScopeFetcher } from './sleeperScopeFetcher'
export { createAutomationSyncLock } from './automationSyncLock'
export {
  SLEEPER_SYNC_SCOPES,
  type SleeperSyncScope,
  type SleeperSyncConnection,
  type ApplyScopeResult,
} from './types'
