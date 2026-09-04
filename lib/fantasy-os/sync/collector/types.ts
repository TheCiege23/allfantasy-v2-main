/**
 * Fantasy OS — durable read-model sync collector.
 *
 * Shared types for the per-league incremental collector that runs behind the provider-neutral
 * `runSync` runner + the season-aware cron heartbeat. The collector REUSES the canonical import
 * primitives (fetch → normalize → idempotent bootstrap) — it never introduces a second sync
 * architecture, and it is read-only against every provider (no writes upstream, ever).
 *
 * ── WHY THIS IS NO LONGER SLEEPER-ONLY ──────────────────────────────────────────────
 *
 * It was, and the consequence was that AllFantasy kept ONE platform fresh. ESPN, Yahoo and
 * Fantrax got a weekly-matchup parity pass and nothing else; MFL and Fleaflicker got nothing
 * at all. A league imported from any of the five was a snapshot that started ageing the
 * moment it landed, while `/api/leagues/import/resync` said so in its own words: "Non-Sleeper
 * providers have no durable read-model refresh step."
 *
 * The generalisation was cheaper than it looked, because almost nothing here was actually
 * Sleeper-shaped. The scope fetcher already operates on `NormalizedImportResult`; the apply
 * layer already takes `(leagueId, scope, normalized)`; the bootstrap already branches on
 * `normalized.source.source_provider`; and `resolveCadence` already accepts and validates all
 * six providers. What was Sleeper-specific was the enumeration filter, the hardcoded provider
 * in the fetch, and the names.
 *
 * ⚠ THE ONE GENUINELY NEW PROBLEM IS CREDENTIALS. Sleeper and Fleaflicker are keyless public
 * reads, so any caller can refresh any league. ESPN, Yahoo and MFL need a stored credential
 * belonging to a specific user — and a league can be mirrored by several importing users, only
 * some of whom still have working ones. `normalizedLoader.ts` is that problem and nothing else.
 */

import type { ImportProvider } from '@/lib/league-import/types'

/** A single connected external league+season the collector keeps fresh (one row per run key). */
export interface LeagueSyncConnection {
  /** Deterministic run key `<provider>:<externalLeagueId>:<season>` — also the distributed lock key. */
  runKey: string
  provider: ImportProvider
  /** The external league id, as the provider spells it. Matches `League.platformLeagueId`. */
  externalLeagueId: string
  season: number
  sport: string
}

/**
 * @deprecated Use `LeagueSyncConnection`. Kept as an alias so the Sleeper-named call sites and
 * their tests keep compiling — renaming them is churn with no behavioural payoff, and the
 * lesson this repo already paid for (see the FantasyCalc adapter split) is to add alongside
 * rather than repoint every consumer.
 */
export type SleeperSyncConnection = LeagueSyncConnection

/**
 * Providers the durable collector can refresh end to end.
 *
 * ⚠ THIS IS NOT `IMPORT_PROVIDERS`. A provider belongs here only when a full
 * `runImportedLeagueNormalizationPipeline` refresh is meaningful for it — which is a narrower
 * question than "can we import it once". Yahoo is importable-in-principle but shipped off
 * (`available: false`), and including it would enumerate leagues that cannot exist yet; it
 * costs nothing to leave in, because enumeration simply finds no rows.
 */
export const SYNCABLE_PROVIDERS = [
  'sleeper',
  'espn',
  'yahoo',
  'mfl',
  'fantrax',
  'fleaflicker',
] as const satisfies readonly ImportProvider[]

/**
 * Providers whose refresh needs a stored per-user credential.
 *
 * ⚠ FANTRAX IS DELIBERATELY ABSENT. Its `fxea` API is unauthenticated — a league id is enough,
 * and the Secret ID only ever identifies WHICH TEAM is the caller's, which a refresh does not
 * need. Listing it here would make every Fantrax league skip for want of a credential it never
 * required. Same reasoning puts Sleeper and Fleaflicker outside the set.
 */
export const CREDENTIALED_PROVIDERS = new Set<ImportProvider>(['espn', 'yahoo', 'mfl'])

export function providerNeedsCredential(provider: ImportProvider): boolean {
  return CREDENTIALED_PROVIDERS.has(provider)
}

/**
 * Providers whose refresh must be attributed to an importing USER — a different question from
 * whether it needs a stored credential, and conflating the two broke Fantrax entirely.
 *
 * 🛑 FANTRAX NEEDS A USER AND NO CREDENTIAL, AND ONLY THIS SET CAN SAY SO. Its `fxea` reads are
 * unauthenticated, so it is correctly absent from `CREDENTIALED_PROVIDERS` above — but the import
 * pipeline reads a STORED SNAPSHOT (`FantraxLeague`), and that row carries `appUserId` behind a
 * deliberately fail-closed ownership gate in `FantraxLeagueFetchService`:
 *
 *     if (!leagueRecord || leagueRecord.appUserId !== userId) throw ...not found
 *
 * `fetchNormalizedForConnection` used `providerNeedsCredential` to decide whether to pass a
 * `userId` at all, so Fantrax took the no-user path and the pipeline refused it with
 * "Sign in before importing from Fantrax." on EVERY heartbeat. Measured in production
 * 2026-09-04: the one connected Fantrax league sat at syncStatus `failed`, all three scopes
 * incomplete, `lastError` exactly that string — and because the keyless branch cannot classify
 * an `UNAUTHORIZED` result as "try the next user", it threw as a retryable provider failure and
 * inflated `consecutiveFailures` against a provider that was answering perfectly.
 *
 * Sleeper and Fleaflicker stay out: their reads are public AND their refresh is unowned, so a
 * league whose only importing user was deleted must still refresh.
 */
