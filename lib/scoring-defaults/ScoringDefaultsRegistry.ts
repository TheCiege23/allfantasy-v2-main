/**
 * Registry of default scoring rules per sport and format.
 * Single source for template id, stat keys, point values, multipliers, enabled flags.
 * Used when no DB ScoringTemplate exists; compatible with ScoringTemplateResolver and FantasyPointCalculator.
 * Stat keys are canonical; data providers can map feed fields to these keys (e.g. Soccer goal, shot_on_target; IDP idp_sack, idp_solo_tackle).
 */
import { DEFAULT_SPORT, supportsIdpLeagueSport } from '@/lib/sport-scope'
import { templateStatKeyFromUiKey } from '@/lib/league/scoring-stat-metadata'
import { buildFullNflDefaultConfig } from '@/lib/nfl-scoring/NflScoringCategories'
import { buildFullNbaDefaultConfig } from '@/lib/nba-scoring/NbaScoringCategories'
import { buildMlbScoringDefaults } from '@/lib/mlb-scoring/MlbScoringCategories'
import { buildNcaafScoringDefaults } from '@/lib/ncaaf-scoring/NcaafScoringCategories'
import { buildFullNcaabDefaultConfig } from '@/lib/ncaab-scoring/NcaabScoringCategories'
import { buildNhlScoringDefaults } from '@/lib/nhl-scoring/NhlScoringCategories'
import { buildSoccerDefaultRulesFromCategories } from '@/lib/soccer-scoring/SoccerScoringCategories'
import type { SportType, ScoringRuleDefinition, ScoringTemplateDefinition } from './types'

/** Bumped whenever a template definition or stat key changes. */
export const SCORING_DEFAULTS_REGISTRY_VERSION = '2026-04-20.1'

interface LeagueSettingsForScoringDefaults {
  scoring_format?: string | null
  leagueVariant?: string | null
  idpScoringPreset?: string | null
  [key: string]: unknown
}

function rule(
  statKey: string,
  pointsValue: number,
  multiplier: number = 1,
  enabled: boolean = true
): ScoringRuleDefinition {
  return { statKey, pointsValue, multiplier, enabled }
}

/**
 * Merge compact engine defaults with full commissioner-category stat keys so overrides
 * and UI rows resolve to real template keys.
 */
function mergeCategoryDefaults(
  base: ScoringRuleDefinition[],
  sport: SportType,
  categoryDefaults: Record<string, number>,
): ScoringRuleDefinition[] {
  const byKey = new Map(base.map((r) => [r.statKey, r]))
  for (const [uiKey, val] of Object.entries(categoryDefaults)) {
    const tk = templateStatKeyFromUiKey(sport, uiKey)
    if (!byKey.has(tk)) {
      byKey.set(tk, rule(tk, val))
    }
  }
  return Array.from(byKey.values())
}

/** NFL: PPR (default), Half-PPR, Standard — plus K and DST. */
const NFL_PPR: ScoringRuleDefinition[] = [
  rule('passing_yards', 0.04),
  rule('passing_td', 4),
  rule('interception', -2),
  rule('rushing_yards', 0.1),
  rule('rushing_td', 6),
  rule('receptions', 1),
  rule('receiving_yards', 0.1),
  rule('receiving_td', 6),
  rule('fumble_lost', -2),
  rule('two_pt_conversion', 2),
  rule('passing_2pt', 2),
  rule('rushing_2pt', 2),
  rule('receiving_2pt', 2),
  rule('fg_0_39', 3),
  rule('fg_40_49', 4),
  rule('fg_50_plus', 5),
  rule('pat_made', 1),
  rule('pat_missed', -1),
  rule('dst_sack', 1),
  rule('dst_interception', 2),
  rule('dst_fumble_recovery', 2),
  rule('dst_td', 6),
  rule('dst_safety', 2),
  rule('dst_blocked_kick', 2),
  rule('dst_return_td', 6),
  rule('dst_points_allowed_0', 10),
  rule('dst_points_allowed_1_6', 7),
  rule('dst_points_allowed_7_13', 4),
  rule('dst_points_allowed_14_20', 1),
  rule('dst_points_allowed_21_27', 0),
  rule('dst_points_allowed_28_34', -1),
  rule('dst_points_allowed_35_plus', -4),
]

const NFL_HALF_PPR: ScoringRuleDefinition[] = NFL_PPR.map((r) =>
  r.statKey === 'receptions' ? { ...r, pointsValue: 0.5 } : r
)

