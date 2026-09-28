/**
 * [NEW] lib/nfl-scoring/NflScoringPresets.ts
 * NFL scoring presets: AF Default, Sleeper, ESPN Standard, ESPN PPR, Yahoo.
 * Covers Offense, Kicking, DST, and optional IDP.
 */

export type NflScoringPresetKey = 'af_default' | 'af_ppr' | 'af_standard' | 'sleeper_default' | 'espn_standard' | 'espn_ppr' | 'yahoo_default' | 'custom'
export type NflScoringSource = 'AF_DEFAULT' | 'PLATFORM_PRESET' | 'IMPORTED_EXACT' | 'IMPORTED_MAPPED' | 'CUSTOM'

export interface NflScoringPreset {
  key: NflScoringPresetKey
  label: string
  source: NflScoringSource
  description: string
  warning?: string
  rules: Record<string, number>
}

// ============================================================
// STAT KEY DEFINITIONS BY CATEGORY
// ============================================================

export const NFL_PASSING_KEYS = [
  'passing_yards', 'passing_td', 'passing_first_down', 'passing_2pt', 'interception_thrown', 'pick_6_thrown',
  'completion', 'incomplete_pass', 'passing_attempt', 'qb_sacked',
  'forty_yd_completion_bonus', 'forty_yd_pass_td_bonus', 'three_hundred_yd_pass_bonus', 'four_hundred_yd_pass_bonus',
] as const

export const NFL_RUSHING_KEYS = [
  'rushing_yards', 'rushing_td', 'rushing_first_down', 'rushing_2pt', 'rush_attempt',
  'forty_yd_rush_bonus', 'forty_yd_rush_td_bonus', 'one_hundred_yd_rush_bonus', 'two_hundred_yd_rush_bonus',
] as const

export const NFL_RECEIVING_KEYS = [
  'reception', 'receiving_yards', 'receiving_td', 'receiving_first_down', 'receiving_2pt', 'target',
  'forty_yd_reception_bonus', 'forty_yd_rec_td_bonus', 'one_hundred_yd_rec_bonus', 'two_hundred_yd_rec_bonus',
] as const

export const NFL_MISC_OFFENSE_KEYS = [
  'fumble', 'fumble_lost', 'fumble_recovery', 'off_fumble_recovery_td', 'return_yards', 'return_td',
] as const

export const NFL_KICKING_KEYS = [
  'pat_made', 'pat_missed', 'fg_0_19', 'fg_20_29', 'fg_30_39', 'fg_40_49', 'fg_50_plus',
  'fg_missed_0_19', 'fg_missed_20_29', 'fg_missed_30_39', 'fg_missed_40_49', 'fg_missed_50_plus',
] as const

export const NFL_DST_KEYS = [
  'dst_sack', 'dst_interception', 'dst_fumble_recovery', 'dst_safety', 'dst_td', 'dst_blocked_kick',
  'dst_kick_return_td', 'dst_punt_return_td', 'dst_2pt_return',
  'dst_pa_0', 'dst_pa_1_6', 'dst_pa_7_13', 'dst_pa_14_20', 'dst_pa_21_27', 'dst_pa_28_34', 'dst_pa_35_plus',
] as const

export const NFL_IDP_KEYS = [
  'idp_tackle', 'idp_solo_tackle', 'idp_assisted_tackle', 'idp_tackle_for_loss', 'idp_sack', 'idp_qb_hit',
  'idp_pass_defended', 'idp_interception', 'idp_fumble_forced', 'idp_fumble_recovery', 'idp_td', 'idp_safety', 'idp_blocked_kick',
] as const

export const NFL_STAT_KEYS = [
  ...NFL_PASSING_KEYS, ...NFL_RUSHING_KEYS, ...NFL_RECEIVING_KEYS,
  ...NFL_MISC_OFFENSE_KEYS, ...NFL_KICKING_KEYS, ...NFL_DST_KEYS, ...NFL_IDP_KEYS,
] as const

export type NflStatKey = (typeof NFL_STAT_KEYS)[number]

