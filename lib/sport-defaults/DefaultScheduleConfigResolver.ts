/**
 * Resolves default schedule and lock behavior per sport and variant.
 * Used by LeagueDefaultSettingsService and league creation initialization.
 */
import type { SportType, DefaultScheduleConfig } from './types'

type ScheduleVariantMap = Partial<Record<SportType, Record<string, Partial<DefaultScheduleConfig>>>>

const BASE_CONFIGS: Record<SportType, DefaultScheduleConfig> = {
  NFL: {
    sport_type: 'NFL',
    schedule_unit: 'week',
    regular_season_length: 18,
    matchup_frequency: 'weekly',
    season_labeling: 'week',
    lock_time_behavior: 'first_game',
    injury_slot_behavior: 'ir_or_out',
    matchup_cadence: 'weekly',
    head_to_head_or_points_behavior: 'head_to_head',
    lock_window_behavior: 'first_game_of_week',
    scoring_period_behavior: 'full_period',
    reschedule_handling: 'use_final_time',
    doubleheader_or_multi_game_handling: 'all_games_count',
    playoff_transition_point: 15,
    schedule_generation_strategy: 'round_robin',
  },
  NBA: {
    sport_type: 'NBA',
    schedule_unit: 'week',
    regular_season_length: 24,
    matchup_frequency: 'weekly',
    season_labeling: 'week',
    lock_time_behavior: 'first_game',
    injury_slot_behavior: 'ir_or_out',
    matchup_cadence: 'weekly',
    head_to_head_or_points_behavior: 'head_to_head',
    lock_window_behavior: 'first_game_of_slate',
    scoring_period_behavior: 'full_period',
    reschedule_handling: 'use_final_time',
    doubleheader_or_multi_game_handling: 'all_games_count',
    playoff_transition_point: 22,
    schedule_generation_strategy: 'round_robin',
  },
  MLB: {
    sport_type: 'MLB',
    schedule_unit: 'week',
    regular_season_length: 26,
    matchup_frequency: 'weekly',
    season_labeling: 'week',
    lock_time_behavior: 'slate_lock',
    injury_slot_behavior: 'ir_only',
    matchup_cadence: 'weekly',
    head_to_head_or_points_behavior: 'head_to_head',
    lock_window_behavior: 'slate_lock',
    scoring_period_behavior: 'slate_based',
    reschedule_handling: 'use_final_time',
    doubleheader_or_multi_game_handling: 'all_games_count',
    playoff_transition_point: 24,
    schedule_generation_strategy: 'round_robin',
  },
  NHL: {
    sport_type: 'NHL',
    schedule_unit: 'week',
    regular_season_length: 25,
    matchup_frequency: 'weekly',
    season_labeling: 'week',
    lock_time_behavior: 'first_game',
    injury_slot_behavior: 'ir_or_out',
    matchup_cadence: 'weekly',
    head_to_head_or_points_behavior: 'head_to_head',
    lock_window_behavior: 'first_game_of_slate',
    scoring_period_behavior: 'full_period',
    reschedule_handling: 'use_final_time',
    doubleheader_or_multi_game_handling: 'all_games_count',
    playoff_transition_point: 22,
    schedule_generation_strategy: 'round_robin',
  },
  NCAAF: {
    sport_type: 'NCAAF',
    schedule_unit: 'week',
    regular_season_length: 15,
    matchup_frequency: 'weekly',
    season_labeling: 'week',
    lock_time_behavior: 'first_game',
    injury_slot_behavior: 'ir_or_out',
    matchup_cadence: 'weekly',
    head_to_head_or_points_behavior: 'head_to_head',
    lock_window_behavior: 'first_game_of_week',
    scoring_period_behavior: 'full_period',
    reschedule_handling: 'use_final_time',
    doubleheader_or_multi_game_handling: 'all_games_count',
    // Matches the registry's 6-team bracket (weeks 11-13): NCAAF brackets end on week 13 (ncaafPlayoffWindow.ts).
    playoff_transition_point: 11,
    schedule_generation_strategy: 'round_robin',
  },
  NCAAB: {
    sport_type: 'NCAAB',
    schedule_unit: 'week',
    regular_season_length: 18,
    matchup_frequency: 'weekly',
    season_labeling: 'week',
    lock_time_behavior: 'first_game',
    injury_slot_behavior: 'ir_or_out',
    matchup_cadence: 'weekly',
    head_to_head_or_points_behavior: 'head_to_head',
    lock_window_behavior: 'first_game_of_slate',
    scoring_period_behavior: 'full_period',
    reschedule_handling: 'use_final_time',
    doubleheader_or_multi_game_handling: 'all_games_count',
    playoff_transition_point: 16,
    schedule_generation_strategy: 'round_robin',
  },
  SOCCER: {
    sport_type: 'SOCCER',
    schedule_unit: 'week',
    regular_season_length: 38,
    matchup_frequency: 'weekly',
    season_labeling: 'week',
    lock_time_behavior: 'first_game',
    injury_slot_behavior: 'ir_or_out',
    matchup_cadence: 'weekly',
    head_to_head_or_points_behavior: 'head_to_head',
    lock_window_behavior: 'first_game_of_slate',
    scoring_period_behavior: 'full_period',
    reschedule_handling: 'use_final_time',
    doubleheader_or_multi_game_handling: 'all_games_count',
    playoff_transition_point: 36,
    schedule_generation_strategy: 'round_robin',
  },
}