const NFL_STANDARD: ScoringRuleDefinition[] = NFL_PPR.map((r) =>
  r.statKey === 'receptions' ? { ...r, pointsValue: 0, enabled: true } : r
)

/** NFL TE Premium: 1.5 PPR (often used as proxy for TE-only premium when engine has single receptions stat). */
const NFL_TE_PREMIUM: ScoringRuleDefinition[] = NFL_PPR.map((r) =>
  r.statKey === 'receptions' ? { ...r, pointsValue: 1.5 } : r
)

/** Dynasty 6pt pass TD variant (Full PPR, 6pt passing TD). */
const NFL_6PT_PASS_TD: ScoringRuleDefinition[] = NFL_PPR.map((r) =>
  r.statKey === 'passing_td' ? { ...r, pointsValue: 6 } : r
)

/** NBA: points scoring. */
const NBA_POINTS: ScoringRuleDefinition[] = [
  rule('points', 1),
  rule('rebounds', 1.2),
  rule('assists', 1.5),
  rule('steals', 3),
  rule('blocks', 3),
  rule('turnovers', -1),
  rule('three_pointers_made', 0.5),
  rule('double_double', 1.5),
  rule('triple_double', 3),
]

/** MLB: standard (batter + pitcher). */
const MLB_STANDARD: ScoringRuleDefinition[] = [
  rule('single', 1),
  rule('double', 2),
  rule('triple', 3),
  rule('home_run', 4),
  rule('rbi', 1),
  rule('run', 1),
  rule('walk', 1),
  rule('stolen_base', 2),
  rule('hit_by_pitch', 1),
  rule('strikeout', -0.5),
  rule('innings_pitched', 3),
  rule('earned_runs', -2),
  rule('strikeouts_pitched', 1),
  rule('save', 5),
  rule('hold', 4),
  rule('win', 5),
  rule('loss', -5),
  rule('quality_start', 4),
]

/** NHL: standard. */
const NHL_STANDARD: ScoringRuleDefinition[] = [
  rule('goal', 3),
  rule('assist', 2),
  rule('shot_on_goal', 0.5),
  rule('blocked_shot', 0.5),
  rule('power_play_point', 1),
  rule('short_handed_point', 2),
  rule('save', 0.6),
  rule('goal_allowed', -3),
  rule('win', 5),
  rule('loss', -3),
  rule('shutout', 3),
]

/** NCAA Football: PPR-style, configurable (same stat keys as NFL). */
const NCAAF_PPR: ScoringRuleDefinition[] = [
  ...NFL_PPR.filter(
    (r) =>
      !r.statKey.startsWith('dst_') &&
      !r.statKey.startsWith('fg_') &&
      r.statKey !== 'pat_made' &&
      r.statKey !== 'pat_missed'
  ),
  rule('fg_0_39', 3),
  rule('fg_40_49', 4),
  rule('fg_50_plus', 5),
  rule('pat_made', 1),
  rule('pat_missed', -1),
  rule('dst_sack', 1),
  rule('dst_interception', 2),
  rule('dst_fumble_recovery', 2),
  rule('dst_td', 6),
  rule('dst_safety', 2),
  rule('dst_blocked_kick', 2),
  rule('dst_return_td', 6),
  rule('dst_points_allowed_0', 10),
  rule('dst_points_allowed_1_6', 7),
  rule('dst_points_allowed_7_13', 4),
  rule('dst_points_allowed_14_20', 1),
  rule('dst_points_allowed_21_27', 0),
  rule('dst_points_allowed_28_34', -1),
  rule('dst_points_allowed_35_plus', -4),
]

/** NCAA Basketball: points (same stat keys as NBA). */
const NCAAB_POINTS: ScoringRuleDefinition[] = [...NBA_POINTS]

/**
 * Soccer: default scoring template. Stat keys are canonical; data providers map feed fields to these keys.
 * Keys: goal, assist, shot_on_target, shot, key_pass, clean_sheet, goal_conceded, goal_allowed, save,
 * penalty_save, penalty_miss, yellow_card, red_card, own_goal, minutes_played.
 */