export const NFL_STAT_LABELS: Record<string, string> = {
  passing_yards: 'Passing Yards', passing_td: 'Passing TD', passing_first_down: 'Passing 1st Down',
  passing_2pt: 'Passing 2PT', interception_thrown: 'INT Thrown', pick_6_thrown: 'Pick 6 Thrown',
  completion: 'Completion', incomplete_pass: 'Incomplete Pass', passing_attempt: 'Pass Attempt', qb_sacked: 'QB Sacked',
  forty_yd_completion_bonus: '40+ Yd Completion', forty_yd_pass_td_bonus: '40+ Yd Pass TD',
  three_hundred_yd_pass_bonus: '300+ Pass Yards', four_hundred_yd_pass_bonus: '400+ Pass Yards',
  rushing_yards: 'Rushing Yards', rushing_td: 'Rushing TD', rushing_first_down: 'Rushing 1st Down',
  rushing_2pt: 'Rushing 2PT', rush_attempt: 'Rush Attempt',
  forty_yd_rush_bonus: '40+ Yd Rush', forty_yd_rush_td_bonus: '40+ Yd Rush TD',
  one_hundred_yd_rush_bonus: '100+ Rush Yards', two_hundred_yd_rush_bonus: '200+ Rush Yards',
  reception: 'Reception', receiving_yards: 'Receiving Yards', receiving_td: 'Receiving TD',
  receiving_first_down: 'Receiving 1st Down', receiving_2pt: 'Receiving 2PT', target: 'Target',
  forty_yd_reception_bonus: '40+ Yd Reception', forty_yd_rec_td_bonus: '40+ Yd Rec TD',
  one_hundred_yd_rec_bonus: '100+ Rec Yards', two_hundred_yd_rec_bonus: '200+ Rec Yards',
  fumble: 'Fumble', fumble_lost: 'Fumble Lost', fumble_recovery: 'Fumble Recovery',
  off_fumble_recovery_td: 'Off Fumble Recovery TD', return_yards: 'Return Yards', return_td: 'Return TD',
  pat_made: 'PAT Made', pat_missed: 'PAT Missed',
  fg_0_19: 'FG 0-19', fg_20_29: 'FG 20-29', fg_30_39: 'FG 30-39', fg_40_49: 'FG 40-49', fg_50_plus: 'FG 50+',
  fg_missed_0_19: 'FG Miss 0-19', fg_missed_20_29: 'FG Miss 20-29', fg_missed_30_39: 'FG Miss 30-39',
  fg_missed_40_49: 'FG Miss 40-49', fg_missed_50_plus: 'FG Miss 50+',
  dst_sack: 'DST Sack', dst_interception: 'DST INT', dst_fumble_recovery: 'DST Fumble Rec',
  dst_safety: 'DST Safety', dst_td: 'DST TD', dst_blocked_kick: 'DST Blocked Kick',
  dst_kick_return_td: 'DST Kick Return TD', dst_punt_return_td: 'DST Punt Return TD', dst_2pt_return: 'DST 2PT Return',
  dst_pa_0: 'PA: 0 (Shutout)', dst_pa_1_6: 'PA: 1-6', dst_pa_7_13: 'PA: 7-13', dst_pa_14_20: 'PA: 14-20',
  dst_pa_21_27: 'PA: 21-27', dst_pa_28_34: 'PA: 28-34', dst_pa_35_plus: 'PA: 35+',
  idp_tackle: 'Tackle', idp_solo_tackle: 'Solo Tackle', idp_assisted_tackle: 'Assisted Tackle',
  idp_tackle_for_loss: 'Tackle For Loss', idp_sack: 'IDP Sack', idp_qb_hit: 'QB Hit',
  idp_pass_defended: 'Pass Defended', idp_interception: 'IDP INT', idp_fumble_forced: 'Fumble Forced',
  idp_fumble_recovery: 'IDP Fumble Rec', idp_td: 'IDP TD', idp_safety: 'IDP Safety', idp_blocked_kick: 'IDP Blocked Kick',
}

// ============================================================
// PRESETS
// ============================================================

