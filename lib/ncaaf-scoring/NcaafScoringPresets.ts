/**
 * [NEW] lib/ncaaf-scoring/NcaafScoringPresets.ts
 * NCAAF scoring presets: AF Default, Sleeper-Compatible, ESPN-Compatible, Yahoo-Compatible.
 * Covers Offense, Kicking, DST (if used), and yardage/TD bonuses.
 * Note: Sleeper/ESPN/Yahoo do not offer dedicated NCAAF fantasy products the same
 * way they do NFL, so all external presets are labeled as "compatible" baselines.
 */

export type NcaafScoringPresetKey = 'af_default' | 'sleeper_compatible' | 'espn_compatible' | 'yahoo_compatible' | 'custom'
export type NcaafScoringSource = 'AF_DEFAULT' | 'PLATFORM_PRESET' | 'IMPORTED_EXACT' | 'IMPORTED_MAPPED' | 'CUSTOM'

export interface NcaafScoringPreset {
  key: NcaafScoringPresetKey
  label: string
  source: NcaafScoringSource
  description: string
  warning?: string
  rules: Record<string, number>
}

export const NCAAF_PASSING_KEYS = [
  'passing_yards', 'passing_td', 'passing_first_down', 'passing_2pt', 'interception_thrown',
  'completion', 'incomplete_pass', 'passing_attempt', 'qb_sacked',
  'forty_yd_pass_td_bonus', 'three_hundred_yd_pass_bonus', 'four_hundred_yd_pass_bonus',
] as const

export const NCAAF_RUSHING_KEYS = [
  'rushing_yards', 'rushing_td', 'rushing_first_down', 'rushing_2pt', 'rush_attempt',
  'forty_yd_rush_bonus', 'forty_yd_rush_td_bonus',
  'one_hundred_yd_rush_bonus', 'two_hundred_yd_rush_bonus',
] as const

export const NCAAF_RECEIVING_KEYS = [
  'reception', 'te_premium', 'receiving_yards', 'receiving_td', 'receiving_first_down', 'receiving_2pt', 'target',
  'forty_yd_reception_bonus', 'forty_yd_rec_td_bonus',
  'one_hundred_yd_rec_bonus', 'two_hundred_yd_rec_bonus',
] as const

export const NCAAF_MISC_KEYS = [
  'fumble', 'fumble_lost', 'fumble_recovery', 'off_fumble_recovery_td', 'return_yards', 'return_td',
] as const

export const NCAAF_KICKING_KEYS = [
  'fg_made', 'fg_missed', 'pat_made', 'pat_missed', 'fg_0_19', 'fg_20_29', 'fg_30_39', 'fg_40_49', 'fg_50_plus',
  'fg_missed_0_39', 'fg_missed_40_49', 'fg_missed_50_plus',
] as const

export const NCAAF_DST_KEYS = [
  'dst_sack', 'dst_interception', 'dst_fumble_recovery', 'dst_safety', 'dst_td', 'dst_blocked_kick',
  'dst_return_td', 'dst_2pt_return',
  'dst_pa_0', 'dst_pa_1_6', 'dst_pa_7_13', 'dst_pa_14_20', 'dst_pa_21_27', 'dst_pa_28_34', 'dst_pa_35_plus',
] as const

export const NCAAF_IDP_KEYS = ['idp_solo_tackle', 'idp_tackle', 'idp_sack', 'idp_pass_defended', 'idp_tackle_for_loss', 'idp_td', 'idp_interception', 'idp_int_return_yards'] as const

export const NCAAF_STAT_KEYS = [
  ...NCAAF_PASSING_KEYS, ...NCAAF_RUSHING_KEYS, ...NCAAF_RECEIVING_KEYS,
  ...NCAAF_MISC_KEYS, ...NCAAF_KICKING_KEYS, ...NCAAF_DST_KEYS, ...NCAAF_IDP_KEYS,
] as const

export type NcaafStatKey = (typeof NCAAF_STAT_KEYS)[number]

