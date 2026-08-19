/**
 * Canonical types for external league import mapping. Normalized output maps to AF entities
 * with source tracking for sync and history.
 */

import type { SettingsSnapshot } from '@/lib/league-contract/types'

export const IMPORT_PROVIDERS = ['sleeper', 'espn', 'yahoo', 'fantrax', 'mfl', 'fleaflicker'] as const
export type ImportProvider = (typeof IMPORT_PROVIDERS)[number]

/** Which side of a C2C import a source covers. */
export type C2CImportSide = 'pro' | 'college'

/** One source in a multi-source (e.g. C2C) import job. */
export interface C2CImportSource {
  side: C2CImportSide
  provider: ImportProvider
  sourceId: string
  /** Commissioner depth: 'all' imports full rosters; a number caps per-team spots. */
  rosterDepth: number | 'all'
}

/**
 * Multi-source import job payload. `sources` must include exactly one 'pro'
 * and one 'college' entry. Downstream normalizer runs each source through
 * the single-provider pipeline, then merges by manager email/name match.
 */
export interface MultiSourceImportJob {
  leagueId?: string
  leagueName?: string
  sources: C2CImportSource[]
}

export interface SourceTracking {
  source_provider: ImportProvider
  source_league_id: string
  source_season_id?: string | null
  import_batch_id?: string | null
  imported_at: string
}

/** Normalized league settings shape (maps to League.settings + League fields). */
export interface NormalizedLeagueSettings {
  name: string
  sport: string
  season: number | null
  leagueSize: number
  rosterSize: number | null
  scoring: string | null
  isDynasty: boolean
  /** Phase OS-C5: the provider's own real league status (e.g. Sleeper's `pre_draft`/`drafting`/
   * `in_season`/`complete`), when the provider's API supplies one. `null`/absent when the provider
   * genuinely doesn't report a status — never a fabricated default. See
   * `docs/os/SLEEPER_IMPORT_VISIBILITY_AUDIT.md` for why this field's previous absence (dropped by
   * every provider mapper despite `League.status` existing in the schema) silently hid real leagues
   * from `lib/leagues/leagueListFilter.ts`'s "no status" exclusion heuristic. */
  status?: string | null
  playoff_team_count?: number
  regular_season_length?: number
  schedule_unit?: string
  matchup_frequency?: string
  /**
   * Waiver type canonicalized to AF vocabulary ('faab' | 'rolling' | 'off').
   * Producers map from provider-native enums (Sleeper `settings.waiver_type` int → string).
   */
  waiver_type?: string
  faab_budget?: number | null
  /**
   * Tier 0 fields — populated by provider mappers when the source exposes them,
   * consumed by the canonical normalizer + persistence layer. All optional; `undefined`
   * leaves the corresponding League column at its Prisma default. Types match the
   * eventual column types (int / bool) so the persistence layer can pass them through
   * without additional coercion.
   */
  waiver_bid_min?: number
  playoff_start_week?: number
  playoff_teams?: number
  trade_deadline_week?: number
  trade_review_days?: number
  pick_trading?: boolean
  reserve_slots?: number
  taxi_slots?: number
  taxi_years?: number
  taxi_allow_vets?: boolean
  taxi_deadline_week?: number
  max_keepers?: number
  reserve_allow_cov?: boolean
  reserve_allow_sus?: boolean
  reserve_allow_out?: boolean
  reserve_allow_na?: boolean
  reserve_allow_dnr?: boolean
  reserve_allow_doubtful?: boolean
  [key: string]: unknown
}

/** Normalized roster/team (maps to Roster + LeagueTeam). */
export interface NormalizedRoster {
  source_team_id: string
  source_manager_id: string
  owner_name: string
  team_name: string
  avatar_url: string | null
  is_commissioner?: boolean
  is_co_commissioner?: boolean
  is_orphan?: boolean
  wins: number
  losses: number
  ties: number
  points_for: number
  points_against?: number
  player_ids: string[]
  starter_ids: string[]
  reserve_ids?: string[]
  taxi_ids?: string[]
  faab_remaining?: number | null
  waiver_priority?: number | null
}

/** Normalized scoring (maps to AF scoring template or settings). */
export interface NormalizedScoring {
  scoring_format: string
  rules: Array<{ stat_key: string; points_value: number; multiplier?: number }>
  raw?: Record<string, unknown>
}

/** Normalized matchup (one week). */
export interface NormalizedMatchup {
  week: number
  season: number
  matchups: Array<{
    roster_id_1: string
    roster_id_2: string
    points_1?: number
    points_2?: number
  }>
}

/** Normalized draft pick. */
export interface NormalizedDraftPick {
  round: number
  pick_no: number
  source_roster_id: string
  source_player_id: string
  season?: number | null
  source_draft_id?: string | null
  player_name?: string | null
  position?: string | null
  team?: string | null
}

/** Normalized transaction (waiver/trade). */
export interface NormalizedTransaction {
  source_transaction_id: string
  type: 'waiver' | 'trade' | 'free_agent' | 'drop'
  status: string
  created_at: string
  adds?: Record<string, string>
  drops?: Record<string, string>
  roster_ids: string[]
  draft_picks?: unknown[]
}