const SOCCER_STANDARD: ScoringRuleDefinition[] = [
  rule('goal', 6),
  rule('assist', 3),
  rule('shot_on_target', 0.5),
  rule('shot', 0.2),
  rule('key_pass', 0.5),
  rule('clean_sheet', 4),
  rule('goal_conceded', -1),
  rule('goal_allowed', -1),
  rule('save', 0.5),
  rule('penalty_save', 5),
  rule('penalty_miss', -2),
  rule('yellow_card', -1),
  rule('red_card', -3),
  rule('own_goal', -2),
  rule('minutes_played', 0.02),
]

/**
 * NFL IDP: offensive (NFL PPR) + defensive scoring. Coexists with standard NFL templates.
 * IDP stat keys use idp_ prefix to avoid clash with offensive stats. Map feed fields to:
 * idp_solo_tackle, idp_assist_tackle, idp_tackle_for_loss, idp_qb_hit, idp_sack, idp_interception,
 * idp_pass_defended, idp_forced_fumble, idp_fumble_recovery, idp_defensive_touchdown, idp_safety, idp_blocked_kick.
 */
/** NFL IDP Balanced: solo/assist meaningful, sack/INT strong, PD moderate, FF/FR/defensive TD/safety high. */
const NFL_IDP_RULES: ScoringRuleDefinition[] = [
  ...NFL_PPR,
  rule('idp_tackle_solo', 1),
  rule('idp_tackle_assist', 0.5),
  rule('idp_solo_tackle', 1),
  rule('idp_assist_tackle', 0.5),
  rule('idp_tackle_for_loss', 2),
  rule('idp_qb_hit', 1),
  rule('idp_sack', 4),
  rule('idp_interception', 3),
  rule('idp_pass_defended', 1),
  rule('idp_forced_fumble', 3),
  rule('idp_fumble_recovery', 2),
  rule('idp_td', 6),
  rule('idp_defensive_touchdown', 6),
  rule('idp_safety', 2),
  rule('idp_blocked_kick', 2),
]

/** Tackle-heavy: emphasize solo and assist tackles; big plays still count but do not dominate. */
const NFL_IDP_TACKLE_HEAVY: ScoringRuleDefinition[] = [
  ...NFL_PPR,
  rule('idp_solo_tackle', 1.5),
  rule('idp_assist_tackle', 0.75),
  rule('idp_tackle_solo', 1.5),
  rule('idp_tackle_assist', 0.75),
  rule('idp_tackle_for_loss', 1.5),
  rule('idp_qb_hit', 0.5),
  rule('idp_sack', 3),
  rule('idp_interception', 2),
  rule('idp_pass_defended', 0.5),
  rule('idp_forced_fumble', 2),
  rule('idp_fumble_recovery', 1),
  rule('idp_defensive_touchdown', 4),
  rule('idp_td', 4),
  rule('idp_safety', 1.5),
  rule('idp_blocked_kick', 1.5),
]

/** Big-play-heavy: sacks, INT, FF, FR, TDs carry stronger weight; tackles still count but less dominant. */
const NFL_IDP_BIG_PLAY: ScoringRuleDefinition[] = [
  ...NFL_PPR,
  rule('idp_solo_tackle', 0.5),
  rule('idp_assist_tackle', 0.25),
  rule('idp_tackle_solo', 0.5),
  rule('idp_tackle_assist', 0.25),
  rule('idp_tackle_for_loss', 3),
  rule('idp_qb_hit', 1.5),
  rule('idp_sack', 5),
  rule('idp_interception', 5),
  rule('idp_pass_defended', 1.5),
  rule('idp_forced_fumble', 4),
  rule('idp_fumble_recovery', 3),
  rule('idp_defensive_touchdown', 8),
  rule('idp_td', 8),
  rule('idp_safety', 4),
  rule('idp_blocked_kick', 3),
]