export const NCAAF_STAT_LABELS: Record<string, string> = {
  passing_yards: 'Passing Yards', passing_td: 'Passing TD', passing_first_down: 'Passing 1st Down',
  passing_2pt: 'Passing 2PT', interception_thrown: 'INT Thrown',
  completion: 'Completion', incomplete_pass: 'Incomplete Pass', passing_attempt: 'Pass Attempt', qb_sacked: 'QB Sacked',
  forty_yd_pass_td_bonus: '40+ Yd Pass TD', three_hundred_yd_pass_bonus: '300+ Pass Yards', four_hundred_yd_pass_bonus: '400+ Pass Yards',
  rushing_yards: 'Rushing Yards', rushing_td: 'Rushing TD', rushing_first_down: 'Rushing 1st Down',
  rushing_2pt: 'Rushing 2PT', rush_attempt: 'Rush Attempt',
  forty_yd_rush_bonus: '40+ Yd Rush', forty_yd_rush_td_bonus: '40+ Yd Rush TD',
  one_hundred_yd_rush_bonus: '100+ Rush Yards', two_hundred_yd_rush_bonus: '200+ Rush Yards',
  reception: 'Reception', te_premium: 'TE Reception Bonus', receiving_yards: 'Receiving Yards', receiving_td: 'Receiving TD',
  receiving_first_down: 'Receiving 1st Down', receiving_2pt: 'Receiving 2PT', target: 'Target',
  forty_yd_reception_bonus: '40+ Yd Reception', forty_yd_rec_td_bonus: '40+ Yd Rec TD',
  one_hundred_yd_rec_bonus: '100+ Rec Yards', two_hundred_yd_rec_bonus: '200+ Rec Yards',
  fumble: 'Fumble', fumble_lost: 'Fumble Lost', fumble_recovery: 'Fumble Recovery',
  off_fumble_recovery_td: 'Off Fumble Rec TD', return_yards: 'Return Yards', return_td: 'Return TD',
  fg_made: 'FG Made', fg_missed: 'FG Missed',
  pat_made: 'PAT Made', pat_missed: 'PAT Missed',
  fg_0_19: 'FG 0-19', fg_20_29: 'FG 20-29', fg_30_39: 'FG 30-39', fg_40_49: 'FG 40-49', fg_50_plus: 'FG 50+',
  fg_missed_0_39: 'FG Miss 0-39', fg_missed_40_49: 'FG Miss 40-49', fg_missed_50_plus: 'FG Miss 50+',
  dst_sack: 'DST Sack', dst_interception: 'DST INT', dst_fumble_recovery: 'DST Fumble Rec',
  dst_safety: 'DST Safety', dst_td: 'DST TD', dst_blocked_kick: 'DST Blocked Kick',
  dst_return_td: 'DST Return TD', dst_2pt_return: 'DST 2PT Return',
  dst_pa_0: 'PA: 0 (Shutout)', dst_pa_1_6: 'PA: 1-6', dst_pa_7_13: 'PA: 7-13', dst_pa_14_20: 'PA: 14-20',
  dst_pa_21_27: 'PA: 21-27', dst_pa_28_34: 'PA: 28-34', dst_pa_35_plus: 'PA: 35+',
}

const COMMON_DST = {
  dst_sack: 1, dst_interception: 2, dst_fumble_recovery: 2, dst_safety: 2, dst_td: 6, dst_blocked_kick: 2,
  dst_return_td: 6, dst_2pt_return: 2,
  dst_pa_0: 10, dst_pa_1_6: 7, dst_pa_7_13: 4, dst_pa_14_20: 1, dst_pa_21_27: 0, dst_pa_28_34: -1, dst_pa_35_plus: -4,
}

const AF_DEFAULT: NcaafScoringPreset = {
  key: 'af_default', label: 'AllFantasy Default', source: 'AF_DEFAULT',
  description: 'Balanced NCAAF scoring with PPR and yardage bonuses, optimized for AllFantasy specialty leagues.',
  rules: {
    passing_yards: 0.04, passing_td: 4, interception_thrown: -2, passing_2pt: 2,
    rushing_yards: 0.1, rushing_td: 6, rushing_2pt: 2,
    receiving_yards: 0.1, reception: 1, receiving_td: 6, receiving_2pt: 2,
    return_td: 6, fumble_lost: -2, off_fumble_recovery_td: 6,
    three_hundred_yd_pass_bonus: 3, four_hundred_yd_pass_bonus: 3,
    one_hundred_yd_rush_bonus: 3, two_hundred_yd_rush_bonus: 3,
    one_hundred_yd_rec_bonus: 3, two_hundred_yd_rec_bonus: 3,
    pat_made: 1, pat_missed: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5,
    fg_missed_0_39: -1,
    ...COMMON_DST,
  },
}

