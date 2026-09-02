/**
 * Fantasy OS — durable read-model sync collector. Public surface.
 *
 * The live incremental collector that runs behind the provider-neutral `runSync` runner and the
 * season-aware cron heartbeat. Reuses the canonical import fetch/normalize/persist primitives; never
 * writes upstream to any provider; never creates a league (only refreshes existing canonical rows).
 */
export {
  runDueLeagues,
  runDueSleeperLeagues,
  type RunDueResult,
  type RunDueInput,
} from './runDueSleeperLeagues'
export {
  syncConnectedLeague,
  syncConnectedSleeperLeague,
  type SyncConnectedResult,
  type SyncConnectedDeps,
} from './syncConnectedSleeperLeague'
export {
  enumerateConnectedLeagues,
  enumerateConnectedSleeperLeagues,
  resolveLeagueIdsForConnection,
  buildRunKey,
} from './enumerate'
/* The credential problem the generalisation created, and nothing else. */
export {
  fetchNormalizedForConnection,
  resolveCredentialCandidates,
  resolveStoredCredentialUserIds,
  SyncCredentialsUnavailableError,
  SyncLeagueGoneError,
  MAX_USER_CANDIDATES,
} from './normalizedLoader'
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
  LEAGUE_SYNC_SCOPES,
  SLEEPER_SYNC_SCOPES,
  SYNCABLE_PROVIDERS,
  CREDENTIALED_PROVIDERS,
  providerNeedsCredential,
  type LeagueSyncScope,
  type LeagueSyncConnection,
  type SleeperSyncScope,
  type SleeperSyncConnection,
  type ApplyScopeResult,
} from './types'
// ESPN/Yahoo weekly-matchup parity (rides the same cron heartbeat; see externalMatchupParity.ts).
export {
  runExternalMatchupParity,
  enumerateExternalMatchupConnections,
  type ExternalMatchupParityResult,
  type ExternalMatchupLeagueResult,
} from './externalMatchupParity'
