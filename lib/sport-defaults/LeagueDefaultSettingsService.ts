/**
 * Aggregates all default league settings for a sport (playoff, schedule, waiver, trade, tiebreakers).
 * Single entry for "what settings should a new league of this sport start with?"
 * Commissioner can override after initialization; this is the sport-specific starting point.
 *
 * Default league settings defined per sport:
 * - default_team_count, regular_season_length, playoff_team_count, playoff_structure
 * - matchup_frequency, season_labeling, schedule_unit
 * - scoring_mode, roster_mode, waiver_mode, trade_review_mode
 * - standings_tiebreakers, injury_slot_behavior, lock_time_behavior
 */
import type { SportType, DefaultLeagueSettings } from './types'
import { getLeagueDefaults, getWaiverDefaults, getDraftDefaults } from './SportDefaultsRegistry'
import { resolveDefaultPlayoffConfig } from './DefaultPlayoffConfigResolver'
import { resolveDefaultScheduleConfig } from './DefaultScheduleConfigResolver'
import { toSportType } from './sport-type-utils'
import { resolveLeagueVariant } from './LeagueVariantResolver'
import { CONSOLATION_PLAYS_FOR_DRAFT_ORDER_KEY } from '@/lib/playoff-runtime/consolationPlaysFor'

/** Per-sport default tiebreakers (order of application). */
const DEFAULT_TIEBREAKERS: Record<SportType, string[]> = {
  NFL: ['win_pct', 'points_for', 'head_to_head', 'points_against'],
  NBA: ['win_pct', 'points_for', 'head_to_head', 'points_against'],
  MLB: ['win_pct', 'points_for', 'head_to_head', 'points_against'],
  NHL: ['win_pct', 'points_for', 'head_to_head', 'points_against'],
  NCAAF: ['points_for', 'head_to_head', 'points_against'],
  NCAAB: ['points_for', 'head_to_head', 'points_against'],
  SOCCER: ['points_for', 'head_to_head', 'points_against'],
}

/** Per-sport default trade review mode. */
const DEFAULT_TRADE_REVIEW: Record<SportType, 'none' | 'commissioner' | 'league_vote' | 'instant'> = {
  NFL: 'commissioner',
  NBA: 'commissioner',
  MLB: 'commissioner',
  NHL: 'commissioner',
  NCAAF: 'commissioner',
  NCAAB: 'commissioner',
  SOCCER: 'commissioner',
}

/** Per-sport default scoring mode (points vs category vs roto). */
const DEFAULT_SCORING_MODE: Record<SportType, 'points' | 'category' | 'roto'> = {
  NFL: 'points',
  NBA: 'points',
  MLB: 'points',
  NHL: 'points',
  NCAAF: 'points',
  NCAAB: 'points',
  SOCCER: 'points',
}

/** Per-sport default roster mode (redraft vs dynasty vs keeper). League creation can override when user selects dynasty. */
const DEFAULT_ROSTER_MODE: Record<SportType, 'redraft' | 'dynasty' | 'keeper'> = {
  NFL: 'redraft',
  NBA: 'redraft',
  MLB: 'redraft',
  NHL: 'redraft',
  NCAAF: 'redraft',
  NCAAB: 'redraft',
  SOCCER: 'redraft',
}

/**
 * Get full default league settings for a sport. Use for League.settings JSON and API.
 */
export function getDefaultLeagueSettings(sportType: SportType | string): DefaultLeagueSettings {
  const sport = typeof sportType === 'string' ? toSportType(sportType) : sportType
  return getDefaultLeagueSettingsForVariant(sport)
}

/**
 * Variant-aware default league settings. NFL IDP/DYNASTY_IDP currently share core league settings
 * while using variant-specific roster/scoring/draft overlays elsewhere.
 */
export function getDefaultLeagueSettingsForVariant(
  sportType: SportType | string,
  variant?: string | null
): DefaultLeagueSettings {
  const sport = typeof sportType === 'string' ? toSportType(sportType) : sportType
  const variantContext = resolveLeagueVariant(sport, variant)
  const league = getLeagueDefaults(variantContext.sportType)
  const waiver = getWaiverDefaults(variantContext.sportType, variantContext.variant ?? undefined)
  const playoff = resolveDefaultPlayoffConfig(
    variantContext.sportType,
    variantContext.variant ?? undefined
  )
  const schedule = resolveDefaultScheduleConfig(
    variantContext.sportType,
    variantContext.variant ?? undefined
  )

  return {
    sport_type: variantContext.sportType,
    default_team_count: league.default_team_count,
    regular_season_length: schedule.regular_season_length,
    playoff_team_count: playoff.playoff_team_count,
    playoff_structure: {
      playoff_team_count: playoff.playoff_team_count,
      playoff_weeks: playoff.playoff_weeks,
      first_round_byes: playoff.first_round_byes,
      bracket_type: playoff.bracket_type,
      consolation_plays_for: playoff.consolation_plays_for,
      playoff_start_week: playoff.playoff_start_week ?? undefined,
      seeding_rules: playoff.seeding_rules ?? 'standard_standings',
      tiebreaker_rules: playoff.tiebreaker_rules ?? [],
      bye_rules: playoff.bye_rules ?? undefined,
      matchup_length: playoff.matchup_length ?? 1,
      total_rounds: playoff.total_rounds ?? undefined,
      consolation_bracket_enabled: playoff.consolation_bracket_enabled ?? (playoff.consolation_plays_for !== 'none'),
      third_place_game_enabled: playoff.third_place_game_enabled ?? false,
      toilet_bowl_enabled: playoff.toilet_bowl_enabled ?? false,
      championship_length: playoff.championship_length ?? 1,
      reseed_behavior: playoff.reseed_behavior ?? 'fixed_bracket',
    },
    matchup_frequency: schedule.matchup_frequency,
    season_labeling: schedule.season_labeling,
    scoring_mode: DEFAULT_SCORING_MODE[variantContext.sportType] ?? 'points',
    roster_mode: DEFAULT_ROSTER_MODE[variantContext.sportType] ?? 'redraft',
    waiver_mode: waiver.waiver_type,
    trade_review_mode: DEFAULT_TRADE_REVIEW[variantContext.sportType],
    standings_tiebreakers:
      DEFAULT_TIEBREAKERS[variantContext.sportType] ?? DEFAULT_TIEBREAKERS.NFL,
    schedule_unit: schedule.schedule_unit,
    injury_slot_behavior: schedule.injury_slot_behavior,
    lock_time_behavior: schedule.lock_time_behavior,
  }
}

