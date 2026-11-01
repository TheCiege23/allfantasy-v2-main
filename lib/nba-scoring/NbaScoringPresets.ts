/**
 * [NEW] lib/nba-scoring/NbaScoringPresets.ts
 * NBA scoring presets: AllFantasy Default, Sleeper, ESPN, Yahoo.
 * Each preset maps stat keys to point values.
 * AF Default loads automatically on new NBA league creation.
 */

export type NbaScoringPresetKey = 'af_default' | 'sleeper_default' | 'espn_default' | 'yahoo_default' | 'custom'

export type NbaScoringSource = 'AF_DEFAULT' | 'PLATFORM_PRESET' | 'IMPORTED_EXACT' | 'IMPORTED_MAPPED' | 'CUSTOM'

export interface NbaScoringPreset {
  key: NbaScoringPresetKey
  label: string
  source: NbaScoringSource
  description: string
  warning?: string
  rules: Record<string, number>
}

/** All supported NBA stat keys for scoring configuration. */
export const NBA_STAT_KEYS = [
  // General
  'points_scored',
  'seconds_played',
  'minutes_played',
  'plus_minus',
  // Shooting
  'field_goals_made',
  'field_goals_attempted',
  'field_goals_missed',
  'two_point_made',
  'two_point_attempted',
  'two_point_missed',
  // Free Throws
  'free_throws_made',
  'free_throws_attempted',
  'free_throws_missed',
  // Three-Point
  'three_point_made',
  'three_point_attempted',
  'three_point_missed',
  // Rebounds
  'rebound',
  'offensive_rebound',
  'defensive_rebound',
  // Playmaking
  'assist',
  'turnover',
  // Defense
  'steal',
  'block',
  // Discipline
  'personal_foul',
  'technical_foul',
  'flagrant_foul',
  // Bonuses
  'double_double',
  'triple_double',
  'forty_plus_points_bonus',
  'fifty_plus_points_bonus',
  'fifteen_plus_assists_bonus',
  'twenty_plus_rebounds_bonus',
  'ten_plus_fg_bonus',
  'five_plus_threes_bonus',
  // Advanced (premium)
  'usage_rate_bonus',
  'efficiency_bonus',
  'true_shooting_bonus',
  'assist_turnover_bonus',
] as const

export type NbaStatKey = (typeof NBA_STAT_KEYS)[number]

/** Human-readable labels for each stat key. */
export const NBA_STAT_LABELS: Record<string, string> = {
  // General
  points_scored: 'Points Scored',
  seconds_played: 'Seconds Played',
  minutes_played: 'Minutes Played',
  plus_minus: 'Plus/Minus',
  // Shooting
  field_goals_made: 'Field Goals Made',
  field_goals_attempted: 'Field Goals Attempted',
  field_goals_missed: 'Field Goals Missed',
  two_point_made: '2-Point Field Goals Made',
  two_point_attempted: '2-Point Field Goals Attempted',
  two_point_missed: '2-Point Field Goals Missed',
  // Free Throws
  free_throws_made: 'Free Throws Made',
  free_throws_attempted: 'Free Throws Attempted',
  free_throws_missed: 'Free Throws Missed',
  // Three-Point
  three_point_made: '3-Point Shots Made',
  three_point_attempted: '3-Point Shots Attempted',
  three_point_missed: '3-Point Shots Missed',
  // Rebounds
  rebound: 'Rebound',
  offensive_rebound: 'Offensive Rebound',
  defensive_rebound: 'Defensive Rebound',
  // Playmaking
  assist: 'Assist',
  turnover: 'Turnover',
  // Defense
  steal: 'Steal',
  block: 'Block',
  // Discipline
  personal_foul: 'Personal Foul',
  technical_foul: 'Technical Foul',
  flagrant_foul: 'Flagrant Foul',
  // Bonuses
  double_double: 'Double-Double',
  triple_double: 'Triple-Double',
  forty_plus_points_bonus: '40+ Points Bonus',
  fifty_plus_points_bonus: '50+ Points Bonus',
  fifteen_plus_assists_bonus: '15+ Assists Bonus',
  twenty_plus_rebounds_bonus: '20+ Rebounds Bonus',
  ten_plus_fg_bonus: '10+ Made Field Goals Bonus',
  five_plus_threes_bonus: '5+ Made 3PT Bonus',
  // Advanced (premium)
  usage_rate_bonus: 'Usage Rate Bonus',
  efficiency_bonus: 'Efficiency Bonus',
  true_shooting_bonus: 'True Shooting Bonus',
  assist_turnover_bonus: 'Assist-to-Turnover Bonus',
}

// ============================================================
// PRESET DEFINITIONS
// ============================================================