const COMMON_DST = {
  dst_sack: 1, dst_interception: 2, dst_fumble_recovery: 2, dst_safety: 2, dst_td: 6, dst_blocked_kick: 2,
  dst_kick_return_td: 6, dst_punt_return_td: 6, dst_2pt_return: 2,
  dst_pa_0: 10, dst_pa_1_6: 7, dst_pa_7_13: 4, dst_pa_14_20: 1, dst_pa_21_27: 0, dst_pa_28_34: -1, dst_pa_35_plus: -4,
}

const AF_DEFAULT: NflScoringPreset = {
  key: 'af_default', label: 'AllFantasy Default', source: 'AF_DEFAULT',
  description: 'Balanced 0.5 PPR NFL scoring optimized for AllFantasy league types.',
  rules: {
    passing_yards: 0.04, passing_td: 4, interception_thrown: -1, passing_2pt: 2,
    rushing_yards: 0.1, rushing_td: 6, rushing_2pt: 2,
    receiving_yards: 0.1, reception: 0.5, receiving_td: 6, receiving_2pt: 2,
    return_td: 6, fumble_lost: -2, off_fumble_recovery_td: 6,
    pat_made: 1, pat_missed: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5,
    fg_missed_0_19: -1, fg_missed_20_29: -1, fg_missed_30_39: -1,
    ...COMMON_DST,
    // IDP defaults (optional, all zero unless IDP league)
    idp_solo_tackle: 1, idp_assisted_tackle: 0.5, idp_sack: 3, idp_tackle_for_loss: 1, idp_qb_hit: 1,
    idp_pass_defended: 1, idp_interception: 4, idp_fumble_forced: 3, idp_fumble_recovery: 3, idp_td: 6, idp_safety: 2, idp_blocked_kick: 3,
  },
}

/**
 * AllFantasy's rules at the two other reception values, so a league created as Full PPR or
 * Standard is scored that way. Before these existed every NFL league was seeded with
 * `af_default` (0.5 PPR) whatever the manager picked, and that seed is what the live scorer
 * reads — so "Full PPR" and "Standard" leagues both scored half-PPR.
 */
const AF_PPR: NflScoringPreset = {
  key: 'af_ppr', label: 'AllFantasy PPR', source: 'AF_DEFAULT',
  description: 'AllFantasy scoring with 1 point per reception.',
  rules: { ...AF_DEFAULT.rules, reception: 1 },
}

const AF_STANDARD: NflScoringPreset = {
  key: 'af_standard', label: 'AllFantasy Standard', source: 'AF_DEFAULT',
  description: 'AllFantasy scoring with no points per reception.',
  rules: { ...AF_DEFAULT.rules, reception: 0 },
}

const SLEEPER_DEFAULT: NflScoringPreset = {
  key: 'sleeper_default', label: 'Sleeper Default', source: 'PLATFORM_PRESET',
  description: 'Sleeper standard PPR scoring: 1 PPR, 0.04/pass yd, 4 pass TD, 0.1/rush-rec yd, 6 rush/rec TD.',
  warning: 'This preset is based on Sleeper\'s standard PPR format. Specialty leagues are optimized for AllFantasy scoring.',
  rules: {
    passing_yards: 0.04, passing_td: 4, interception_thrown: -1, passing_2pt: 2,
    rushing_yards: 0.1, rushing_td: 6, rushing_2pt: 2,
    receiving_yards: 0.1, reception: 1, receiving_td: 6, receiving_2pt: 2,
    return_td: 6, fumble_lost: -2, off_fumble_recovery_td: 6,
    pat_made: 1, pat_missed: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5,
    ...COMMON_DST,
  },
}

const ESPN_STANDARD: NflScoringPreset = {
  key: 'espn_standard', label: 'ESPN Standard', source: 'PLATFORM_PRESET',
  description: 'ESPN Standard (non-PPR): 0 PPR, standard yardage and TD scoring.',
  warning: 'This preset is based on ESPN\'s Standard format. Specialty leagues are optimized for AllFantasy scoring.',
  rules: {
    passing_yards: 0.04, passing_td: 4, interception_thrown: -2, passing_2pt: 2,
    rushing_yards: 0.1, rushing_td: 6, rushing_2pt: 2,
    receiving_yards: 0.1, reception: 0, receiving_td: 6, receiving_2pt: 2,
    return_td: 6, fumble_lost: -2,
    pat_made: 1, pat_missed: -1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5,
    ...COMMON_DST,
  },
}