const NFL_PPR_FULL = mergeCategoryDefaults(NFL_PPR, 'NFL', buildFullNflDefaultConfig())
const NFL_HALF_PPR_FULL = mergeCategoryDefaults(NFL_HALF_PPR, 'NFL', buildFullNflDefaultConfig())
const NFL_STANDARD_FULL = mergeCategoryDefaults(NFL_STANDARD, 'NFL', buildFullNflDefaultConfig())
const NFL_TE_PREMIUM_FULL = mergeCategoryDefaults(NFL_TE_PREMIUM, 'NFL', buildFullNflDefaultConfig())
const NFL_6PT_PASS_TD_FULL = mergeCategoryDefaults(NFL_6PT_PASS_TD, 'NFL', buildFullNflDefaultConfig())
const NFL_IDP_RULES_FULL = mergeCategoryDefaults(NFL_IDP_RULES, 'NFL', buildFullNflDefaultConfig())
const NFL_IDP_TACKLE_HEAVY_FULL = mergeCategoryDefaults(NFL_IDP_TACKLE_HEAVY, 'NFL', buildFullNflDefaultConfig())
const NFL_IDP_BIG_PLAY_FULL = mergeCategoryDefaults(NFL_IDP_BIG_PLAY, 'NFL', buildFullNflDefaultConfig())
const NCAAF_IDP_RULES_FULL = mergeCategoryDefaults(NFL_IDP_RULES, 'NCAAF', buildNcaafScoringDefaults())
const NCAAF_IDP_TACKLE_HEAVY_FULL = mergeCategoryDefaults(NFL_IDP_TACKLE_HEAVY, 'NCAAF', buildNcaafScoringDefaults())
const NCAAF_IDP_BIG_PLAY_FULL = mergeCategoryDefaults(NFL_IDP_BIG_PLAY, 'NCAAF', buildNcaafScoringDefaults())

const NBA_POINTS_FULL = mergeCategoryDefaults(NBA_POINTS, 'NBA', buildFullNbaDefaultConfig())
const MLB_STANDARD_FULL = mergeCategoryDefaults(MLB_STANDARD, 'MLB', buildMlbScoringDefaults())
const NHL_STANDARD_FULL = mergeCategoryDefaults(NHL_STANDARD, 'NHL', buildNhlScoringDefaults())
const NCAAF_PPR_FULL = mergeCategoryDefaults(NCAAF_PPR, 'NCAAF', buildNcaafScoringDefaults())
const NCAAB_POINTS_FULL = mergeCategoryDefaults(NCAAB_POINTS, 'NCAAB', buildFullNcaabDefaultConfig())
const SOCCER_STANDARD_FULL = mergeCategoryDefaults(
  SOCCER_STANDARD,
  'SOCCER',
  buildSoccerDefaultRulesFromCategories(),
)

const REGISTRY: Record<
  string,
  { name: string; rules: ScoringRuleDefinition[] }
> = {
  'NFL-PPR': { name: 'Default NFL PPR', rules: NFL_PPR_FULL },
  'NFL-Half PPR': { name: 'Default NFL Half PPR', rules: NFL_HALF_PPR_FULL },
  'NFL-half_ppr': { name: 'Default NFL Half PPR', rules: NFL_HALF_PPR_FULL },
  'NFL-Standard': { name: 'Default NFL Standard', rules: NFL_STANDARD_FULL },
  'NFL-standard': { name: 'Default NFL Standard', rules: NFL_STANDARD_FULL },
  'NBA-points': { name: 'Default NBA Points', rules: NBA_POINTS_FULL },
  'NBA-standard': { name: 'Default NBA Points', rules: NBA_POINTS_FULL },
  'MLB-standard': { name: 'Default MLB Standard', rules: MLB_STANDARD_FULL },
  'NHL-standard': { name: 'Default NHL Standard', rules: NHL_STANDARD_FULL },
  'NCAAF-PPR': { name: 'Default NCAA Football PPR', rules: NCAAF_PPR_FULL },
  'NCAAF-standard': { name: 'Default NCAA Football PPR', rules: NCAAF_PPR_FULL },
  'NCAAF-IDP': { name: 'Default NCAAF IDP (Balanced)', rules: NCAAF_IDP_RULES_FULL },
  'NCAAF-idp': { name: 'Default NCAAF IDP (Balanced)', rules: NCAAF_IDP_RULES_FULL },
  'NCAAF-IDP-balanced': { name: 'NCAAF IDP Balanced', rules: NCAAF_IDP_RULES_FULL },
  'NCAAF-IDP-tackle_heavy': { name: 'NCAAF IDP Tackle-Heavy', rules: NCAAF_IDP_TACKLE_HEAVY_FULL },
  'NCAAF-IDP-big_play_heavy': { name: 'NCAAF IDP Big-Play-Heavy', rules: NCAAF_IDP_BIG_PLAY_FULL },
  'NCAAB-points': { name: 'Default NCAA Basketball Points', rules: NCAAB_POINTS_FULL },
  'NCAAB-standard': { name: 'Default NCAA Basketball Points', rules: NCAAB_POINTS_FULL },
  'SOCCER-standard': { name: 'Default Soccer Standard', rules: SOCCER_STANDARD_FULL },
  'NFL-IDP': { name: 'Default NFL IDP (Balanced)', rules: NFL_IDP_RULES_FULL },
  'NFL-idp': { name: 'Default NFL IDP (Balanced)', rules: NFL_IDP_RULES_FULL },
  'NFL-IDP-balanced': { name: 'NFL IDP Balanced', rules: NFL_IDP_RULES_FULL },
  'NFL-IDP-tackle_heavy': { name: 'NFL IDP Tackle-Heavy', rules: NFL_IDP_TACKLE_HEAVY_FULL },
  'NFL-IDP-big_play_heavy': { name: 'NFL IDP Big-Play-Heavy', rules: NFL_IDP_BIG_PLAY_FULL },
  'NFL-ppr': { name: 'Default NFL PPR', rules: NFL_PPR_FULL },
  'NFL-TE_PREMIUM': { name: 'NFL TE Premium', rules: NFL_TE_PREMIUM_FULL },
  'NFL-dynasty_6pt_pass_td': { name: 'Dynasty 6pt Pass TD', rules: NFL_6PT_PASS_TD_FULL },
}

