/**
 * Central registry of per-sport defaults: league, roster, scoring, draft, waiver.
 * Single source of truth for backend and shared config; league creation loads from here.
 */
import type {
  SportType,
  LeagueDefaults,
  RosterDefaults,
  ScoringDefaults,
  DraftDefaults,
  WaiverDefaults,
  TeamMetadataDefaults,
} from './types'
import { SPORT_TYPES } from './types'
import { getRosterOverlayForVariant } from './LeagueVariantRegistry'
import { getTeamMetadataForSport } from '@/lib/sport-teams/SportTeamMetadataRegistry'
import { supportsIdpLeagueSport } from '@/lib/sport-scope'

export const SPORT_DEFAULTS_CORE_REGISTRY_VERSION = '2026-03-20.1'

export function getSupportedSportDefaultsSports(): SportType[] {
  return [...SPORT_TYPES]
}

const LEAGUE_DEFAULTS: Record<SportType, LeagueDefaults> = {
  NFL: {
    sport_type: 'NFL',
    default_league_name_pattern: 'My NFL League',
    default_team_count: 12,
    default_playoff_team_count: 6,
    default_regular_season_length: 18,
    default_matchup_unit: 'week',
    default_trade_deadline_logic: 'week_based',
  },
  NBA: {
    sport_type: 'NBA',
    default_league_name_pattern: 'My NBA League',
    default_team_count: 12,
    default_playoff_team_count: 6,
    default_regular_season_length: 24,
    default_matchup_unit: 'week',
    default_trade_deadline_logic: 'week_based',
  },
  MLB: {
    sport_type: 'MLB',
    default_league_name_pattern: 'My MLB League',
    default_team_count: 12,
    default_playoff_team_count: 6,
    default_regular_season_length: 26,
    default_matchup_unit: 'week',
    default_trade_deadline_logic: 'week_based',
  },
  NHL: {
    sport_type: 'NHL',
    default_league_name_pattern: 'My NHL League',
    default_team_count: 12,
    default_playoff_team_count: 6,
    default_regular_season_length: 25,
    default_matchup_unit: 'week',
    default_trade_deadline_logic: 'week_based',
  },
  NCAAF: {
    sport_type: 'NCAAF',
    default_league_name_pattern: 'My NCAA Football League',
    default_team_count: 12,
    default_playoff_team_count: 6,
    default_regular_season_length: 15,
    default_matchup_unit: 'week',
    default_trade_deadline_logic: 'week_based',
  },
  NCAAB: {
    sport_type: 'NCAAB',
    default_league_name_pattern: 'My NCAA Basketball League',
    default_team_count: 12,
    default_playoff_team_count: 6,
    default_regular_season_length: 18,
    default_matchup_unit: 'week',
    default_trade_deadline_logic: 'week_based',
  },
  SOCCER: {
    sport_type: 'SOCCER',
    default_league_name_pattern: 'My Soccer League',
    default_team_count: 12,
    default_playoff_team_count: 6,
    default_regular_season_length: 38,
    default_matchup_unit: 'week',
    default_trade_deadline_logic: 'week_based',
  },
}

