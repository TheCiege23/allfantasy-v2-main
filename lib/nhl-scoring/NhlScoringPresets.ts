/**
 * [NEW] lib/nhl-scoring/NhlScoringPresets.ts
 * NHL scoring presets: AllFantasy Default, Sleeper-Compatible, ESPN-Compatible, Yahoo Default.
 * Split into Skaters and Goalies categories.
 */

export type NhlScoringPresetKey = 'af_default' | 'sleeper_compatible' | 'espn_compatible' | 'yahoo_default' | 'custom'
export type NhlScoringSource = 'AF_DEFAULT' | 'PLATFORM_PRESET' | 'IMPORTED_EXACT' | 'IMPORTED_MAPPED' | 'CUSTOM'

export interface NhlScoringPreset {
  key: NhlScoringPresetKey
  label: string
  source: NhlScoringSource
  description: string
  warning?: string
  rules: Record<string, number>
}

export const NHL_SKATER_STAT_KEYS = [
  'goals', 'assists', 'points', 'plus_minus',
  'power_play_goals', 'power_play_assists', 'power_play_points',
  'short_handed_goals', 'short_handed_assists', 'short_handed_points',
  'game_winning_goals', 'overtime_goals', 'shots_on_goal', 'shooting_pct_bonus',
  'hits', 'blocked_shots', 'penalty_minutes', 'faceoff_wins', 'faceoff_losses',
  'hat_trick_bonus', 'gordie_howe_hat_trick_bonus', 'takeaways', 'giveaways',
] as const

export const NHL_GOALIE_STAT_KEYS = [
  'goalie_wins', 'goalie_losses', 'overtime_losses', 'saves', 'goals_against',
  'shots_against', 'shutouts', 'save_pct_bonus', 'gaa_bonus',
  'goalie_minutes_played', 'empty_net_goals_against',
  'goalie_assists', 'goalie_goals', 'goalie_penalty_minutes',
] as const

export const NHL_STAT_KEYS = [...NHL_SKATER_STAT_KEYS, ...NHL_GOALIE_STAT_KEYS] as const
export type NhlStatKey = (typeof NHL_STAT_KEYS)[number]

export const NHL_STAT_LABELS: Record<string, string> = {
  goals: 'Goals', assists: 'Assists', points: 'Points', plus_minus: 'Plus/Minus',
  power_play_goals: 'Power Play Goals', power_play_assists: 'Power Play Assists', power_play_points: 'Power Play Points',
  short_handed_goals: 'Short-Handed Goals', short_handed_assists: 'Short-Handed Assists', short_handed_points: 'Short-Handed Points',
  game_winning_goals: 'Game-Winning Goals', overtime_goals: 'Overtime Goals',
  shots_on_goal: 'Shots on Goal', shooting_pct_bonus: 'Shooting % Bonus',
  hits: 'Hits', blocked_shots: 'Blocked Shots', penalty_minutes: 'Penalty Minutes',
  faceoff_wins: 'Faceoff Wins', faceoff_losses: 'Faceoff Losses',
  hat_trick_bonus: 'Hat Trick Bonus', gordie_howe_hat_trick_bonus: 'Gordie Howe Hat Trick Bonus',
  takeaways: 'Takeaways', giveaways: 'Giveaways',
  goalie_wins: 'Wins', goalie_losses: 'Losses', overtime_losses: 'Overtime Losses',
  saves: 'Saves', goals_against: 'Goals Against', shots_against: 'Shots Against',
  shutouts: 'Shutouts', save_pct_bonus: 'Save % Bonus', gaa_bonus: 'GAA Bonus',
  goalie_minutes_played: 'Minutes Played', empty_net_goals_against: 'Empty Net Goals Against',
  goalie_assists: 'Goalie Assists', goalie_goals: 'Goalie Goals', goalie_penalty_minutes: 'Goalie Penalty Minutes',
}

const AF_DEFAULT: NhlScoringPreset = {
  key: 'af_default', label: 'AllFantasy Default', source: 'AF_DEFAULT',
  description: 'Balanced NHL scoring optimized for AllFantasy league types including specialty formats.',
  rules: {
    goals: 3, assists: 2, plus_minus: 1, power_play_points: 0.5, short_handed_points: 1,
    shots_on_goal: 0.5, hits: 0.3, blocked_shots: 0.5,
    penalty_minutes: -0.25, faceoff_wins: 0.1, faceoff_losses: -0.05, hat_trick_bonus: 2,
    goalie_wins: 3, saves: 0.2, goals_against: -1, shutouts: 2,
  },
}

