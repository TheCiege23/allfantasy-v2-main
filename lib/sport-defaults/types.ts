/**
 * Sport Defaults Core Registry — shared types for all sport default domains.
 * Aligns with LeagueSport / SportType: NFL, NBA, MLB, NHL, NCAAF, NCAAB, SOCCER.
 */

export type SportType =
  | 'NFL'
  | 'NBA'
  | 'MLB'
  | 'NHL'
  | 'NCAAF'
  | 'NCAAB'
  | 'SOCCER'

export const SPORT_TYPES: SportType[] = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB', 'SOCCER']

/** NFL league variants (presets). Other sports use STANDARD or sport-specific format. */
export type NFLLeagueVariant =
  | 'STANDARD'
  | 'PPR'
  | 'HALF_PPR'
  | 'SUPERFLEX'
  | 'TE_PREMIUM'
  | 'IDP'
  | 'DYNASTY_IDP'

/** League variant key (sport-agnostic); NFL uses NFLLeagueVariant. */
export type LeagueVariant = NFLLeagueVariant | 'STANDARD' | string

/** Player pool source for ingestion and draft/waiver. */
type PlayerPoolSource = 'sports_player' | 'sleeper' | 'external' | 'manual'

/** Sport-level metadata: display, icon, logo, season type, player pool, labels. */
export interface SportMetadata {
  sport_type: SportType
  display_name: string
  short_name: string
  icon: string
  logo_strategy: 'sleeper' | 'espn' | 'local' | 'none'
  default_season_type: 'regular' | 'full' | 'playoff'
  /** Where to load players from for this sport (draft/waiver pool). */
  player_pool_source?: PlayerPoolSource
  /** Sport-specific display labels for UI (e.g. "Roster", "Matchups"). */
  display_labels?: Record<string, string>
}

/** League-level defaults (team count, playoff, season length, matchup unit, trade deadline). */
export interface LeagueDefaults {
  sport_type: SportType
  default_league_name_pattern: string
  default_team_count: number
  default_playoff_team_count: number
  default_regular_season_length: number
  default_matchup_unit: 'week' | 'round' | 'day'
  default_trade_deadline_logic: 'none' | 'week_based' | 'date_based'
}

/** Playoff structure default (bracket, weeks, byes). */
export interface DefaultPlayoffConfig {
  sport_type: SportType
  playoff_team_count: number
  playoff_weeks: number
  first_round_byes: number
  bracket_type: 'single_elimination' | 'double_elimination' | 'consolation'
  consolation_plays_for: 'pick' | 'none' | 'cash'
  /** Week (1-based) when playoffs start; e.g. 15 for NFL. */
  playoff_start_week?: number | null
  /** Seeding rules description; e.g. 'standard_standings', 'division_winners_first'. */
  seeding_rules?: string
  /** Playoff tiebreaker order (e.g. ['points_for', 'head_to_head']). */
  tiebreaker_rules?: string[]
  /** Bye rules description; first_round_byes is the numeric value. */
  bye_rules?: string | null
  /** Matchup length in schedule units (e.g. 1 = one week per matchup). */
  matchup_length?: number
  /** Total playoff rounds (e.g. 3 for 6-team bracket). */
  total_rounds?: number
  /** Whether consolation bracket is enabled. */
  consolation_bracket_enabled?: boolean
  /** Whether a third-place game is played. */
  third_place_game_enabled?: boolean
  /** Whether toilet bowl (last-place bracket) is enabled. */
  toilet_bowl_enabled?: boolean
  /** Championship matchup length in weeks (e.g. 1 or 2). */
  championship_length?: number
  /** Reseed after each round (e.g. 'reseed_after_round' | 'fixed_bracket'). */
  reseed_behavior?: string
}

