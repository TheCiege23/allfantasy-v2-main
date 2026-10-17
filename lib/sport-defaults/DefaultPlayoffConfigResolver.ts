/**
 * Resolves default playoff configuration per sport and variant.
 * Used by league creation initialization, standings, seeding and bracket rendering.
 */
import type { SportType, DefaultPlayoffConfig } from './types'

type PlayoffVariantMap = Partial<Record<SportType, Record<string, Partial<DefaultPlayoffConfig>>>>

const BASE_CONFIGS: Record<SportType, DefaultPlayoffConfig> = {
  NFL: {
    sport_type: 'NFL',
    playoff_team_count: 6,
    playoff_weeks: 3,
    first_round_byes: 2,
    bracket_type: 'single_elimination',
    consolation_plays_for: 'pick',
    playoff_start_week: 15,
    seeding_rules: 'standard_standings',
    tiebreaker_rules: ['points_for', 'head_to_head', 'points_against', 'division_record'],
    bye_rules: 'top_two_seeds_bye',
    matchup_length: 1,
    total_rounds: 3,
    consolation_bracket_enabled: true,
    third_place_game_enabled: true,
    toilet_bowl_enabled: false,
    championship_length: 1,
    reseed_behavior: 'fixed_bracket',
  },
  NBA: {
    sport_type: 'NBA',
    playoff_team_count: 6,
    playoff_weeks: 3,
    first_round_byes: 2,
    bracket_type: 'single_elimination',
    consolation_plays_for: 'pick',
    playoff_start_week: 22,
    seeding_rules: 'standard_standings',
    tiebreaker_rules: ['points_for', 'head_to_head', 'points_against'],
    bye_rules: 'top_two_seeds_bye',
    matchup_length: 1,
    total_rounds: 3,
    consolation_bracket_enabled: true,
    third_place_game_enabled: true,
    toilet_bowl_enabled: false,
    championship_length: 1,
    reseed_behavior: 'fixed_bracket',
  },
  MLB: {
    sport_type: 'MLB',
    playoff_team_count: 6,
    playoff_weeks: 4,
    first_round_byes: 2,
    bracket_type: 'single_elimination',
    consolation_plays_for: 'none',
    playoff_start_week: 23,
    seeding_rules: 'standard_standings',
    tiebreaker_rules: ['points_for', 'head_to_head', 'points_against'],
    bye_rules: 'top_two_seeds_bye',
    matchup_length: 1,
    total_rounds: 3,
    consolation_bracket_enabled: false,
    third_place_game_enabled: false,
    toilet_bowl_enabled: false,
    championship_length: 2,
    reseed_behavior: 'fixed_bracket',
  },
  NHL: {
    sport_type: 'NHL',
    playoff_team_count: 6,
    playoff_weeks: 4,
    first_round_byes: 2,
    bracket_type: 'single_elimination',
    consolation_plays_for: 'pick',
    playoff_start_week: 22,
    seeding_rules: 'standard_standings',
    tiebreaker_rules: ['points_for', 'head_to_head', 'points_against'],
    bye_rules: 'top_two_seeds_bye',
    matchup_length: 1,
    total_rounds: 3,
    consolation_bracket_enabled: true,
    third_place_game_enabled: true,
    toilet_bowl_enabled: false,
    championship_length: 2,
    reseed_behavior: 'fixed_bracket',
  },
  NCAAF: {
    sport_type: 'NCAAF',
    playoff_team_count: 6,
    playoff_weeks: 3,
    first_round_byes: 2,
    bracket_type: 'single_elimination',
    consolation_plays_for: 'pick',
    // 6 teams, 3 rounds: weeks 11-13 — NCAAF brackets end on week 13 (ncaafPlayoffWindow.ts).
    playoff_start_week: 11,
    seeding_rules: 'standard_standings',
    tiebreaker_rules: ['points_for', 'head_to_head', 'points_against'],
    bye_rules: 'top_two_seeds_bye',
    matchup_length: 1,
    total_rounds: 3,
    consolation_bracket_enabled: true,
    third_place_game_enabled: true,
    toilet_bowl_enabled: false,
    championship_length: 1,
    reseed_behavior: 'fixed_bracket',
  },
  NCAAB: {
    sport_type: 'NCAAB',
    playoff_team_count: 6,
    playoff_weeks: 3,
    first_round_byes: 2,
    bracket_type: 'single_elimination',
    consolation_plays_for: 'pick',
    playoff_start_week: 16,
    seeding_rules: 'standard_standings',
    tiebreaker_rules: ['points_for', 'head_to_head', 'points_against'],
    bye_rules: 'top_two_seeds_bye',
    matchup_length: 1,
    total_rounds: 3,
    consolation_bracket_enabled: true,
    third_place_game_enabled: true,
    toilet_bowl_enabled: false,
    championship_length: 1,
    reseed_behavior: 'fixed_bracket',
  },
  SOCCER: {
    sport_type: 'SOCCER',
    playoff_team_count: 6,
    playoff_weeks: 3,
    first_round_byes: 2,
    bracket_type: 'single_elimination',
    consolation_plays_for: 'pick',
    playoff_start_week: 36,
    seeding_rules: 'standard_standings',
    tiebreaker_rules: ['points_for', 'head_to_head', 'points_against'],
    bye_rules: 'top_two_seeds_bye',
    matchup_length: 1,
    total_rounds: 3,
    consolation_bracket_enabled: true,
    third_place_game_enabled: true,
    toilet_bowl_enabled: false,
    championship_length: 1,
    reseed_behavior: 'fixed_bracket',
  },
}