function toSportType(s: string): SportType {
  const u = s.toUpperCase()
  if (u === 'NFL' || u === 'NBA' || u === 'MLB' || u === 'NHL' || u === 'NCAAF' || u === 'NCAAB' || u === 'SOCCER')
    return u as SportType
  return DEFAULT_SPORT as SportType
}

/**
 * Normalize format string for registry lookup (case-insensitive and common aliases).
 */
function normalizeFormatForLookup(sport: SportType, format: string): string {
  const f = (format || 'standard').trim()
  const lower = f.toLowerCase()
  if (supportsIdpLeagueSport(sport)) {
    if (lower === 'idp-balanced' || lower === 'idp_balanced') return 'IDP-balanced'
    if (lower === 'idp-tackle_heavy' || lower === 'idp_tackle_heavy') return 'IDP-tackle_heavy'
    if (lower === 'idp-big_play_heavy' || lower === 'idp_big_play_heavy') return 'IDP-big_play_heavy'
    if (lower === 'idp' || lower === 'dynasty_idp') return 'IDP'
  }
  if (sport === 'NFL') {
    if (lower === 'ppr') return 'PPR'
    if (lower === 'half_ppr' || lower === 'half ppr') return 'half_ppr'
    if (lower === 'standard') return 'standard'
    if (lower === 'dynasty_standard') return 'standard'
    if (lower === 'dynasty_half_ppr') return 'half_ppr'
    if (lower === 'dynasty_full_ppr' || lower === 'dynasty_superflex_default') return 'PPR'
    if (lower === 'dynasty_full_ppr_tep') return 'TE_PREMIUM'
    if (lower === 'dynasty_6pt_pass_td') return 'dynasty_6pt_pass_td'
  }
  if ((sport === 'NBA' || sport === 'NCAAB') && (lower === 'points' || lower === 'standard')) return 'points'
  if (sport === 'SOCCER' && lower === 'standard') return 'standard'
  if ((sport === 'MLB' || sport === 'NHL' || sport === 'NCAAF') && lower === 'standard') return 'standard'
  if (sport === 'NCAAF' && (lower === 'ppr' || lower === 'standard')) return 'PPR'
  return f
}

/**
 * Get default scoring template definition for a sport and format (in-memory only).
 * Resolved by sport_type, format_type; league_settings can supply format_type when calling from resolvers.
 */
export function getDefaultScoringTemplate(
  sportType: SportType | string,
  formatType: string = 'standard'
): ScoringTemplateDefinition {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  const format = normalizeFormatForLookup(sport, formatType || 'standard')
  const key = `${sport}-${format}`
  let fallbackKey = `${sport}-standard`
  if (supportsIdpLeagueSport(sport)) {
    const idpPrefix = sport === 'NCAAF' ? 'NCAAF' : 'NFL'
    if (format === 'IDP' || format === 'IDP-balanced') fallbackKey = `${idpPrefix}-IDP`
    else if (format === 'IDP-tackle_heavy') fallbackKey = `${idpPrefix}-IDP-tackle_heavy`
    else if (format === 'IDP-big_play_heavy') fallbackKey = `${idpPrefix}-IDP-big_play_heavy`
    else if (format !== 'IDP') fallbackKey = sport === 'NCAAF' ? 'NCAAF-PPR' : 'NFL-PPR'
  }
  else if (sport === 'NBA' || sport === 'NCAAB') fallbackKey = `${sport}-points`
  else if (sport === 'SOCCER') fallbackKey = 'SOCCER-standard'
  else if (sport === 'NCAAF') fallbackKey = 'NCAAF-PPR'
  const entry = REGISTRY[key] ?? REGISTRY[fallbackKey] ?? REGISTRY['NFL-PPR']
  const templateId = `default-${sport}-${format}`
  return {
    templateId,
    sportType: sport as SportType,
    name: entry.name,
    formatType: format,
    rules: entry.rules,
  }
}