/** Schedule and lock behavior default. */
export interface DefaultScheduleConfig {
  sport_type: SportType
  schedule_unit: 'week' | 'round' | 'series' | 'slate' | 'scoring_period'
  regular_season_length: number
  matchup_frequency: 'weekly' | 'daily' | 'round' | 'slate'
  season_labeling: 'week' | 'round' | 'matchup'
  lock_time_behavior: 'game_time' | 'first_game' | 'slate_lock' | 'manual'
  injury_slot_behavior: 'ir_only' | 'ir_or_out' | 'flexible' | 'none'
  /** Matchup cadence (alias or extension of matchup_frequency). */
  matchup_cadence?: 'weekly' | 'daily' | 'round' | 'slate'
  /** Head-to-head vs points-only (e.g. 'head_to_head', 'points_only', 'both'). */
  head_to_head_or_points_behavior?: string
  /** Lock window description; aligns with lock_time_behavior. */
  lock_window_behavior?: string
  /** Scoring period behavior (e.g. 'full_period', 'daily_rolling', 'slate_based'). */
  scoring_period_behavior?: string
  /** How to handle rescheduled/cancelled games (e.g. 'use_original_time', 'use_final_time', 'exclude'). */
  reschedule_handling?: string
  /** Doubleheader or multi-game in same period (e.g. 'all_games_count', 'single_score_per_slot'). */
  doubleheader_or_multi_game_handling?: string
  /** Week/round when regular season ends and playoffs start (e.g. 15 for NFL). */
  playoff_transition_point?: number
  /** Schedule generation strategy (e.g. 'round_robin', 'random', 'division_based'). */
  schedule_generation_strategy?: string
}

/** Full default league settings (for League.settings JSON and commissioner overrides). */
export interface DefaultLeagueSettings {
  sport_type: SportType
  default_team_count: number
  regular_season_length: number
  playoff_team_count: number
  playoff_structure: Omit<DefaultPlayoffConfig, 'sport_type'>
  matchup_frequency: string
  season_labeling: string
  scoring_mode: 'points' | 'category' | 'roto'
  roster_mode: 'redraft' | 'dynasty' | 'keeper'
  waiver_mode: string
  trade_review_mode: 'none' | 'commissioner' | 'league_vote' | 'instant'
  standings_tiebreakers: string[]
  schedule_unit: string
  injury_slot_behavior: string
  lock_time_behavior: string
}

/** Roster slot defaults. */
export interface RosterDefaults {
  sport_type: SportType
  starter_slots: Record<string, number>
  bench_slots: number
  IR_slots: number
  taxi_slots: number
  devy_slots: number
  flex_definitions: Array<{ slotName: string; allowedPositions: string[] }>
}

/** Single scoring rule (for in-registry fallback when template not loaded). */
interface ScoringRuleDefault {
  statKey: string
  pointsValue: number
  multiplier?: number
  enabled?: boolean
}

/** Scoring: template id (or key) and category type. */
export interface ScoringDefaults {
  sport_type: SportType
  scoring_template_id: string
  scoring_format: string
  category_type: 'points' | 'category' | 'roto'
  /** Optional in-registry rules; when present, can be used as fallback before template is resolved. */
  scoring_rules?: ScoringRuleDefault[]
}

/** Draft timer defaults (per-pick and behavior). */
interface DraftTimerDefaults {
  per_pick_seconds: number | null
  auto_pick_enabled?: boolean
}

/** Snake vs linear behavior for non-auction drafts. */
type SnakeOrLinear = 'snake' | 'linear'

/** Autopick behavior when timer expires. */
type AutopickBehavior = 'queue-first' | 'bpa' | 'need-based' | 'skip'

/** Pre-draft ranking source for AI and queue. */
type PreDraftRankingSource = 'adp' | 'dynasty_adp' | 'ecr' | 'projections' | 'tiers' | 'custom' | 'sport_default' | 'adp_projection_rank_fallback'

/** Roster fill order for AI/autopick (slot priority). */
type RosterFillOrder = 'starter_first' | 'need_based' | 'bpa' | 'position_scarcity'

/** Position filter behavior in draft room. */
type PositionFilterBehavior = 'all' | 'by_slot' | 'by_need' | 'by_eligibility'

