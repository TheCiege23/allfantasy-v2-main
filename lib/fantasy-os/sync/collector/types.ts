/**
 * Fantasy OS — durable Sleeper read-model sync collector (Launch Batch 2).
 *
 * Shared types for the per-league incremental collector that runs behind the provider-neutral
 * `runSync` runner + the season-aware cron heartbeat. The collector REUSES the canonical import
 * primitives (fetch → normalize → idempotent bootstrap) — it never introduces a second sync
 * architecture, and it is read-only against Sleeper (keyless public API; no writes upstream).
 */

/** A single connected external league+season the collector keeps fresh (one row per run key). */
export interface SleeperSyncConnection {
  /** Deterministic run key `<provider>:<externalLeagueId>:<season>` — also the distributed lock key. */
  runKey: string
  provider: 'sleeper'
  /** The external (Sleeper) league id. */
  externalLeagueId: string
  season: number
  sport: string
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
export const SLEEPER_SYNC_SCOPES = ['league_state', 'teams_rosters', 'traded_picks'] as const
export type SleeperSyncScope = (typeof SLEEPER_SYNC_SCOPES)[number]

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