const ROSTER_DEFAULTS: Record<SportType, RosterDefaults> = {
  NFL: {
    sport_type: 'NFL',
    starter_slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 },
    bench_slots: 6,
    IR_slots: 1,
    taxi_slots: 0,
    devy_slots: 0,
    flex_definitions: [
      { slotName: 'FLX', allowedPositions: ['RB', 'WR', 'TE'] },
      { slotName: 'SF', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
    ],
  },
  NBA: {
    sport_type: 'NBA',
    starter_slots: { PG: 1, SG: 1, SF: 1, PF: 1, C: 1, G: 1, F: 1, UTIL: 1 },
    bench_slots: 4,
    IR_slots: 1,
    taxi_slots: 0,
    devy_slots: 0,
    flex_definitions: [{ slotName: 'G', allowedPositions: ['PG', 'SG'] }, { slotName: 'F', allowedPositions: ['SF', 'PF'] }, { slotName: 'UTIL', allowedPositions: ['PG', 'SG', 'SF', 'PF', 'C'] }],
  },
  MLB: {
    sport_type: 'MLB',
    starter_slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, DH: 1, UTIL: 1, SP: 2, RP: 2, P: 1 },
    bench_slots: 6,
    IR_slots: 1,
    taxi_slots: 0,
    devy_slots: 0,
    flex_definitions: [
      { slotName: 'UTIL', allowedPositions: ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'] },
      { slotName: 'P', allowedPositions: ['SP', 'RP'] },
    ],
  },
  NHL: {
    sport_type: 'NHL',
    starter_slots: { C: 2, LW: 2, RW: 2, D: 2, G: 1, UTIL: 1 },
    bench_slots: 6,
    IR_slots: 1,
    taxi_slots: 0,
    devy_slots: 0,
    flex_definitions: [{ slotName: 'UTIL', allowedPositions: ['C', 'LW', 'RW', 'D'] }],
  },
  NCAAF: {
    sport_type: 'NCAAF',
    starter_slots: { QB: 1, RB: 1, WR: 2, TE: 1, DEF: 1 },
    bench_slots: 8,
    IR_slots: 1,
    taxi_slots: 0,
    devy_slots: 0,
    flex_definitions: [
      { slotName: 'FLX', allowedPositions: ['RB', 'WR', 'TE'] },
      { slotName: 'SF', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
    ],
  },
  NCAAB: {
    sport_type: 'NCAAB',
    starter_slots: { G: 2, F: 2, C: 1, UTIL: 1 },
    bench_slots: 4,
    IR_slots: 1,
    taxi_slots: 0,
    devy_slots: 0,
    flex_definitions: [{ slotName: 'UTIL', allowedPositions: ['G', 'F', 'C'] }],
  },
  SOCCER: {
    sport_type: 'SOCCER',
    starter_slots: { GKP: 1, DEF: 4, MID: 4, FWD: 2, UTIL: 1 },
    bench_slots: 4,
    IR_slots: 1,
    taxi_slots: 0,
    devy_slots: 0,
    flex_definitions: [{ slotName: 'UTIL', allowedPositions: ['GKP', 'DEF', 'MID', 'FWD'] }],
  },
}

/** Devy Dynasty roster defaults by sport (PROMPT 2/6). Football devy uses NCAAF prospect pools. */
const DEVY_DYNASTY_ROSTER_DEFAULTS: Record<'NFL' | 'NCAAF' | 'NBA', RosterDefaults> = {
  NFL: {
    sport_type: 'NFL',
    starter_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPER_FLEX: 1 },
    bench_slots: 12,
    IR_slots: 3,
    taxi_slots: 6,
    devy_slots: 6,
    flex_definitions: [
      { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
      { slotName: 'SUPER_FLEX', allowedPositions: ['QB', 'RB', 'WR', 'TE'] },
    ],
  },
  NCAAF: {
    sport_type: 'NCAAF',
    starter_slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1 },
    bench_slots: 12,
    IR_slots: 2,
    taxi_slots: 6,
    devy_slots: 6,
    flex_definitions: [
      { slotName: 'FLEX', allowedPositions: ['RB', 'WR', 'TE'] },
    ],
  },
  NBA: {
    sport_type: 'NBA',
    starter_slots: { G: 2, F: 2, C: 1, FLEX: 2 },
    bench_slots: 10,
    IR_slots: 3,
    taxi_slots: 4,
    devy_slots: 5,
    flex_definitions: [
      { slotName: 'G', allowedPositions: ['PG', 'SG'] },
      { slotName: 'F', allowedPositions: ['SF', 'PF'] },
      { slotName: 'FLEX', allowedPositions: ['PG', 'SG', 'SF', 'PF', 'C'] },
    ],
  },
}