const SLEEPER_COMPATIBLE: NhlScoringPreset = {
  key: 'sleeper_compatible', label: 'Sleeper-Compatible', source: 'PLATFORM_PRESET',
  description: 'Sleeper-compatible NHL scoring. Note: Sleeper does not currently offer standard fantasy hockey leagues. This is a compatibility preset.',
  warning: 'Sleeper does not currently support fantasy hockey leagues. This preset uses a Sleeper-friendly points structure but is not an official Sleeper preset. Specialty leagues are optimized for AllFantasy scoring.',
  rules: {
    goals: 3, assists: 2, shots_on_goal: 0.5, blocked_shots: 0.5,
    power_play_points: 0.5, short_handed_points: 0.5, plus_minus: 1,
    goalie_wins: 3, goals_against: -1, saves: 0.2, shutouts: 2,
  },
}

const ESPN_COMPATIBLE: NhlScoringPreset = {
  key: 'espn_compatible', label: 'ESPN-Compatible', source: 'PLATFORM_PRESET',
  description: 'ESPN-compatible NHL H2H points baseline. ESPN supports retroactive recalculation when scoring changes.',
  warning: 'This scoring preset is based on ESPN\'s format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.',
  rules: {
    goals: 3, assists: 2, plus_minus: 1, power_play_points: 1,
    shots_on_goal: 0.5, hits: 0.5, blocked_shots: 0.5,
    goalie_wins: 3, saves: 0.2, goals_against: -1, shutouts: 2,
  },
}

const YAHOO_DEFAULT: NhlScoringPreset = {
  key: 'yahoo_default', label: 'Yahoo Default', source: 'PLATFORM_PRESET',
  description: 'Yahoo default H2H points scoring for NHL. Yahoo uses Head-to-Head Points as the default private-league scoring type.',
  warning: 'This scoring preset is based on Yahoo\'s default format. Specialty leagues are optimized for AllFantasy scoring and may not score exactly as intended under this preset.',
  rules: {
    goals: 3, assists: 2, plus_minus: 1, power_play_points: 1,
    shots_on_goal: 0.5, hits: 0.25, blocked_shots: 0.25,
    goalie_wins: 3, saves: 0.2, goals_against: -1, shutouts: 2,
  },
}

const PRESET_REGISTRY: Record<NhlScoringPresetKey, NhlScoringPreset> = {
  af_default: AF_DEFAULT, sleeper_compatible: SLEEPER_COMPATIBLE,
  espn_compatible: ESPN_COMPATIBLE, yahoo_default: YAHOO_DEFAULT,
  custom: { key: 'custom', label: 'Custom', source: 'CUSTOM', description: 'Custom scoring values.', rules: { ...AF_DEFAULT.rules } },
}

export function getNhlScoringPresets(): NhlScoringPreset[] { return Object.values(PRESET_REGISTRY) }
export function getNhlScoringPreset(key: NhlScoringPresetKey): NhlScoringPreset { return PRESET_REGISTRY[key] ?? PRESET_REGISTRY.af_default }
export function getAfDefaultNhlScoring(): NhlScoringPreset { return PRESET_REGISTRY.af_default }

export function detectNhlPresetMatch(rules: Record<string, number>): NhlScoringPresetKey | null {
  for (const preset of [AF_DEFAULT, SLEEPER_COMPATIBLE, ESPN_COMPATIBLE, YAHOO_DEFAULT]) {
    const keys = Object.keys(preset.rules)
    const nonZero = Object.entries(rules).filter(([, v]) => v !== 0)
    if (nonZero.length !== keys.length) continue
    if (keys.every((k) => Math.abs((rules[k] ?? 0) - (preset.rules[k] ?? 0)) < 0.001)) return preset.key
  }
  return null
}

export function buildFullNhlScoringConfig(presetKey: NhlScoringPresetKey): Record<string, number> {
  const preset = getNhlScoringPreset(presetKey)
  const config: Record<string, number> = {}
  for (const key of NHL_STAT_KEYS) config[key] = preset.rules[key] ?? 0
  return config
}
