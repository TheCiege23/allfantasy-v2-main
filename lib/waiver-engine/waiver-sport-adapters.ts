/**
 * Waiver Sport Adapters
 *
 * Sport-specific tuning for opportunity signals, role/usage indicators,
 * projection logic, scarcity, injury replacement, stash, and streaming.
 * Shared architecture with per-sport adapters.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WaiverSport = 'NFL' | 'NBA' | 'MLB' | 'NHL' | 'NCAAF' | 'NCAAB' | 'SOCCER'

interface SportWaiverAdapter {
  sport: WaiverSport
  /** Position scarcity multipliers (higher = more scarce) */
  positionScarcity: Record<string, number>
  /** Key opportunity signal types for this sport */
  opportunitySignals: string[]
  /** How to identify a streamer in this sport */
  streamerIndicators: string[]
  /** How to identify a stash in this sport */
  stashIndicators: string[]
  /** Injury replacement value factors */
  injuryReplacementFactor: Record<string, number>
  /** Playoff stash logic */
  playoffStashPositions: string[]
  /** Position-specific projection weight adjustments */
  projectionWeights: Record<string, number>
  /** Whether bye weeks are relevant */
  hasByeWeeks: boolean
  /** Whether back-to-backs matter */
  hasBackToBacks: boolean
  /** Whether schedule volume matters */
  hasScheduleVolume: boolean
}

// ---------------------------------------------------------------------------
// NFL Adapter
// ---------------------------------------------------------------------------

const NFL_ADAPTER: SportWaiverAdapter = {
  sport: 'NFL',
  positionScarcity: { QB: 0.7, RB: 1.0, WR: 0.85, TE: 0.6, K: 0.2, DEF: 0.2, LB: 0.3, DL: 0.3, DB: 0.3 },
  opportunitySignals: [
    'snap_share_increase', 'target_share_increase', 'touch_count_surge',
    'depth_chart_promotion', 'handcuff_with_path', 'redzone_usage',
    'route_participation_rate', 'air_yards_share',
  ],
  streamerIndicators: ['favorable_matchup', 'opponent_allows_position', 'weather_boost', 'game_script_favorable'],
  stashIndicators: ['rookie_snap_trend', 'backup_behind_aging_starter', 'camp_buzz', 'new_offensive_scheme'],
  injuryReplacementFactor: { QB: 1.5, RB: 1.3, WR: 1.0, TE: 0.8 },
  playoffStashPositions: ['RB', 'WR'],
  projectionWeights: { QB: 1.0, RB: 1.1, WR: 1.0, TE: 0.9, K: 0.5, DEF: 0.5 },
  hasByeWeeks: true,
  hasBackToBacks: false,
  hasScheduleVolume: false,
}

// ---------------------------------------------------------------------------
// NBA Adapter
// ---------------------------------------------------------------------------

const NBA_ADAPTER: SportWaiverAdapter = {
  sport: 'NBA',
  positionScarcity: { PG: 0.8, SG: 0.7, SF: 0.75, PF: 0.75, C: 0.9, G: 0.6, F: 0.6, UTIL: 0.4 },
  opportunitySignals: [
    'minutes_increase', 'usage_rate_surge', 'injury_created_role',
    'starter_promotion', 'category_coverage', 'triple_double_upside',
    'free_throw_rate', 'stocks_contributor',
  ],
  streamerIndicators: ['back_to_back_week', 'four_game_week', 'blowout_proof_role', 'opponent_pace'],
  stashIndicators: ['minutes_trending_up', 'rookie_development', 'trade_deadline_beneficiary', 'injury_return_imminent'],
  injuryReplacementFactor: { PG: 1.2, SG: 1.0, SF: 1.0, PF: 1.0, C: 1.3 },
  playoffStashPositions: ['PG', 'C'],
  projectionWeights: { PG: 1.0, SG: 0.95, SF: 1.0, PF: 1.0, C: 1.05 },
  hasByeWeeks: false,
  hasBackToBacks: true,
  hasScheduleVolume: true,
}

// ---------------------------------------------------------------------------
// MLB Adapter
// ---------------------------------------------------------------------------