/**
 * Block F — normalized future traded draft pick.
 *
 * Maps to `future_draft_picks` (persistence). Field semantics preserve Sleeper's
 * ownership chain, which is the single most valuable dynasty asset outside of
 * players themselves.
 *
 * Roster IDs are provider-native strings (Sleeper "1".."12"), matching
 * `league_teams.externalId`. `previous_owner_roster_id` is optional because
 * `future_draft_picks` has no dedicated column for it (schema limitation) — the
 * persistence layer drops this field with a documented gap. Kept on the normalized
 * type so a future schema addition can wire it up without a mapper rewrite.
 */
export interface NormalizedTradedPick {
  season: number
  round: number
  original_roster_id: string
  current_owner_roster_id: string
  previous_owner_roster_id?: string
}

/** Normalized standings entry. */
export interface NormalizedStandingsEntry {
  source_team_id: string
  rank: number
  wins: number
  losses: number
  ties: number
  points_for: number
  points_against?: number
}

export type ImportCoverageState = 'full' | 'partial' | 'missing'

export interface ImportCoverageBucket {
  state: ImportCoverageState
  count?: number | null
  note?: string | null
}

export interface ImportCoverage {
  leagueSettings: ImportCoverageBucket
  currentRosters: ImportCoverageBucket
  historicalRosterSnapshots: ImportCoverageBucket
  scoringSettings: ImportCoverageBucket
  playoffSettings: ImportCoverageBucket
  currentStandings: ImportCoverageBucket
  currentSchedule: ImportCoverageBucket
  draftHistory: ImportCoverageBucket
  tradeHistory: ImportCoverageBucket
  previousSeasons: ImportCoverageBucket
  playerIdentityMap: ImportCoverageBucket
}

export type ImportCoverageKey = keyof ImportCoverage

/** Full normalized import result. */
export interface NormalizedImportResult {
  source: SourceTracking
  league: NormalizedLeagueSettings
  /**
   * When set, the importing user's team in this league (matches `NormalizedRoster.source_team_id`).
   * Used to populate `League.import_*` rank fields for non-Sleeper providers.
   */
  viewer_source_team_id?: string | null
  rosters: NormalizedRoster[]
  scoring: NormalizedScoring | null
  schedule: NormalizedMatchup[]
  draft_picks: NormalizedDraftPick[]
  /**
   * Block F — future traded draft picks (Sleeper `/league/{id}/traded_picks`).
   * Absent = provider does not expose traded picks; empty array = provider
   * exposes them but no picks are currently in a traded state.
   */
  traded_picks?: NormalizedTradedPick[]
  transactions: NormalizedTransaction[]
  standings: NormalizedStandingsEntry[]
  player_map: Record<string, { name: string; position: string; team: string }>
  identity_mappings?: ExternalIdentityMapping[]
  league_branding?: { avatar_url?: string | null; name?: string }
  previous_seasons?: Array<{ season: string; source_league_id: string }>
  coverage: ImportCoverage
  /** Fetches that failed after exhausting retries during ingestion — distinct from ImportCoverage's "no data was returned" states. */
  fetch_warnings?: ImportWarningRecord[]
  /**
   * Phase 2.4 (§5) — non-fatal source-fetch failures forwarded from the provider
   * fetch layer (e.g. Sleeper `SleeperImportPayload.fetchWarnings`). The canonical
   * normalizer folds these into `CanonicalImportBundle.warnings`, which the commit
   * layer already persists as `ImportWarning` records — so an incomplete import is
   * surfaced, never silently marked complete. Absent = every resource fetched cleanly.
   */
  fetchWarnings?: string[]
}

/** Identity mapping: source id -> AF canonical id or stable key. */
export interface ExternalIdentityMapping {
  source_provider: ImportProvider
  source_id: string
  entity_type: 'player' | 'manager' | 'team' | 'league'
  af_id?: string | null
  stable_key?: string
}

export type ImportWarningSeverity = 'info' | 'warn' | 'error'

export interface ImportWarningRecord {
  code: string
  message: string
  severity: ImportWarningSeverity
  metadata?: Record<string, unknown>
}

/**
 * Canonical AllFantasy bundle — aligns imported leagues with native `SettingsSnapshot` + `conceptRules`.
 */
/** Deterministic flags derived from normalized payload (for UI + downstream engines). */
export interface DerivedImportFlags {
  idp: boolean
  salaryCap: boolean
  devy: boolean
  c2c: boolean
  bestBall: boolean
  dynasty: boolean
  tournament: boolean
}

/** Canonical import provenance — mirrors league `platform` / `platformLeagueId` intent. */
export interface ImportMetadataBundle {
  importSource: ImportProvider
  externalLeagueId: string
  externalSeasonId?: string | null
  importBatchId?: string | null
  normalizedAt: string
  normalizationVersion: string
}

export interface CanonicalImportBundle {
  settingsSnapshot: SettingsSnapshot
  inferredConcept: string
  inferredLeagueType: string
  scoringPresetId: string
  draftType: string
  presetKey: string | null
  leagueTypeColumn: string | null
  derivedFlags: DerivedImportFlags
  importMetadata: ImportMetadataBundle
  warnings: ImportWarningRecord[]
  reviewRequired: boolean
  reviewReasons: string[]
  meta: {
    provider: ImportProvider
    sourceLeagueId: string
    confidence: Record<string, number>
  }
}