export const USER_SCOPED_PROVIDERS = new Set<ImportProvider>([
  ...CREDENTIALED_PROVIDERS,
  'fantrax',
])

export function providerNeedsUser(provider: ImportProvider): boolean {
  return USER_SCOPED_PROVIDERS.has(provider)
}

/**
 * The mutable "current state" scopes this batch synchronizes, mapped to real canonical persistence.
 * Immutable historical scopes (completed drafts, prior-season snapshots) are owned by the existing
 * `SleeperHistorical*` backfill services and are checkpoint-skipped here — never refetched. Scopes with
 * no canonical destination table (e.g. transactions) are intentionally NOT synced (no fabrication).
 *
 * Mapping to `runner.INCREMENTAL_SCOPES`:
 *  - `league_state`      ↔ league_state (League row + settings + current LeagueSeason)
 *  - `traded_picks`      ↔ changed_traded_picks (future_draft_picks)
 *  - `teams_rosters`     ↔ rosters + recent_matchups + standings (LeagueTeam/Roster/TeamPerformance)
 *
 * 🛑 THE ORDER IS LOAD-BEARING, AND IT IS ABOUT THE RUN BUDGET — NOT DEPENDENCIES.
 *
 * `runner.ts` checks the elapsed clock BEFORE each scope and never aborts one mid-flight. So a
 * scope that starts before the deadline always finishes, and the scopes still queued behind an
 * overrun are the ones dropped. `traded_picks` used to be LAST, which made it the permanent
 * casualty: measured 2026-09-04, 70 of 1284 fantasy-os-sleeper-sync runs in 24h crossed the 240s
 * budget, and EVERY `partial` in production read `incompleteScopes: ["traded_picks"]`. Dynasty
 * pick ownership was the one thing that went stale, systematically, on every slow league.
 *
 * Moving it ahead of `teams_rosters` is not a trade of one casualty for another, because of the
 * no-mid-scope-abort rule above. With `teams_rosters` (the expensive scope) last, it still STARTS
 * before the deadline in the common overrun case and runs to completion:
 *
 *   before:  league_state 5s -> teams_rosters 250s -> traded_picks checked at 255s  DROPPED
 *   after:   league_state 5s -> traded_picks 10s   -> teams_rosters starts at 15s   BOTH COMPLETE
 *
 * The only case that still drops a scope is the scopes ahead of it exhausting 240s on their own,
 * which now takes `league_state` + `traded_picks` — both cheap — rather than `teams_rosters` alone.
 *
 * ⚠ SAFE ONLY BECAUSE THESE SCOPES ARE INDEPENDENT, WHICH WAS CHECKED RATHER THAN ASSUMED.
 * `applyTradedPicks` takes `leagueId` and the normalized picks and reads no team or roster row;
 * `persistTradedPicks` writes `originalRosterId`/`currentOwnerId` straight from the payload. On
 * `FutureDraftPick` those are plain `String @db.VarChar(64)` with NO foreign key to `LeagueTeam` —
 * the model's only relation is to `League`, which already exists on a refresh. So `traded_picks`
 * does not need `teams_rosters` to have run. If a future scope DOES gain a real dependency, this
 * ordering stops being free and the comment above stops being true.
 *
 * `IMPORT_SCOPES` in lib/decision-os/import/assertions.ts is a SEPARATE list pinned by its own
 * test; it is a freshness-reporting coverage set, not an execution order, and is deliberately
 * left alone.
 */
export const LEAGUE_SYNC_SCOPES = ['league_state', 'traded_picks', 'teams_rosters'] as const
export type LeagueSyncScope = (typeof LEAGUE_SYNC_SCOPES)[number]

/**
 * @deprecated Use `LEAGUE_SYNC_SCOPES` / `LeagueSyncScope`. The scope set was never
 * Sleeper-specific — every scope maps to a canonical table any provider can fill — so this is
 * purely a rename, kept aliased for the existing call sites.
 *
 * ⚠ `traded_picks` IS EMITTED BY SLEEPER ALONE TODAY, and that is a provider coverage gap
 * rather than a scope-set problem: the scope applies an empty list for the others, which is
 * correct and idempotent. It starts doing real work the moment another adapter emits them.
 */
export const SLEEPER_SYNC_SCOPES = LEAGUE_SYNC_SCOPES
export type SleeperSyncScope = LeagueSyncScope

/** Result of applying one scope's fresh data to one canonical League row. */
export interface ApplyScopeResult {
  /** Records newly written or changed by this apply. */
  imported: number
  /** Records that already matched the fresh data (no-op — proves idempotency). */
  unchanged: number
  /** Records the provider returned but that could not be persisted (malformed). */
  rejected: number
  /** Canonical rows reconciled away because a *complete authoritative* response no longer contained them. */
  removed: number
  /** Non-fatal notes (e.g. empty response protection engaged). */
  notes: string[]
}

export function emptyApplyResult(): ApplyScopeResult {
  return { imported: 0, unchanged: 0, rejected: 0, removed: 0, notes: [] }
}

export function mergeApplyResults(a: ApplyScopeResult, b: ApplyScopeResult): ApplyScopeResult {
  return {
    imported: a.imported + b.imported,
    unchanged: a.unchanged + b.unchanged,
    rejected: a.rejected + b.rejected,
    removed: a.removed + b.removed,
    notes: [...a.notes, ...b.notes],
  }
}