const SCORING_DEFAULTS: Record<SportType, ScoringDefaults> = {
  NFL: { sport_type: 'NFL', scoring_template_id: 'default-NFL-HALF_PPR', scoring_format: 'Half PPR', category_type: 'points' },
  NBA: { sport_type: 'NBA', scoring_template_id: 'default-NBA-points', scoring_format: 'points', category_type: 'points' },
  MLB: { sport_type: 'MLB', scoring_template_id: 'default-MLB-standard', scoring_format: 'standard', category_type: 'points' },
  NHL: { sport_type: 'NHL', scoring_template_id: 'default-NHL-standard', scoring_format: 'standard', category_type: 'points' },
  NCAAF: { sport_type: 'NCAAF', scoring_template_id: 'default-NCAAF-HALF_PPR', scoring_format: 'Half PPR College', category_type: 'points' },
  NCAAB: { sport_type: 'NCAAB', scoring_template_id: 'default-NCAAB-points', scoring_format: 'points', category_type: 'points' },
  SOCCER: { sport_type: 'SOCCER', scoring_template_id: 'default-SOCCER-standard', scoring_format: 'standard', category_type: 'points' },
}

/** Base draft defaults per sport; NFL IDP overlay applied in getDraftDefaults when formatType is IDP. */
const DRAFT_DEFAULTS: Record<SportType, DraftDefaults> = {
  NFL: {
    sport_type: 'NFL',
    draft_type: 'snake',
    rounds_default: 12,
    timer_seconds_default: 90,
    pick_order_rules: 'snake',
    timer_defaults: { per_pick_seconds: 90, auto_pick_enabled: false },
    snake_or_linear_behavior: 'snake',
    third_round_reversal: false,
    autopick_behavior: 'queue-first',
    queue_size_limit: 50,
    draft_order_rules: 'snake',
    pre_draft_ranking_source: 'adp',
    roster_fill_order: 'starter_first',
    position_filter_behavior: 'by_eligibility',
    keeper_dynasty_carryover_supported: true,
  },
  NBA: {
    sport_type: 'NBA',
    draft_type: 'snake',
    rounds_default: 13,
    timer_seconds_default: 90,
    pick_order_rules: 'snake',
    timer_defaults: { per_pick_seconds: 90, auto_pick_enabled: false },
    snake_or_linear_behavior: 'snake',
    third_round_reversal: false,
    autopick_behavior: 'queue-first',
    queue_size_limit: 40,
    draft_order_rules: 'snake',
    pre_draft_ranking_source: 'adp',
    roster_fill_order: 'starter_first',
    position_filter_behavior: 'by_eligibility',
    keeper_dynasty_carryover_supported: true,
  },
  MLB: {
    sport_type: 'MLB',
    draft_type: 'snake',
    rounds_default: 26,
    timer_seconds_default: 90,
    pick_order_rules: 'snake',
    timer_defaults: { per_pick_seconds: 90, auto_pick_enabled: false },
    snake_or_linear_behavior: 'snake',
    third_round_reversal: false,
    autopick_behavior: 'queue-first',
    queue_size_limit: 60,
    draft_order_rules: 'snake',
    pre_draft_ranking_source: 'projections',
    roster_fill_order: 'position_scarcity',
    position_filter_behavior: 'by_eligibility',
    keeper_dynasty_carryover_supported: true,
  },
  NHL: {
    sport_type: 'NHL',
    draft_type: 'snake',
    rounds_default: 18,
    timer_seconds_default: 90,
    pick_order_rules: 'snake',
    timer_defaults: { per_pick_seconds: 90, auto_pick_enabled: false },
    snake_or_linear_behavior: 'snake',
    third_round_reversal: false,
    autopick_behavior: 'queue-first',
    queue_size_limit: 50,
    draft_order_rules: 'snake',
    pre_draft_ranking_source: 'adp',
    roster_fill_order: 'starter_first',
    position_filter_behavior: 'by_eligibility',
    keeper_dynasty_carryover_supported: true,
  },
  NCAAF: {
    sport_type: 'NCAAF',
    draft_type: 'snake',
    rounds_default: 14,
    timer_seconds_default: 90,
    pick_order_rules: 'snake',
    timer_defaults: { per_pick_seconds: 90, auto_pick_enabled: false },
    snake_or_linear_behavior: 'snake',
    third_round_reversal: false,
    autopick_behavior: 'queue-first',
    queue_size_limit: 70,
    draft_order_rules: 'snake',
    pre_draft_ranking_source: 'adp',
    roster_fill_order: 'position_scarcity',
    position_filter_behavior: 'by_eligibility',
    keeper_dynasty_carryover_supported: true,
  },
  NCAAB: {
    sport_type: 'NCAAB',
    draft_type: 'snake',
    rounds_default: 12,
    timer_seconds_default: 90,
    pick_order_rules: 'snake',
    timer_defaults: { per_pick_seconds: 90, auto_pick_enabled: false },
    snake_or_linear_behavior: 'snake',
    third_round_reversal: false,
    autopick_behavior: 'queue-first',
    queue_size_limit: 40,
    draft_order_rules: 'snake',
    pre_draft_ranking_source: 'adp',
    roster_fill_order: 'starter_first',
    position_filter_behavior: 'by_eligibility',
    keeper_dynasty_carryover_supported: false,
  },
  SOCCER: {
    sport_type: 'SOCCER',
    draft_type: 'snake',
    rounds_default: 15,
    timer_seconds_default: 90,
    pick_order_rules: 'snake',
    timer_defaults: { per_pick_seconds: 90, auto_pick_enabled: false },
    snake_or_linear_behavior: 'snake',
    third_round_reversal: false,
    autopick_behavior: 'queue-first',
    queue_size_limit: 40,
    draft_order_rules: 'snake',
    pre_draft_ranking_source: 'sport_default',
    roster_fill_order: 'position_scarcity',
    position_filter_behavior: 'by_eligibility',
    keeper_dynasty_carryover_supported: true,
  },
}

