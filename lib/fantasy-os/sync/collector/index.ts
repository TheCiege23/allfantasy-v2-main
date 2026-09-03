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
 * 🛑 MFL STILL HAS NO WEEKLY-MATCHUP WRITER, AND IT IS STILL NOT "NOBODY GOT ROUND TO IT" —
 * but one of the three reasons below is now fixed. Read to the "RESOLVED 2026-09-03" note
 * before assuming this paragraph describes the current state end to end.
 *
 * Everything needed to build a writer already exists — `getMflAuthForUser`, the `TYPE=schedule`
 * fetch, `parseMflSchedule` (which returns weeks with `franchiseId1/2` and `points1/2`), and
 * `applySchedule` itself. It would be a short collector. It would ALSO have written rows that
 * NOTHING COULD READ, which is worse than the empty board it replaces — that was true, and is
 * why nobody built it.
 *
 * ⚠ THE ID SPACES STILL DO NOT MEET ON THE WRITE SIDE, measured rather than assumed:
 *
 *   `WeeklyMatchup.rosterId`            Int
 *   MFL franchise id                    "0001" — zero-padded, and this repo's own fixtures
 *                                       use exactly that (`franchiseId: '0001'`)
 *   `MflAdapter`                        `source_team_id: team.franchiseId`, verbatim, and
 *                                       nothing anywhere pads or strips
 *   so `league_teams.externalId`        "0001"
 *
 * `Number('0001')` is 1 and `String(1)` is "1", which never matches "0001" under a NAIVE join.
 * Before 2026-09-03 a write would have succeeded, the row count would have looked right, and the
 * scoreboard would have rendered an unknown manager. That is the exact shape CLAUDE.md records
 * for `ingestCFBDStats`: pointing a surface at data nothing can resolve fails silently and looks
 * correct.
 *
 * ✅ RESOLVED 2026-09-03 — THE READ SIDE. Every reader below now goes through
 * `lib/core-app/rosterIdMatch.ts` (`buildRosterIdMap`/`rosterIdsMatch`) instead of a raw
 * `new Map(teams.map(t => [t.externalId, t]))` + `teamBy.get(String(row.rosterId))`, in
 * lib/core-app/leagueScoreboard.ts, allPlay.ts, dash3aPanels.ts, and leagueHome.ts. That helper
 * registers a numeric-normalized alias ("1") alongside the raw externalId ("0001") whenever the
 * externalId is all-digits, so `String(row.rosterId)` finds it either way — and is a no-op for
 * every other provider's already-unpadded ids, so this is additive, not a behaviour change for
 * Sleeper, ESPN, Yahoo or Fantrax, which are all fine because their team ids are already plain
 * integers — "1", not "0001".
 *
 * 🛑 THIS DOES NOT MEAN "BUILD THE MFL WRITER NOW." It removes exactly one of the three costly
 * decisions below — the readers are demonstrated safe to receive a zero-padded id — but MFL
 * still has no writer, and the choice of what a NEW writer should actually store is still open:
 *   - unpad `externalId` at MFL import → changes team IDENTITY for existing MFL leagues, and
 *     `traded_picks` joins on that same identity (see MflAdapter's own note about it) — STILL OPEN
 *   - pad in the readers → RESOLVED 2026-09-03, see above
 *   - a text rosterId column → a migration plus every reader — STILL OPEN, and a migration is not
 *     a decision this collector (or any single session) makes unilaterally
 * The remaining two are a real decision about one identity for a league's teams, not a collector
 * task. They belong with that work, not smuggled in beside a sync writer.
 *
 * FLEAFLICKER IS ABSENT FOR A DIFFERENT AND SIMPLER REASON: it has no matchup source at all.
 * `FleaflickerLeagueFetchService` fetches `FetchLeagueStandings` and `FetchLeagueRosters` and
 * nothing else, so there is no schedule to write. Adding one means adding a provider endpoint;
 * `contracts/fleaflicker/` now has a committed contract with real fixtures (probed 2026-09-03),
 * but the game/matchup row shape itself is still not captured — see its GAPS.md G-01 — so this
 * is still a probe-and-capture job, not a wiring job, just further along than it was.
 */