const SLEEPER_COMPATIBLE: NcaafScoringPreset = {
  key: 'sleeper_compatible', label: 'Sleeper-Compatible', source: 'PLATFORM_PRESET',
  description: 'Sleeper-compatible NCAAF scoring. Sleeper does not currently offer dedicated college football fantasy. This uses a Sleeper-style PPR structure.',
  warning: 'Sleeper does not currently support NCAAF fantasy leagues. This is a compatibility preset. Specialty leagues are optimized for AllFantasy scoring.',
  rules: {
    passing_yards: 0.04, passing_td: 4, interception_thrown: -1, passing_2pt: 2,
    rushing_yards: 0.1, rushing_td: 6, rushing_2pt: 2,
    receiving_yards: 0.1, reception: 1, receiving_td: 6, receiving_2pt: 2,
    return_td: 6, fumble_lost: -2,
    pat_made: 1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5,
    ...COMMON_DST,
  },
}

const ESPN_COMPATIBLE: NcaafScoringPreset = {
  key: 'espn_compatible', label: 'ESPN-Compatible', source: 'PLATFORM_PRESET',
  description: 'ESPN-compatible NCAAF scoring baseline.',
  warning: 'This preset is a compatible baseline for ESPN-style scoring. Specialty leagues are optimized for AllFantasy scoring.',
  rules: {
    passing_yards: 0.04, passing_td: 4, interception_thrown: -2, passing_2pt: 2,
    rushing_yards: 0.1, rushing_td: 6, rushing_2pt: 2,
    receiving_yards: 0.1, reception: 0, receiving_td: 6, receiving_2pt: 2,
    return_td: 6, fumble_lost: -2,
    pat_made: 1, pat_missed: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5,
    ...COMMON_DST,
  },
}

const YAHOO_COMPATIBLE: NcaafScoringPreset = {
  key: 'yahoo_compatible', label: 'Yahoo-Compatible', source: 'PLATFORM_PRESET',
  description: 'Yahoo-compatible NCAAF scoring baseline with 0.5 PPR.',
  warning: 'This preset is a compatible baseline for Yahoo-style scoring. Specialty leagues are optimized for AllFantasy scoring.',
  rules: {
    passing_yards: 0.04, passing_td: 4, interception_thrown: -1, passing_2pt: 2,
    rushing_yards: 0.1, rushing_td: 6, rushing_2pt: 2,
    receiving_yards: 0.1, reception: 0.5, receiving_td: 6, receiving_2pt: 2,
    return_td: 6, fumble_lost: -2, off_fumble_recovery_td: 6,
    pat_made: 1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5,
    ...COMMON_DST,
  },
}

const PRESET_REGISTRY: Record<NcaafScoringPresetKey, NcaafScoringPreset> = {
  af_default: AF_DEFAULT, sleeper_compatible: SLEEPER_COMPATIBLE,
  espn_compatible: ESPN_COMPATIBLE, yahoo_compatible: YAHOO_COMPATIBLE,
  custom: { key: 'custom', label: 'Custom', source: 'CUSTOM', description: 'Custom scoring values.', rules: { ...AF_DEFAULT.rules } },
}

export function getNcaafScoringPresets(): NcaafScoringPreset[] { return Object.values(PRESET_REGISTRY) }
export function getNcaafScoringPreset(key: NcaafScoringPresetKey): NcaafScoringPreset { return PRESET_REGISTRY[key] ?? PRESET_REGISTRY.af_default }

export function detectNcaafPresetMatch(rules: Record<string, number>): NcaafScoringPresetKey | null {
  for (const preset of [AF_DEFAULT, SLEEPER_COMPATIBLE, ESPN_COMPATIBLE, YAHOO_COMPATIBLE]) {
    const keys = Object.keys(preset.rules)
    const nonZero = Object.entries(rules).filter(([, v]) => v !== 0)
    if (nonZero.length !== keys.length) continue
    if (keys.every((k) => Math.abs((rules[k] ?? 0) - (preset.rules[k] ?? 0)) < 0.001)) return preset.key
  }
  return null
}

export function buildFullNcaafScoringConfig(presetKey: NcaafScoringPresetKey): Record<string, number> {
  const preset = getNcaafScoringPreset(presetKey)
  const config: Record<string, number> = {}
  for (const key of NCAAF_STAT_KEYS) config[key] = preset.rules[key] ?? 0
  for (const [key, points] of Object.entries({ idp_solo_tackle: 1, idp_tackle: 0, idp_sack: 3, idp_pass_defended: 1, idp_tackle_for_loss: 1, idp_td: 6, idp_interception: 4, idp_int_return_yards: 0 })) config[key] = preset.rules[key] ?? points
  config.fg_made = preset.rules.fg_made ?? 3
  return config
}
