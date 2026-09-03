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
// Fantrax weekly-matchup parity. Separate collector, same heartbeat: the fxea
// API is unauthenticated, so the credential-candidate machinery above is dead
// code for it — but it shares `applySchedule`, which is the part that defines
// what a WeeklyMatchup row means and must never fork.
export {
  runFantraxMatchupParity,
  enumerateFantraxMatchupConnections,
  type FantraxMatchupParityResult,
  type FantraxMatchupLeagueResult,
} from './fantraxMatchupParity'

/*
 * 🛑 MFL HAS NO WEEKLY-MATCHUP WRITER ON PURPOSE, AND IT IS NOT "NOBODY GOT ROUND TO IT".
 * Everything needed to build one already exists — `getMflAuthForUser`, the `TYPE=schedule`
 * fetch, `parseMflSchedule` (which returns weeks with `franchiseId1/2` and `points1/2`), and
 * `applySchedule` itself. It would be a short collector. It would also write rows that NOTHING
 * CAN READ, which is worse than the empty board it replaces.
 *
 * ⚠ THE ID SPACES DO NOT MEET, measured rather than assumed:
 *
 *   `WeeklyMatchup.rosterId`            Int
 *   MFL franchise id                    "0001" — zero-padded, and this repo's own fixtures
 *                                       use exactly that (`franchiseId: '0001'`)
 *   `MflAdapter`                        `source_team_id: team.franchiseId`, verbatim, and
 *                                       nothing anywhere pads or strips
 *   so `league_teams.externalId`        "0001"
 *   and every reader joins              `teamBy = new Map(teams.map(t => [t.externalId, t]))`
 *                                       then `teamBy.get(String(row.rosterId))`
 *                                       — lib/core-app/leagueScoreboard.ts, allPlay.ts,
 *                                         dash3aPanels.ts, leagueHome.ts all do this
 *
 * `Number('0001')` is 1 and `String(1)` is "1", which never matches "0001". The write would
 * succeed, the row count would look right, and the scoreboard would render an unknown manager.
 * That is the exact shape CLAUDE.md records for `ingestCFBDStats`: pointing a surface at data
 * nothing can resolve fails silently and looks correct.
 *
 * Sleeper, ESPN, Yahoo and Fantrax are all fine because their team ids are already plain
 * integers — "1", not "0001" — so the numeric round-trip is lossless for them and only for them.
 *
 * ⚠ AND THE THREE OBVIOUS FIXES ALL COST MORE THAN THEY LOOK:
 *   - unpad `externalId` at MFL import → changes team IDENTITY for existing MFL leagues, and
 *     `traded_picks` joins on that same identity (see MflAdapter's own note about it)
 *   - pad in the readers → edits a join shared by four providers that currently work
 *   - a text rosterId column → a migration plus every reader
 * Each is a real decision about one identity for a league's teams, not a collector task. It
 * belongs with that work, not smuggled in beside a sync writer.
 *
 * FLEAFLICKER IS ABSENT FOR A DIFFERENT AND SIMPLER REASON: it has no matchup source at all.
 * `FleaflickerLeagueFetchService` fetches `FetchLeagueStandings` and `FetchLeagueRosters` and
 * nothing else, so there is no schedule to write. Adding one means adding a provider endpoint,
 * and Fleaflicker has no committed contract in `contracts/` to read the shape from — so it is
 * a probe-and-capture job, not a wiring job.
 */