/**
 * Waiver defaults per sport (STANDARD preset). Variant overlays are applied in getWaiverDefaults.
 * Modes covered: standard, rolling, reverse_standings, faab, fcfs.
 */
const WAIVER_DEFAULTS: Record<SportType, WaiverDefaults> = {
  NFL: {
    sport_type: 'NFL',
    waiver_type: 'faab',
    processing_days: [2],
    FAAB_budget_default: 100,
    processing_time_utc: '10:00',
    faab_enabled: true,
    faab_reset_rules: 'never',
    claim_priority_behavior: 'faab_highest',
    continuous_waivers_behavior: false,
    free_agent_unlock_behavior: 'after_waiver_run',
    game_lock_behavior: 'game_time',
    drop_lock_behavior: 'lock_with_game',
    same_day_add_drop_rules: 'allow_if_not_played',
    max_claims_per_period: 10,
  },
  NBA: {
    sport_type: 'NBA',
    waiver_type: 'rolling',
    processing_days: [1, 3, 5],
    FAAB_budget_default: null,
    processing_time_utc: '12:00',
    faab_enabled: false,
    faab_reset_rules: 'never',
    claim_priority_behavior: 'priority_lowest_first',
    continuous_waivers_behavior: true,
    free_agent_unlock_behavior: 'daily',
    game_lock_behavior: 'first_game',
    drop_lock_behavior: 'lock_with_game',
    same_day_add_drop_rules: 'allow_if_not_played',
    max_claims_per_period: 14,
  },
  MLB: {
    sport_type: 'MLB',
    waiver_type: 'faab',
    processing_days: [1, 4],
    FAAB_budget_default: 100,
    processing_time_utc: '12:00',
    faab_enabled: true,
    faab_reset_rules: 'never',
    claim_priority_behavior: 'faab_highest',
    continuous_waivers_behavior: true,
    free_agent_unlock_behavior: 'daily',
    game_lock_behavior: 'first_game',
    drop_lock_behavior: 'always_allow_drop',
    same_day_add_drop_rules: 'allow_if_not_played',
    max_claims_per_period: 14,
  },
  NHL: {
    sport_type: 'NHL',
    waiver_type: 'reverse_standings',
    processing_days: [1, 3, 5],
    FAAB_budget_default: null,
    processing_time_utc: '12:00',
    faab_enabled: false,
    faab_reset_rules: 'never',
    claim_priority_behavior: 'reverse_standings',
    continuous_waivers_behavior: true,
    free_agent_unlock_behavior: 'daily',
    game_lock_behavior: 'game_time',
    drop_lock_behavior: 'lock_with_game',
    same_day_add_drop_rules: 'allow_if_not_played',
    max_claims_per_period: 12,
  },
  NCAAF: {
    sport_type: 'NCAAF',
    waiver_type: 'faab',
    processing_days: [2],
    FAAB_budget_default: 100,
    processing_time_utc: '10:00',
    faab_enabled: true,
    faab_reset_rules: 'never',
    claim_priority_behavior: 'faab_highest',
    continuous_waivers_behavior: false,
    free_agent_unlock_behavior: 'after_waiver_run',
    game_lock_behavior: 'game_time',
    drop_lock_behavior: 'lock_with_game',
    same_day_add_drop_rules: 'allow_if_not_played',
    max_claims_per_period: 10,
  },
  NCAAB: {
    sport_type: 'NCAAB',
    waiver_type: 'rolling',
    processing_days: [1, 4],
    FAAB_budget_default: null,
    processing_time_utc: '12:00',
    faab_enabled: false,
    faab_reset_rules: 'never',
    claim_priority_behavior: 'priority_lowest_first',
    continuous_waivers_behavior: true,
    free_agent_unlock_behavior: 'daily',
    game_lock_behavior: 'first_game',
    drop_lock_behavior: 'lock_with_game',
    same_day_add_drop_rules: 'allow_if_not_played',
    max_claims_per_period: 12,
  },
  SOCCER: {
    sport_type: 'SOCCER',
    waiver_type: 'fcfs',
    processing_days: [],
    FAAB_budget_default: null,
    processing_time_utc: null,
    faab_enabled: false,
    faab_reset_rules: 'never',
    claim_priority_behavior: 'earliest_claim',
    continuous_waivers_behavior: true,
    free_agent_unlock_behavior: 'instant',
    game_lock_behavior: 'slate_lock',
    drop_lock_behavior: 'always_allow_drop',
    same_day_add_drop_rules: 'allow_if_not_played',
    max_claims_per_period: null,
  },
}