const ESPN_PPR: NflScoringPreset = {
  key: 'espn_ppr', label: 'ESPN PPR', source: 'PLATFORM_PRESET',
  description: 'ESPN PPR: 1 point per reception, standard yardage and TD scoring.',
  warning: 'This preset is based on ESPN\'s PPR format. Specialty leagues are optimized for AllFantasy scoring.',
  rules: { ...ESPN_STANDARD.rules, reception: 1 },
}

const YAHOO_DEFAULT: NflScoringPreset = {
  key: 'yahoo_default', label: 'Yahoo Default', source: 'PLATFORM_PRESET',
  description: 'Yahoo default: 0.5 PPR, fractional yardage, negative points.',
  warning: 'This preset is based on Yahoo\'s default format. Specialty leagues are optimized for AllFantasy scoring.',
  rules: {
    passing_yards: 0.04, passing_td: 4, interception_thrown: -1, passing_2pt: 2,
    rushing_yards: 0.1, rushing_td: 6, rushing_2pt: 2,
    receiving_yards: 0.1, reception: 0.5, receiving_td: 6, receiving_2pt: 2,
    return_td: 6, fumble_lost: -2, off_fumble_recovery_td: 6,
    pat_made: 1, fg_0_19: 3, fg_20_29: 3, fg_30_39: 3, fg_40_49: 4, fg_50_plus: 5,
    ...COMMON_DST,
  },
}

const PRESET_REGISTRY: Record<NflScoringPresetKey, NflScoringPreset> = {
  af_default: AF_DEFAULT, af_ppr: AF_PPR, af_standard: AF_STANDARD, sleeper_default: SLEEPER_DEFAULT,
  espn_standard: ESPN_STANDARD, espn_ppr: ESPN_PPR, yahoo_default: YAHOO_DEFAULT,
  custom: { key: 'custom', label: 'Custom', source: 'CUSTOM', description: 'Custom scoring values.', rules: { ...AF_DEFAULT.rules } },
}

export function getNflScoringPresets(): NflScoringPreset[] { return Object.values(PRESET_REGISTRY) }
export function getNflScoringPreset(key: NflScoringPresetKey): NflScoringPreset { return PRESET_REGISTRY[key] ?? PRESET_REGISTRY.af_default }

export function detectNflPresetMatch(rules: Record<string, number>): NflScoringPresetKey | null {
  for (const preset of [AF_DEFAULT, AF_PPR, AF_STANDARD, SLEEPER_DEFAULT, ESPN_STANDARD, ESPN_PPR, YAHOO_DEFAULT]) {
    const keys = Object.keys(preset.rules)
    const nonZero = Object.entries(rules).filter(([, v]) => v !== 0)
    // A preset that itself scores a key at 0 (AF Standard's reception) still lists it.
    const presetNonZero = keys.filter((k) => preset.rules[k] !== 0)
    if (nonZero.length !== presetNonZero.length) continue
    if (keys.every((k) => Math.abs((rules[k] ?? 0) - (preset.rules[k] ?? 0)) < 0.001)) return preset.key
  }
  return null
}

/**
 * The AllFantasy preset for a league's points-per-reception, as chosen at create.
 * `null` (not a football preset, or unknown) keeps the half-PPR default.
 */
export function nflScoringPresetKeyForReceptionPoints(receptionPoints: number | null | undefined): NflScoringPresetKey {
  if (receptionPoints === 1) return 'af_ppr'
  if (receptionPoints === 0) return 'af_standard'
  return 'af_default'
}

export function buildFullNflScoringConfig(presetKey: NflScoringPresetKey): Record<string, number> {
  const preset = getNflScoringPreset(presetKey)
  const config: Record<string, number> = {}
  for (const key of NFL_STAT_KEYS) config[key] = preset.rules[key] ?? 0
  return config
}