const AF_DEFAULT: NbaScoringPreset = {
  key: 'af_default',
  label: 'AllFantasy Default',
  source: 'AF_DEFAULT',
  description: 'Balanced NBA scoring optimized for AllFantasy league types including specialty formats.',
  rules: {
    points_scored: 0.5,
    rebound: 1,
    assist: 1,
    steal: 2,
    block: 2,
    turnover: -1,
    double_double: 1,
    triple_double: 2,
    technical_foul: -2,
    flagrant_foul: -2,
    three_point_made: 0.5,
    forty_plus_points_bonus: 2,
    fifty_plus_points_bonus: 2,
  },
}

const SLEEPER_DEFAULT: NbaScoringPreset = {
  key: 'sleeper_default',
  label: 'Sleeper Default',
  source: 'PLATFORM_PRESET',
  description: 'Sleeper-compatible NBA scoring categories. Based on Sleeper\'s documented default basketball scoring settings.',
  warning: 'This scoring preset is based on Sleeper\'s default format. Specialty leagues (Zombie, Survivor, Tournament, Guilly, Big Brother) are optimized for AllFantasy scoring and may not score exactly as intended under this preset.',
  rules: {
    points_scored: 1,
    rebound: 1,
    assist: 1.5,
    steal: 3,
    block: 3,
    turnover: -1,
    double_double: 1.5,
    triple_double: 3,
    technical_foul: -1,
    three_point_made: 0.5,
  },
}

const ESPN_DEFAULT: NbaScoringPreset = {
  key: 'espn_default',
  label: 'ESPN Default',
  source: 'PLATFORM_PRESET',
  description: 'ESPN default points-league scoring values for NBA.',
  warning: 'This scoring preset is based on ESPN\'s default format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.',
  rules: {
    points_scored: 1,
    three_point_made: 1,
    field_goals_attempted: -1,
    field_goals_made: 2,
    free_throws_attempted: -1,
    free_throws_made: 1,
    rebound: 1,
    assist: 2,
    steal: 4,
    block: 4,
    turnover: -2,
  },
}

const YAHOO_DEFAULT: NbaScoringPreset = {
  key: 'yahoo_default',
  label: 'Yahoo Default',
  source: 'PLATFORM_PRESET',
  description: 'Yahoo default head-to-head points scoring for NBA.',
  warning: 'This scoring preset is based on Yahoo\'s default format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.',
  rules: {
    points_scored: 1,
    rebound: 1.2,
    assist: 1.5,
    block: 3,
    steal: 3,
    turnover: -1,
  },
}

// ============================================================
// REGISTRY
// ============================================================

const PRESET_REGISTRY: Record<NbaScoringPresetKey, NbaScoringPreset> = {
  af_default: AF_DEFAULT,
  sleeper_default: SLEEPER_DEFAULT,
  espn_default: ESPN_DEFAULT,
  yahoo_default: YAHOO_DEFAULT,
  custom: {
    key: 'custom',
    label: 'Custom',
    source: 'CUSTOM',
    description: 'Custom scoring values. Start from any preset and edit individual stat values.',
    rules: { ...AF_DEFAULT.rules },
  },
}

/** Get all available NBA scoring presets. */
export function getNbaScoringPresets(): NbaScoringPreset[] {
  return Object.values(PRESET_REGISTRY)
}

/** Get a specific preset by key. */
export function getNbaScoringPreset(key: NbaScoringPresetKey): NbaScoringPreset {
  return PRESET_REGISTRY[key] ?? PRESET_REGISTRY.af_default
}

/** Get the AF default preset. */
export function getAfDefaultNbaScoring(): NbaScoringPreset {
  return PRESET_REGISTRY.af_default
}

/** Check if a scoring config still matches a known preset. */
export function detectPresetMatch(rules: Record<string, number>): NbaScoringPresetKey | null {
  for (const preset of [AF_DEFAULT, SLEEPER_DEFAULT, ESPN_DEFAULT, YAHOO_DEFAULT]) {
    const keys = Object.keys(preset.rules)
    const nonZeroConfig = Object.entries(rules).filter(([, v]) => v !== 0)
    if (nonZeroConfig.length !== keys.length) continue
    const matches = keys.every((k) => Math.abs((rules[k] ?? 0) - (preset.rules[k] ?? 0)) < 0.001)
    if (matches) return preset.key
  }
  return null
}

/** Build a full scoring config with all stat keys, using preset values + zeros for unset keys. */
export function buildFullScoringConfig(presetKey: NbaScoringPresetKey): Record<string, number> {
  const preset = getNbaScoringPreset(presetKey)
  const config: Record<string, number> = {}
  for (const key of NBA_STAT_KEYS) {
    config[key] = preset.rules[key] ?? 0
  }
  return config
}