const WAIVER_VARIANT_OVERRIDES: Partial<Record<SportType, Record<string, Partial<WaiverDefaults>>>> = {
  NFL: {
    STANDARD: {},
    PPR: { max_claims_per_period: 12 },
    HALF_PPR: { max_claims_per_period: 12 },
    SUPERFLEX: {
      waiver_type: 'rolling',
      faab_enabled: false,
      FAAB_budget_default: null,
      claim_priority_behavior: 'priority_lowest_first',
      free_agent_unlock_behavior: 'after_waiver_run',
      max_claims_per_period: 12,
    },
    IDP: {
      waiver_type: 'faab',
      faab_enabled: true,
      FAAB_budget_default: 100,
      claim_priority_behavior: 'faab_highest',
      game_lock_behavior: 'game_time',
      drop_lock_behavior: 'lock_with_game',
      same_day_add_drop_rules: 'allow_if_not_played',
      max_claims_per_period: 14,
    },
    DYNASTY_IDP: {
      waiver_type: 'faab',
      processing_days: [1, 3, 5],
      processing_time_utc: '12:00',
      faab_enabled: true,
      FAAB_budget_default: 100,
      claim_priority_behavior: 'faab_highest',
      continuous_waivers_behavior: true,
      free_agent_unlock_behavior: 'daily',
      game_lock_behavior: 'game_time',
      drop_lock_behavior: 'lock_with_game',
      same_day_add_drop_rules: 'allow_if_not_played',
      max_claims_per_period: null,
    },
    DEVY_DYNASTY: {
      waiver_type: 'rolling',
      processing_days: [1, 3, 5],
      faab_enabled: false,
      FAAB_budget_default: null,
      claim_priority_behavior: 'priority_lowest_first',
      continuous_waivers_behavior: true,
      free_agent_unlock_behavior: 'daily',
      max_claims_per_period: null,
    },
    MERGED_DEVY_C2C: {
      waiver_type: 'rolling',
      processing_days: [1, 3, 5],
      faab_enabled: false,
      FAAB_budget_default: null,
      claim_priority_behavior: 'priority_lowest_first',
      continuous_waivers_behavior: true,
      free_agent_unlock_behavior: 'daily',
      max_claims_per_period: null,
    },
  },
  NCAAF: {
    IDP: {
      waiver_type: 'faab',
      faab_enabled: true,
      FAAB_budget_default: 100,
      claim_priority_behavior: 'faab_highest',
      game_lock_behavior: 'game_time',
      drop_lock_behavior: 'lock_with_game',
      same_day_add_drop_rules: 'allow_if_not_played',
      max_claims_per_period: 14,
    },
    DYNASTY_IDP: {
      waiver_type: 'faab',
      processing_days: [1, 3, 5],
      processing_time_utc: '12:00',
      faab_enabled: true,
      FAAB_budget_default: 100,
      claim_priority_behavior: 'faab_highest',
      continuous_waivers_behavior: true,
      free_agent_unlock_behavior: 'daily',
      game_lock_behavior: 'game_time',
      drop_lock_behavior: 'lock_with_game',
      same_day_add_drop_rules: 'allow_if_not_played',
      max_claims_per_period: null,
    },
  },
}