/** Draft defaults — full preset per sport/variant for draft room and league creation. */
export interface DraftDefaults {
  sport_type: SportType
  draft_type: 'snake' | 'linear' | 'auction'
  rounds_default: number
  timer_seconds_default: number | null
  pick_order_rules: 'snake' | 'linear'
  /** Extended timer config; when set, overrides timer_seconds_default for UI/API. */
  timer_defaults?: DraftTimerDefaults
  /** Snake vs linear; when set, aligns with pick_order_rules. */
  snake_or_linear_behavior?: SnakeOrLinear
  /** Third-round reversal (3RR) for snake; supported only where applicable (e.g. NFL). */
  third_round_reversal?: boolean
  /** Default autopick behavior when timer expires. */
  autopick_behavior?: AutopickBehavior
  /** Max queue size in draft room (if supported). */
  queue_size_limit?: number | null
  /** Human-readable draft order rules description. */
  draft_order_rules?: string
  /** Source for pre-draft rankings / AI suggestions. */
  pre_draft_ranking_source?: PreDraftRankingSource
  /** How to fill roster during autopick / AI suggestions. */
  roster_fill_order?: RosterFillOrder
  /** Position filter behavior in draft room. */
  position_filter_behavior?: PositionFilterBehavior
  /** Whether keeper/dynasty carryover hooks are supported for this sport/variant. */
  keeper_dynasty_carryover_supported?: boolean
}

/** Waiver type (supported modes). */
type WaiverTypeDefault = 'faab' | 'rolling' | 'reverse_standings' | 'fcfs' | 'standard'

/** Claim priority / tiebreak behavior. */
type ClaimPriorityBehavior = 'faab_highest' | 'priority_lowest_first' | 'reverse_standings' | 'earliest_claim'

/** When free agents unlock (FCFS). */
type FreeAgentUnlockBehavior = 'after_waiver_run' | 'game_lock' | 'slate_lock' | 'instant' | 'daily'

/** Game lock behavior for waiver eligibility. */
type GameLockBehavior = 'game_time' | 'first_game' | 'slate_lock' | 'manual'

/** FAAB reset rules. */
type FaabResetRule = 'never' | 'yearly' | 'midseason' | 'weekly'

/** Waiver defaults — full preset per sport/variant for league creation and waiver processor. */
export interface WaiverDefaults {
  sport_type: SportType
  waiver_type: WaiverTypeDefault
  processing_days: number[] | null
  FAAB_budget_default: number | null
  /** Processing time of day (UTC), e.g. "10:00" or "12:00:00" for noon UTC. */
  processing_time_utc?: string | null
  /** Whether FAAB is enabled (true when waiver_type is 'faab'). */
  faab_enabled?: boolean
  /** FAAB reset rule; when budget resets. */
  faab_reset_rules?: FaabResetRule | null
  /** Claim priority / tiebreak rule for processor. */
  claim_priority_behavior?: ClaimPriorityBehavior | string | null
  /** Continuous waivers (e.g. run every day in list). */
  continuous_waivers_behavior?: boolean
  /** When free agents become FCFS after waiver run. */
  free_agent_unlock_behavior?: FreeAgentUnlockBehavior | string | null
  /** Game lock behavior for eligibility. */
  game_lock_behavior?: GameLockBehavior | string | null
  /** Drop lock: can drop locked players or not. */
  drop_lock_behavior?: 'lock_with_game' | 'always_allow_drop' | 'manual'
  /** Same-day add/drop rules. */
  same_day_add_drop_rules?: 'allow' | 'disallow' | 'allow_if_not_played'
  /** Max claims per period (e.g. per week); null = unlimited. */
  max_claims_per_period?: number | null
}

/** Single team metadata (for team list / logos). */
interface TeamMetadataDefault {
  team_id: string
  team_name: string
  city: string
  abbreviation: string
  primary_logo: string | null
  alternate_logo: string | null
}

/** Team metadata list per sport (optional; can be loaded from external source). */
export interface TeamMetadataDefaults {
  sport_type: SportType
  teams: TeamMetadataDefault[]
}

/** Aggregated defaults for one sport (what the resolver returns). */
export interface SportDefaultSet {
  metadata: SportMetadata
  league: LeagueDefaults
  roster: RosterDefaults
  scoring: ScoringDefaults
  draft: DraftDefaults
  waiver: WaiverDefaults
  teamMetadata: TeamMetadataDefaults | null
}