const MLB_ADAPTER: SportWaiverAdapter = {
  sport: 'MLB',
  positionScarcity: { SP: 1.2, RP: 0.7, C: 0.9, '1B': 0.6, '2B': 0.75, '3B': 0.75, SS: 0.85, OF: 0.6, DH: 0.5 },
  opportunitySignals: [
    'lineup_spot_promotion', 'saves_holds_path', 'callup_probability',
    'platoon_side_advantage', 'schedule_volume', 'batting_order_rise',
    'two_start_pitcher_week', 'swinging_strike_rate',
  ],
  streamerIndicators: ['two_start_week', 'weak_opponent_pitching', 'hitter_friendly_park', 'platoon_advantage'],
  stashIndicators: ['prospect_callup_watch', 'closer_role_change', 'lineup_spot_earned', 'minor_league_dominance'],
  injuryReplacementFactor: { SP: 1.4, RP: 1.0, C: 1.1, SS: 1.0, OF: 0.8 },
  playoffStashPositions: ['SP', 'RP'],
  projectionWeights: { SP: 1.15, RP: 0.8, C: 0.9, '1B': 1.0, '2B': 1.0, '3B': 1.0, SS: 1.05, OF: 0.95 },
  hasByeWeeks: false,
  hasBackToBacks: false,
  hasScheduleVolume: true,
}

// ---------------------------------------------------------------------------
// NHL Adapter
// ---------------------------------------------------------------------------

const NHL_ADAPTER: SportWaiverAdapter = {
  sport: 'NHL',
  positionScarcity: { C: 0.85, LW: 0.7, RW: 0.7, D: 0.8, G: 1.0, UTIL: 0.4 },
  opportunitySignals: [
    'line_promotion', 'power_play_role', 'shot_volume_increase',
    'goalie_start_frequency', 'even_strength_usage', 'line_mate_quality',
    'penalty_kill_role', 'category_coverage',
  ],
  streamerIndicators: ['goalie_start_confirmed', 'favorable_opponent', 'high_shot_volume_expected', 'back_to_back_starts'],
  stashIndicators: ['line_promotion_trend', 'power_play_unit_change', 'injury_return', 'callup_from_ahl'],
  injuryReplacementFactor: { C: 1.2, LW: 1.0, RW: 1.0, D: 0.9, G: 1.5 },
  playoffStashPositions: ['G', 'C'],
  projectionWeights: { C: 1.05, LW: 1.0, RW: 1.0, D: 0.95, G: 1.1 },
  hasByeWeeks: false,
  hasBackToBacks: true,
  hasScheduleVolume: true,
}

// ---------------------------------------------------------------------------
// Soccer Adapter
// ---------------------------------------------------------------------------

const SOCCER_ADAPTER: SportWaiverAdapter = {
  sport: 'SOCCER',
  positionScarcity: { GKP: 0.5, DEF: 0.6, MID: 0.9, FWD: 1.1 },
  opportunitySignals: [
    'minutes_security', 'set_piece_duty', 'clean_sheet_odds',
    'attacking_returns', 'bonus_point_magnet', 'fixture_difficulty',
    'expected_goals', 'expected_assists',
  ],
  streamerIndicators: ['double_gameweek', 'weak_fixture_run', 'penalty_taker', 'clean_sheet_fixture'],
  stashIndicators: ['new_signing_integration', 'returning_from_injury', 'manager_rotation_favorite', 'cup_competition_likely'],
  injuryReplacementFactor: { GKP: 0.8, DEF: 0.7, MID: 1.1, FWD: 1.3 },
  playoffStashPositions: ['MID', 'FWD'],
  projectionWeights: { GKP: 0.7, DEF: 0.85, MID: 1.1, FWD: 1.2 },
  hasByeWeeks: false,
  hasBackToBacks: false,
  hasScheduleVolume: true,
}

// ---------------------------------------------------------------------------
// College Adapters
// ---------------------------------------------------------------------------

const NCAAF_ADAPTER: SportWaiverAdapter = {
  ...NFL_ADAPTER,
  sport: 'NCAAF',
  stashIndicators: ['transfer_portal_add', 'depth_chart_change', 'qb_competition_winner', 'offensive_scheme_change'],
  playoffStashPositions: ['QB', 'RB'],
}

const NCAAB_ADAPTER: SportWaiverAdapter = {
  ...NBA_ADAPTER,
  sport: 'NCAAB',
  stashIndicators: ['transfer_portal_add', 'minutes_increase', 'conference_play_usage', 'key_player_injury_on_team'],
  playoffStashPositions: ['PG', 'C'],
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const ADAPTER_REGISTRY: Record<WaiverSport, SportWaiverAdapter> = {
  NFL: NFL_ADAPTER,
  NBA: NBA_ADAPTER,
  MLB: MLB_ADAPTER,
  NHL: NHL_ADAPTER,
  NCAAF: NCAAF_ADAPTER,
  NCAAB: NCAAB_ADAPTER,
  SOCCER: SOCCER_ADAPTER,
}

export function getWaiverSportAdapter(sport: string): SportWaiverAdapter {
  const key = sport.toUpperCase() as WaiverSport
  return ADAPTER_REGISTRY[key] ?? ADAPTER_REGISTRY.NFL
}