function normalizeWaiverVariant(variant?: string | null): string {
  const upper = String(variant ?? '').trim().toUpperCase()
  if (!upper) return 'STANDARD'
  if (upper === 'DEVY') return 'DEVY_DYNASTY'
  if (upper === 'C2C') return 'MERGED_DEVY_C2C'
  return upper
}

/** Team metadata: empty by default; can be populated from external source or DB. */
const TEAM_METADATA_DEFAULTS: Record<SportType, TeamMetadataDefaults> = {
  NFL: { sport_type: 'NFL', teams: [] },
  NBA: { sport_type: 'NBA', teams: [] },
  MLB: { sport_type: 'MLB', teams: [] },
  NHL: { sport_type: 'NHL', teams: [] },
  NCAAF: { sport_type: 'NCAAF', teams: [] },
  NCAAB: { sport_type: 'NCAAB', teams: [] },
  SOCCER: { sport_type: 'SOCCER', teams: [] },
}

export function getLeagueDefaults(sportType: SportType): LeagueDefaults {
  return LEAGUE_DEFAULTS[sportType] ?? LEAGUE_DEFAULTS.NFL
}

/**
 * Get roster defaults for a sport. When formatType is IDP for supported sports, returns football + IDP slots.
 * When formatType is 'devy_dynasty', returns Devy Dynasty roster (devy slots, taxi, etc.).
 */
export function getRosterDefaults(sportType: SportType, formatType?: string): RosterDefaults {
  const base = ROSTER_DEFAULTS[sportType] ?? ROSTER_DEFAULTS.NFL
  if (formatType === 'devy_dynasty' && (sportType === 'NFL' || sportType === 'NCAAF' || sportType === 'NBA')) {
    return DEVY_DYNASTY_ROSTER_DEFAULTS[sportType]
  }
  if (supportsIdpLeagueSport(sportType) && (formatType === 'IDP' || formatType === 'idp' || formatType === 'DYNASTY_IDP')) {
    const overlay = getRosterOverlayForVariant(sportType, 'IDP')
    const starter_slots = { ...base.starter_slots, ...(overlay ?? {}) }
    delete starter_slots.DST
    starter_slots['DL'] = 1
    starter_slots['LB'] = 1
    starter_slots['DB'] = 1
    starter_slots['IDP_FLEX'] = 1
    const flex_definitions = [
      ...base.flex_definitions,
      { slotName: 'DL', allowedPositions: ['DE', 'DT'] },
      { slotName: 'LB', allowedPositions: ['LB', 'ILB', 'OLB'] },
      { slotName: 'DB', allowedPositions: ['CB', 'S'] },
      { slotName: 'IDP_FLEX', allowedPositions: ['DE', 'DT', 'DL', 'LB', 'ILB', 'OLB', 'CB', 'S', 'DB'] },
    ]
    return { ...base, starter_slots, flex_definitions }
  }
  return base
}

