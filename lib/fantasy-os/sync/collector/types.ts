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
 * The mutable "current state" scopes this batch synchronizes, mapped to real canonical persistence.
 * Immutable historical scopes (completed drafts, prior-season snapshots) are owned by the existing
 * `SleeperHistorical*` backfill services and are checkpoint-skipped here — never refetched. Scopes with
 * no canonical destination table (e.g. transactions) are intentionally NOT synced (no fabrication).
 *
 * Mapping to `runner.INCREMENTAL_SCOPES`:
 *  - `league_state`      ↔ league_state (League row + settings + current LeagueSeason)
 *  - `teams_rosters`     ↔ rosters + recent_matchups + standings (LeagueTeam/Roster/TeamPerformance)
 *  - `traded_picks`      ↔ changed_traded_picks (future_draft_picks)
 */
export const LEAGUE_SYNC_SCOPES = ['league_state', 'teams_rosters', 'traded_picks'] as const
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