const NO_PLAYOFF_OVERLAY: Partial<DefaultPlayoffConfig> = {
  playoff_team_count: 0,
  playoff_weeks: 0,
  first_round_byes: 0,
  playoff_start_week: null,
  bye_rules: null,
  total_rounds: 0,
  consolation_plays_for: 'none',
  consolation_bracket_enabled: false,
  third_place_game_enabled: false,
  toilet_bowl_enabled: false,
  championship_length: 0,
  reseed_behavior: 'fixed_bracket',
}

const VARIANT_OVERRIDES: PlayoffVariantMap = {
  NFL: {
    NO_PLAYOFF: { ...NO_PLAYOFF_OVERLAY },
    STANDARD: {},
    PPR: {},
    HALF_PPR: {},
    SUPERFLEX: {
      reseed_behavior: 'reseed_after_round',
    },
    IDP: {
      tiebreaker_rules: ['points_for', 'head_to_head', 'points_against', 'division_record'],
      reseed_behavior: 'fixed_bracket',
    },
    DYNASTY_IDP: {
      tiebreaker_rules: ['points_for', 'head_to_head', 'points_against', 'division_record'],
      reseed_behavior: 'fixed_bracket',
    },
    DEVY_DYNASTY: {
      playoff_team_count: 8,
      playoff_weeks: 3,
      first_round_byes: 0,
      bye_rules: null,
      total_rounds: 3,
      reseed_behavior: 'fixed_bracket',
    },
    MERGED_DEVY_C2C: {
      playoff_team_count: 8,
      playoff_weeks: 3,
      first_round_byes: 0,
      bye_rules: null,
      total_rounds: 3,
      reseed_behavior: 'fixed_bracket',
    },
  },
  NBA: {
    NO_PLAYOFF: { ...NO_PLAYOFF_OVERLAY },
    STANDARD: {},
    DEVY_DYNASTY: {
      playoff_team_count: 8,
      playoff_weeks: 3,
      first_round_byes: 0,
      bye_rules: null,
      total_rounds: 3,
    },
    MERGED_DEVY_C2C: {
      playoff_team_count: 8,
      playoff_weeks: 3,
      first_round_byes: 0,
      bye_rules: null,
      total_rounds: 3,
    },
  },
  MLB: {
    NO_PLAYOFF: { ...NO_PLAYOFF_OVERLAY },
    STANDARD: {},
  },
  NHL: {
    NO_PLAYOFF: { ...NO_PLAYOFF_OVERLAY },
    STANDARD: {},
  },
  NCAAF: {
    NO_PLAYOFF: { ...NO_PLAYOFF_OVERLAY },
    STANDARD: {},
  },
  NCAAB: {
    NO_PLAYOFF: { ...NO_PLAYOFF_OVERLAY },
    STANDARD: {},
  },
  SOCCER: {
    STANDARD: {},
    NO_PLAYOFF: {
      ...NO_PLAYOFF_OVERLAY,
    },
  },
}

const PLAYOFF_VARIANT_ALIASES: Record<string, string> = {
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
  ZOMBIE: 'NO_PLAYOFF',
  zombie: 'NO_PLAYOFF',
}

export function normalizePlayoffVariant(variant?: string | null): string {
  const raw = String(variant ?? '').trim().toUpperCase()
  return PLAYOFF_VARIANT_ALIASES[raw] ?? raw
}

/**
 * Resolve default playoff config for a sport and optional variant.
 */
export function resolveDefaultPlayoffConfig(
  sportType: SportType,
  formatType?: string | null
): DefaultPlayoffConfig {
  const base = BASE_CONFIGS[sportType] ?? BASE_CONFIGS.NFL
  const normalizedVariant = normalizePlayoffVariant(formatType)
  const overlay = VARIANT_OVERRIDES[sportType]?.[normalizedVariant] ?? {}
  return {
    ...base,
    ...overlay,
    sport_type: sportType,
  }
}