function getScoringDefaultsWithVariant(
  sportType: SportType,
  variantOrFormat?: string | null
): ScoringDefaults {
  const base = SCORING_DEFAULTS[sportType] ?? SCORING_DEFAULTS.NFL
  const normalized = String(variantOrFormat ?? '').trim().toUpperCase()
  if (!normalized) return base
  if (supportsIdpLeagueSport(sportType) && (normalized === 'IDP' || normalized === 'DYNASTY_IDP')) {
    const scoringTemplateBase = sportType === 'NCAAF' ? 'default-NCAAF-IDP' : 'default-NFL-IDP'
    return {
      ...base,
      scoring_template_id: scoringTemplateBase,
      scoring_format: 'IDP',
    }
  }
  if (sportType !== 'NFL') return base
  if (normalized === 'HALF_PPR') {
    return {
      ...base,
      scoring_template_id: 'default-NFL-HALF_PPR',
      scoring_format: 'Half PPR',
    }
  }
  if (normalized === 'STANDARD') {
    return {
      ...base,
      scoring_template_id: 'default-NFL-standard',
      scoring_format: 'standard',
    }
  }
  if (normalized === 'TE_PREMIUM') {
    return {
      ...base,
      scoring_template_id: 'NFL_TE_PREMIUM',
      scoring_format: 'PPR',
    }
  }
  return base
}

export function getScoringDefaults(
  sportType: SportType,
  variantOrFormat?: string | null
): ScoringDefaults {
  return getScoringDefaultsWithVariant(sportType, variantOrFormat)
}

/**
 * Get draft defaults for a sport. When formatType is IDP (or DYNASTY_IDP) for supported football sports,
 * returns base sport defaults with IDP-specific rounds. When formatType is 'devy_dynasty',
 * returns rounds sufficient for startup vet (active + bench + taxi); rookie/devy rounds come from DevyLeagueConfig.
 */