/**
 * Build the League.settings JSON object for a newly created league (sport- and variant-specific).
 * Includes draft defaults so draft room and mock draft use correct rounds, timer, and behavior.
 * Commissioner overrides can merge on top of this.
 * @param variant - Optional league variant (e.g. IDP, DYNASTY_IDP for NFL) for draft/roster-specific defaults.
 */
export function buildInitialLeagueSettings(
  sportType: SportType | string,
  variant?: string | null
): Record<string, unknown> {
  const sport = typeof sportType === 'string' ? toSportType(sportType) : sportType
  const variantContext = resolveLeagueVariant(sport, variant)
  const def = getDefaultLeagueSettingsForVariant(variantContext.sportType, variantContext.variant)
  const draft = getDraftDefaults(variantContext.sportType, variantContext.variant ?? undefined)
  const schedule = resolveDefaultScheduleConfig(
    variantContext.sportType,
    variantContext.variant ?? undefined
  )
  return {
    sport_type: def.sport_type,
    default_team_count: def.default_team_count,
    regular_season_length: def.regular_season_length,
    playoff_team_count: def.playoff_team_count,
    // A league created from here on plays for the pick in its draft order too; one created before does
    // not until its commissioner saves the setting (lib/playoff-runtime/consolationPlaysFor.ts). Stamped
    // here and in `bootstrapLeaguePlayoffConfig` when it fills the setting — creation only, never on
    // an existing league's defaults.
    playoff_structure: { ...def.playoff_structure, [CONSOLATION_PLAYS_FOR_DRAFT_ORDER_KEY]: true },
    matchup_frequency: def.matchup_frequency,
    season_labeling: def.season_labeling,
    scoring_mode: def.scoring_mode,
    roster_mode: def.roster_mode,
    waiver_mode: def.waiver_mode,
    trade_review_mode: def.trade_review_mode,
    standings_tiebreakers: def.standings_tiebreakers,
    schedule_unit: def.schedule_unit,
    injury_slot_behavior: def.injury_slot_behavior,
    lock_time_behavior: def.lock_time_behavior,
    // Schedule behavior (sport/variant-aware); matchup generation and scoring windows use these.
    schedule_cadence: schedule.matchup_cadence ?? schedule.matchup_frequency,
    schedule_head_to_head_behavior: schedule.head_to_head_or_points_behavior ?? 'head_to_head',
    schedule_lock_window_behavior: schedule.lock_window_behavior ?? schedule.lock_time_behavior,
    schedule_scoring_period_behavior: schedule.scoring_period_behavior ?? 'full_period',
    schedule_reschedule_handling: schedule.reschedule_handling ?? 'use_final_time',
    schedule_doubleheader_handling: schedule.doubleheader_or_multi_game_handling ?? 'all_games_count',
    schedule_playoff_transition_point: schedule.playoff_transition_point ?? null,
    schedule_generation_strategy: schedule.schedule_generation_strategy ?? 'round_robin',
    // Draft defaults (sport/variant-aware); draft room and mock draft read from settings or fallback to registry.
    draft_type: draft.draft_type,
    draft_rounds: draft.rounds_default,
    draft_timer_seconds: draft.timer_seconds_default,
    draft_pick_order_rules: draft.pick_order_rules,
    draft_snake_or_linear: draft.snake_or_linear_behavior ?? draft.pick_order_rules,
    draft_third_round_reversal: draft.third_round_reversal ?? false,
    draft_autopick_behavior: draft.autopick_behavior ?? 'queue-first',
    draft_queue_size_limit: draft.queue_size_limit ?? null,
    draft_pre_draft_ranking_source: draft.pre_draft_ranking_source ?? 'adp',
    draft_roster_fill_order: draft.roster_fill_order ?? 'starter_first',
    draft_position_filter_behavior: draft.position_filter_behavior ?? 'by_eligibility',
  }
}