const VARIANT_OVERRIDES: ScheduleVariantMap = {
  NFL: {
    STANDARD: {},
    PPR: {},
    HALF_PPR: {},
    SUPERFLEX: {
      schedule_generation_strategy: 'division_based',
    },
    IDP: {
      lock_window_behavior: 'first_game_of_week',
    },
    DYNASTY_IDP: {
      lock_window_behavior: 'first_game_of_week',
    },
    DEVY_DYNASTY: {
      schedule_generation_strategy: 'division_based',
    },
    MERGED_DEVY_C2C: {
      schedule_generation_strategy: 'division_based',
    },
  },
  NBA: {
    STANDARD: {},
    DEVY_DYNASTY: {},
    MERGED_DEVY_C2C: {},
  },
  MLB: {
    STANDARD: {},
  },
  NHL: {
    STANDARD: {},
  },
  NCAAF: {
    STANDARD: {},
  },
  NCAAB: {
    STANDARD: {},
  },
  SOCCER: {
    STANDARD: {},
    NO_PLAYOFF: {
      playoff_transition_point: 39,
    },
  },
}

const SCHEDULE_VARIANT_ALIASES: Record<string, string> = {
  '': 'STANDARD',
  STANDARD: 'STANDARD',
  PPR: 'PPR',
  HALF_PPR: 'HALF_PPR',
  SUPERFLEX: 'SUPERFLEX',
  IDP: 'IDP',
  DYNASTY_IDP: 'DYNASTY_IDP',
  DEVY: 'DEVY_DYNASTY',
  DEVY_DYNASTY: 'DEVY_DYNASTY',
  C2C: 'MERGED_DEVY_C2C',
  MERGED_DEVY_C2C: 'MERGED_DEVY_C2C',
  NO_PLAYOFF: 'NO_PLAYOFF',
  /** Format-engine league types use lowercase ids; schedule overlays are sport-based for specialty formats. */
  survivor: 'STANDARD',
  SURVIVOR: 'STANDARD',
}

export function normalizeScheduleVariant(variant?: string | null): string {
  const raw = String(variant ?? '').trim().toUpperCase()
  return SCHEDULE_VARIANT_ALIASES[raw] ?? raw
}

/**
 * Resolve default schedule config for a sport and optional variant.
 */
export function resolveDefaultScheduleConfig(
  sportType: SportType,
  formatType?: string | null
): DefaultScheduleConfig {
  const base = BASE_CONFIGS[sportType] ?? BASE_CONFIGS.NFL
  const normalizedVariant = normalizeScheduleVariant(formatType)
  const overlay = VARIANT_OVERRIDES[sportType]?.[normalizedVariant] ?? {}
  return {
    ...base,
    ...overlay,
    sport_type: sportType,
  }
}
