/**
 * Sleeper API / legacy transfer raw shapes used by the Sleeper adapter.
 */

export interface SleeperLeagueRaw {
  league_id: string
  name: string
  sport: string
  season: string
  season_type?: string
  commissioner_id?: string
  total_rosters: number
  status?: string
  metadata?: {
    co_commissioners?: string[] | null
  }
  settings?: {
    type?: number
    playoff_teams?: number
    num_teams?: number
  }
  scoring_settings?: Record<string, number>
  roster_positions?: string[]
  avatar?: string
  previous_league_id?: string
}

export interface SleeperUserRaw {
  user_id: string
  username: string
  display_name?: string
  avatar?: string
  is_owner?: boolean
  metadata?: {
    team_name?: string
    is_commissioner?: string | boolean
    co_owner?: string | boolean
  } | null
}

export interface SleeperRosterRaw {
  roster_id: number
  owner_id?: string | null
  players?: string[]
  starters?: string[]
  reserve?: string[]
  taxi?: string[]
  settings?: {
    wins?: number
    losses?: number
    ties?: number
    fpts?: number
    fpts_decimal?: number
    waiver_budget_used?: number
    waiver_position?: number
  }
}

export interface SleeperMatchupRaw {
  roster_id: number
  matchup_id: number
  points: number
}

export interface SleeperTransactionRaw {
  transaction_id: string
  type: string
  status: string
  created: number
  adds?: Record<string, string>
  drops?: Record<string, string>
  draft_picks?: unknown[]
  roster_ids?: number[]
}

export interface SleeperDraftPickRaw {
  round: number
  roster_id: number
  player_id: string
  picked_by?: string
  pick_no: number
  season?: string
  draft_id?: string
  metadata?: {
    first_name?: string
    last_name?: string
    position?: string
    team?: string
  }
}

/**
 * Block F — Sleeper `/v1/league/{leagueId}/traded_picks` row shape.
 *
 * Sleeper's field semantics (verified against real leagues during the fidelity audit):
 *   - `roster_id`: the ORIGINAL owner's roster_id (identity of the "home" team's pick).
 *   - `owner_id`: the CURRENT owner's roster_id (the roster that holds the pick right now).
 *   - `previous_owner_id`: the most recent prior owner before the current one.
 *
 * These are all Sleeper integer roster IDs (1..total_rosters), NOT user IDs.
 * `season` is a string like "2026".
 */
export interface SleeperTradedPickRaw {
  round: number
  season: string
  roster_id: number
  owner_id: number
  previous_owner_id?: number
}

/** Payload passed to Sleeper adapter (assembled from API or legacy transfer). */
export interface SleeperImportPayload {
  league: SleeperLeagueRaw
  users?: SleeperUserRaw[]
  rosters?: SleeperRosterRaw[]
  matchupsByWeek?: { week: number; matchups: SleeperMatchupRaw[] }[]
  transactions?: SleeperTransactionRaw[]
  draftPicks?: SleeperDraftPickRaw[]
  /** Block F — future traded draft picks (Sleeper `/league/{id}/traded_picks`). */
  tradedPicks?: SleeperTradedPickRaw[]
  playerMap?: Record<string, { name: string; position: string; team: string }>
  previousSeasons?: Array<{ season: string; league: SleeperLeagueRaw }>
  /**
   * Phase 2.3 — non-fatal fetch failures surfaced instead of silently swallowed
   * (e.g. a matchup/transaction week that failed after retries). The commit layer
   * can persist these as `importWarning` records so an incomplete import is never
   * presented as complete. Empty/absent = every requested resource fetched cleanly.
   */
  fetchWarnings?: string[]
}
