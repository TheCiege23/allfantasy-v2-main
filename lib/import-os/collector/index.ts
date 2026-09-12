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
// Fleaflicker weekly-matchup parity. Separate for the same reason Fantrax is —
// the API is public and keyless, so the credential-candidate machinery is dead
// code — and sharing `applySchedule` for the same reason too.
//
// 🛑 IT REFUSES A PAYLOAD WHOSE SEASON IS NOT THE ONE REQUESTED, and that is not
// defensive padding: Fleaflicker silently CLAMPS a season past the league's last
// and returns that season's completed games under HTTP 200. Without the refusal
// a weekly sync of any dormant league persists years-old finals as this week's
// results. See fleaflickerMatchupParity.ts's header and contracts/fleaflicker.
export {
  runFleaflickerMatchupParity,
  enumerateFleaflickerMatchupConnections,
  type FleaflickerMatchupParityResult,
  type FleaflickerMatchupLeagueResult,
} from './fleaflickerMatchupParity'

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
 * ✅ AND AS OF 2026-09-12 THE OTHER TWO ARE SETTLED TOO, SO THE MFL WRITER IS NO LONGER BLOCKED.
 * This paragraph said "THIS DOES NOT MEAN BUILD THE MFL WRITER NOW" and listed three costly
 * decisions. Two have since been closed — one by a migration that was applied the same afternoon
 * this was written, and one by that migration making it moot:
 *   - unpad `externalId` at MFL import → MOOT. It was only ever a way to survive an Int column.
 *     With `rosterId` text, a zero-padded id round-trips verbatim and team IDENTITY never has to
 *     change, which is what made this option expensive. Do NOT do it.
 *   - pad in the readers → RESOLVED 2026-09-03, see above.
 *   - a text rosterId column → ✅ APPLIED TO PRODUCTION 2026-09-03, hours after this note called
 *     it "PREPARED, NOT APPLIED". Verified 2026-09-12 against the live database rather than
 *     against this file or the migration's own header: `information_schema` reports
 *     `WeeklyMatchup.rosterId data_type=text, nullable=NO`, 49,180 rows, all four indexes
 *     present including `WeeklyMatchup_leagueId_seasonYear_week_rosterId_key`.
 *     `schema.prisma` already declares `rosterId String` and `applySchedule` already takes one.
 *
 * 🛑 THIS COMMENT WAS THE ONLY REMAINING BLOCKER, WHICH IS WORTH SAYING PLAINLY. Every technical
 * prerequisite had been satisfied for nine days; what persisted was a file telling each new
 * session the work was gated on a decision that had already been made. That is the "stale absence
 * claim" shape this repo records elsewhere — and it is more expensive than a wrong fact, because
 * it is a wrong fact that stops people looking.
 *
 * ✅ FLEAFLICKER IS NO LONGER ABSENT — `fleaflickerMatchupParity` shipped 2026-09-11. This
 * paragraph said it "has no matchup source at all" and that the game/matchup row shape "is still
 * not captured — see its GAPS.md G-01". Both were true when written and are false now:
 * `fetchFleaflickerScoreboard` exists, and G-01 is RESOLVED against two committed fixtures
 * (a played regular-season week and a championship week).
 *
 * ⚠ TWO THINGS THAT CAPTURE FOUND ARE WORTH KNOWING BEFORE WRITING ANY PROVIDER COLLECTOR:
 * Fleaflicker OMITS a false boolean rather than sending it, so `isFinalScore === false` is never
 * true and an unplayed game must be detected by ABSENCE; and a `season` past a league's last is
 * silently CLAMPED, returning that last season's completed games under HTTP 200 — so a sync that
 * trusts the season it asked for will persist years-old finals as this week's results. See
 * `contracts/fleaflicker/ENDPOINTS.yaml` and that collector's header.
 */