export function getDraftDefaults(sportType: SportType, formatType?: string | null): DraftDefaults {
  const base = DRAFT_DEFAULTS[sportType] ?? DRAFT_DEFAULTS.NFL
  const normalizedVariant = (formatType ?? '').trim().toUpperCase()
  const variantLower = (formatType ?? '').trim().toLowerCase()
  // Dynasty-specific defaults: deeper roster startup draft, dynasty ADP ranking
  if (normalizedVariant === 'DYNASTY' && (sportType === 'NFL' || sportType === 'NCAAF')) {
    // Startup draft covers starters(9) + bench(12) + taxi(4) = 25 rounds
    const startupRounds = sportType === 'NCAAF' ? 25 : 25
    const queueLimit = sportType === 'NCAAF' ? 80 : 60
    return {
      ...base,
      rounds_default: startupRounds,
      queue_size_limit: queueLimit,
      pre_draft_ranking_source: 'dynasty_adp',
      roster_fill_order: 'position_scarcity',
      draft_order_rules: 'snake',
      snake_or_linear_behavior: 'snake',
      keeper_dynasty_carryover_supported: true,
    }
  }

  if (normalizedVariant === 'KEEPER' && (sportType === 'NFL' || sportType === 'NCAAF')) {
    return {
      ...base,
      rounds_default: sportType === 'NCAAF' ? 17 : 16,
      queue_size_limit: sportType === 'NCAAF' ? 70 : 60,
      pre_draft_ranking_source: sportType === 'NCAAF' ? 'projections' : 'adp',
      roster_fill_order: 'position_scarcity',
      position_filter_behavior: 'by_eligibility',
      draft_order_rules: 'snake',
      snake_or_linear_behavior: 'snake',
      keeper_dynasty_carryover_supported: true,
    }
  }

  if (variantLower === 'devy_dynasty' && (sportType === 'NFL' || sportType === 'NCAAF' || sportType === 'NBA')) {
    const roster = DEVY_DYNASTY_ROSTER_DEFAULTS[sportType]
    const totalProSlots =
      Object.values(roster.starter_slots).reduce((a, b) => a + b, 0) + roster.bench_slots + roster.taxi_slots
    return {
      ...base,
      rounds_default: totalProSlots,
      queue_size_limit: Math.max(base.queue_size_limit ?? 50, sportType === 'NCAAF' ? 80 : 60),
      pre_draft_ranking_source: sportType === 'NCAAF' ? 'adp_projection_rank_fallback' : 'adp',
      draft_order_rules: 'snake',
      snake_or_linear_behavior: 'snake',
      roster_fill_order: 'position_scarcity',
      position_filter_behavior: 'by_eligibility',
      keeper_dynasty_carryover_supported: true,
    }
  }
  if (supportsIdpLeagueSport(sportType) && (normalizedVariant === 'IDP' || normalizedVariant === 'DYNASTY_IDP')) {
    return {
      ...base,
      rounds_default: 18,
      queue_size_limit: 60,
      pre_draft_ranking_source: 'tiers',
      roster_fill_order: 'position_scarcity',
      position_filter_behavior: 'by_need',
      draft_order_rules: 'snake',
    }
  }
  if (sportType === 'NFL' && normalizedVariant === 'SUPERFLEX') {
    return {
      ...base,
      rounds_default: 16,
      queue_size_limit: 55,
      pre_draft_ranking_source: 'ecr',
      roster_fill_order: 'need_based',
      position_filter_behavior: 'by_need',
      draft_order_rules: 'snake',
    }
  }
  if (sportType === 'NFL' && normalizedVariant === 'PPR') {
    return {
      ...base,
      pre_draft_ranking_source: 'ecr',
      roster_fill_order: 'starter_first',
      position_filter_behavior: 'by_eligibility',
      draft_order_rules: 'snake',
    }
  }
  if (sportType === 'NFL' && normalizedVariant === 'HALF_PPR') {
    return {
      ...base,
      pre_draft_ranking_source: 'adp',
      roster_fill_order: 'starter_first',
      position_filter_behavior: 'by_eligibility',
      draft_order_rules: 'snake',
    }
  }
  return base
}

/**
 * Get waiver defaults for a sport. Optionally pass formatType (e.g. IDP).
 */
export function getWaiverDefaults(sportType: SportType, _formatType?: string | null): WaiverDefaults {
  const base = WAIVER_DEFAULTS[sportType] ?? WAIVER_DEFAULTS.NFL
  const normalizedVariant = normalizeWaiverVariant(_formatType)
  const variantOverrides = WAIVER_VARIANT_OVERRIDES[sportType]?.[normalizedVariant] ?? {}
  return {
    ...base,
    ...variantOverrides,
    sport_type: sportType,
  }
}

export function getTeamMetadataDefaults(sportType: SportType): TeamMetadataDefaults {
  const teams = getTeamMetadataForSport(sportType).map((team) => ({
    team_id: team.team_id,
    team_name: team.team_name,
    city: team.city,
    abbreviation: team.abbreviation,
    primary_logo: team.primary_logo_url,
    alternate_logo: team.alternate_logo_url ?? null,
  }))

  if (teams.length > 0) {
    return {
      sport_type: sportType,
      teams,
    }
  }

  return TEAM_METADATA_DEFAULTS[sportType] ?? TEAM_METADATA_DEFAULTS.NFL
}