/**
 * Resolve default scoring template by sport + optional format + league settings.
 * Resolution order: explicit formatType > league settings (IDP presets, scoring_format) > sport default format.
 */
export function resolveDefaultScoringTemplate(
  sportType: SportType | string,
  options?: {
    formatType?: string | null
    leagueSettings?: LeagueSettingsForScoringDefaults | null
  }
): ScoringTemplateDefinition {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  const explicitFormat = options?.formatType?.trim()
  if (explicitFormat) {
    return getDefaultScoringTemplate(sport, explicitFormat)
  }

  const leagueSettings = options?.leagueSettings ?? null
  if (leagueSettings) {
    const variant = String(leagueSettings.leagueVariant ?? '').toUpperCase()
    if (supportsIdpLeagueSport(sport) && (variant === 'IDP' || variant === 'DYNASTY_IDP')) {
      const preset = String(leagueSettings.idpScoringPreset ?? '').toLowerCase()
      if (preset === 'tackle_heavy') return getDefaultScoringTemplate(sport, 'IDP-tackle_heavy')
      if (preset === 'big_play_heavy') return getDefaultScoringTemplate(sport, 'IDP-big_play_heavy')
      return getDefaultScoringTemplate(sport, 'IDP-balanced')
    }

    const scoringFormat =
      typeof leagueSettings.scoring_format === 'string' ? leagueSettings.scoring_format.trim() : ''
    if (scoringFormat) {
      return getDefaultScoringTemplate(sport, scoringFormat)
    }
  }

  if (sport === 'NFL') return getDefaultScoringTemplate(sport, 'PPR')
  if (sport === 'NBA' || sport === 'NCAAB') return getDefaultScoringTemplate(sport, 'points')
  if (sport === 'NCAAF') return getDefaultScoringTemplate(sport, 'PPR')
  return getDefaultScoringTemplate(sport, 'standard')
}

/**
 * Get default scoring rules only (for merging or display).
 */
export function getDefaultScoringRules(
  sportType: SportType | string,
  formatType: string = 'standard'
): ScoringRuleDefinition[] {
  return getDefaultScoringTemplate(sportType, formatType).rules
}

/**
 * Build a short scoring context string for AI recommendations (draft, waiver, matchup summary).
 * Includes template name and a few key rules so AI can reason about scoring impact.
 */
export function getScoringContextForAI(
  sportType: SportType | string,
  formatType: string = 'standard'
): string {
  const template = getDefaultScoringTemplate(sportType, formatType)
  const topRules = template.rules
    .filter((r) => r.enabled && r.pointsValue !== 0)
    .slice(0, 12)
    .map((r) => `${r.statKey}: ${r.pointsValue > 0 ? '+' : ''}${r.pointsValue}`)
  return `Scoring: ${template.name}. Key rules: ${topRules.join(', ')}.`
}

/**
 * Get the list of valid scoring format strings for a sport.
 * Used by creation UX, validation, and format-resolution guards.
 */
export function getSupportedScoringFormats(sportType: SportType | string): string[] {
  const sport = toSportType(typeof sportType === 'string' ? sportType : sportType)
  switch (sport) {
    case 'NFL':
      return [
        'PPR',
        'half_ppr',
        'standard',
        'TE_PREMIUM',
        'dynasty_6pt_pass_td',
        'IDP',
        'IDP-balanced',
        'IDP-tackle_heavy',
        'IDP-big_play_heavy',
      ]
    case 'NBA':
    case 'NCAAB':
      return ['points', 'standard']
    case 'MLB':
      return ['standard']
    case 'NHL':
      return ['standard']
    case 'NCAAF':
      return ['PPR', 'standard', 'IDP', 'IDP-balanced', 'IDP-tackle_heavy', 'IDP-big_play_heavy']
    case 'SOCCER':
      return ['standard']
    default:
      return ['standard']
  }
}
