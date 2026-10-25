import { NFL_STAT_KEYS, NFL_STAT_LABELS } from '@/lib/nfl-scoring/NflScoringPresets'
import { bridgeScoringKey } from '@/lib/nfl-scoring/scoringKeyBridge'
import { providerScoringRulesInSleeperKeys } from '@/lib/projections/leagueScoring'

/**
 * Imported NFL scoring → the native league's scoring store, AS CLOSELY AS IT CAN BE SCORED.
 *
 * Owner decision 2026-10-25: convert imported scoring as closely as we can, rather than refuse or
 * drop it. So, unlike `importedMlbScoring`, this is best-effort and never throws:
 *   - every source rule with an AllFantasy equivalent carries its exact value;
 *   - every AllFantasy rule the source does not award scores 0 (an import is the whole rule set);
 *   - a source rule with no equivalent is listed in `notScored` for the commissioner;
 *   - where several source rules share one AllFantasy rule (2-pt conversions, missed FGs, the 450+
 *     yards-allowed tiers) and their values differ, the rule is listed in `approximated`.
 *
 * The output is the commissioner panel's own store (`nfl_scoring_config.rules`, UI keys), which the
 * live scorer bridges to engine keys — so the panel shows exactly what will be scored and a later
 * edit there still wins.
 *
 * Source keys are Sleeper's vocabulary. Sleeper and Fantrax rules already use it; ESPN, Yahoo and
 * MFL rules are translated into it by `providerScoringRulesInSleeperKeys`. The table below was built
 * from the keys stored on all 493 imported Sleeper NFL leagues in production (2026-10-25).
 */

/** Sleeper rule key → NFL scoring panel key(s). Several entries may write one panel key. */
const SLEEPER_TO_PANEL: Readonly<Record<string, readonly string[]>> = {
  pass_yd: ['passing_yards'],
  pass_td: ['passing_td'],
  pass_fd: ['passing_first_down'],
  pass_2pt: ['passing_2pt'],
  pass_int: ['interception_thrown'],
  pass_int_td: ['pick_6_thrown'],
  pass_cmp: ['completion'],
  pass_inc: ['incomplete_pass'],
  pass_att: ['passing_attempt'],
  pass_sack: ['qb_sacked'],
  pass_cmp_40p: ['forty_yd_completion_bonus'],
  pass_td_40p: ['forty_yd_pass_td_bonus'],
  bonus_pass_yd_300: ['three_hundred_yd_pass_bonus'],
  bonus_pass_yd_400: ['four_hundred_yd_pass_bonus'],
  rush_yd: ['rushing_yards'],
  rush_td: ['rushing_td'],
  rush_fd: ['rushing_first_down'],
  rush_2pt: ['rushing_2pt'],
  rush_att: ['rush_attempt'],
  rush_40p: ['forty_yd_rush_bonus'],
  rush_td_40p: ['forty_yd_rush_td_bonus'],
  bonus_rush_yd_100: ['one_hundred_yd_rush_bonus'],
  bonus_rush_yd_200: ['two_hundred_yd_rush_bonus'],
  rec: ['reception'],
  rec_yd: ['receiving_yards'],
  rec_td: ['receiving_td'],
  rec_fd: ['receiving_first_down'],
  rec_2pt: ['receiving_2pt'],
  rec_tgt: ['target'],
  rec_40p: ['forty_yd_reception_bonus'],
  rec_td_40p: ['forty_yd_rec_td_bonus'],
  bonus_rec_yd_100: ['one_hundred_yd_rec_bonus'],
  bonus_rec_yd_200: ['two_hundred_yd_rec_bonus'],
  bonus_rec_te: ['te_premium'],
  fum: ['fumble'],
  fum_lost: ['fumble_lost'],
  fum_rec_td: ['off_fumble_recovery_td'],
  xpm: ['pat_made'],
  xpmiss: ['pat_missed'],
  fgm_0_19: ['fg_0_19'],
  fgm_20_29: ['fg_20_29'],
  fgm_30_39: ['fg_30_39'],
  fgm_40_49: ['fg_40_49'],
  fgm_50p: ['fg_50_plus'],
  fgmiss_0_19: ['fg_missed_0_19'],
  fgmiss_20_29: ['fg_missed_20_29'],
  fgmiss_30_39: ['fg_missed_30_39'],
  fgmiss_40_49: ['fg_missed_40_49'],
  fgmiss_50p: ['fg_missed_50_plus'],
  sack: ['dst_sack'],
  int: ['dst_interception'],
  fum_rec: ['dst_fumble_recovery'],
  safe: ['dst_safety'],
  def_td: ['dst_td'],
  blk_kick: ['dst_blocked_kick'],
  def_st_td: ['dst_kick_return_td', 'dst_punt_return_td'],
  def_2pt: ['dst_2pt_return'],
  def_kr_yd: ['dst_kick_return_yards'],
  def_pr_yd: ['dst_punt_return_yards'],
  pts_allow_0: ['dst_pa_0'],
  pts_allow_1_6: ['dst_pa_1_6'],
  pts_allow_7_13: ['dst_pa_7_13'],
  pts_allow_14_20: ['dst_pa_14_20'],
  pts_allow_21_27: ['dst_pa_21_27'],
  pts_allow_28_34: ['dst_pa_28_34'],
  pts_allow_35p: ['dst_pa_35_plus'],
  yds_allow_0_100: ['dst_ya_0_99'],
  yds_allow_100_199: ['dst_ya_100_199'],
  yds_allow_200_299: ['dst_ya_200_299'],
  yds_allow_300_349: ['dst_ya_300_349'],
  yds_allow_350_399: ['dst_ya_350_399'],
  yds_allow_400_449: ['dst_ya_400_449'],
  yds_allow_450_499: ['dst_ya_450_499'],
  yds_allow_500_549: ['dst_ya_500_549'],
  yds_allow_550p: ['dst_ya_550_plus'],
  idp_tkl: ['idp_tackle'],
  idp_tkl_solo: ['idp_solo_tackle'],
  idp_tkl_ast: ['idp_assisted_tackle'],
  idp_tkl_loss: ['idp_tackle_for_loss'],
  idp_sack: ['idp_sack'],
  idp_qb_hit: ['idp_qb_hit'],
  idp_pass_def: ['idp_pass_defended'],
  idp_int: ['idp_interception'],
  idp_ff: ['idp_fumble_forced'],
  idp_fum_rec: ['idp_fumble_recovery'],
  idp_def_td: ['idp_td'],
  idp_safe: ['idp_safety'],
  idp_blk_kick: ['idp_blocked_kick'],
}

/**
 * Sleeper rules that FILL IN for a missing specific rule rather than map on their own: a league
 * that scores every missed FG the same uses `fgmiss`; a league on Sleeper's newer kicker tiers
 * uses `fgm_50_59`. Each applies only to panel keys no specific rule set.
 */
const FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  fgmiss: ['fg_missed_0_19', 'fg_missed_20_29', 'fg_missed_30_39', 'fg_missed_40_49', 'fg_missed_50_plus'],
  fgm_50_59: ['fg_50_plus'],
  fgmiss_50_59: ['fg_missed_50_plus'],
}

/** The stats that make a rule set recognisably NFL points scoring. Without one, convert nothing. */
const CORE_PANEL_KEYS = ['passing_yards', 'passing_td', 'rushing_yards', 'rushing_td', 'reception', 'receiving_yards', 'receiving_td']

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const finite = (value: unknown): number | null => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Readable name for a rule the commissioner is told about. */
function ruleLabel(key: string): string {
  return NFL_STAT_LABELS[key] ?? key.replace(/@/g, ' for ').replace(/_/g, ' ')
}

export type ImportedNflScoring = {
  /** The full panel store: every panel key, plus `te_premium` when the source awards it. */
  rules: Record<string, number>
  /** True when the source awards a tight-end reception bonus (the engine scores it only then). */
  enableTEPremium: boolean
  /** How many source rules carried over. */
  convertedCount: number
  /** Source rules that award points but have no AllFantasy equivalent yet — readable names. */
  notScored: string[]
  /** AllFantasy rules fed by several source rules that disagree — readable names. */
  approximated: string[]
}

/**
 * The native NFL scoring for an imported league, or null when the import holds no recognisable
 * NFL points rules (a category league, or no rules at all) — the preset the creator picked then
 * stays, unchanged.
 */
export function importedNflScoring(sourceSettings: unknown): ImportedNflScoring | null {
  const settings = record(sourceSettings)
  const scoring = record(settings.scoringSettings)
  if (/categor|roti/i.test(String(scoring.format ?? ''))) return null
  const sourceRules = providerScoringRulesInSleeperKeys(settings) ?? record(scoring.rules)

  const rules: Record<string, number> = Object.fromEntries(NFL_STAT_KEYS.map((key) => [key, 0]))
  const set = new Set<string>()
  const notScored: string[] = []
  let convertedCount = 0

  for (const [key, raw] of Object.entries(sourceRules)) {
    const value = finite(raw)
    if (value == null) continue
    const panelKeys = SLEEPER_TO_PANEL[key]
    if (!panelKeys) {
      if (value !== 0 && !(key in FALLBACKS)) notScored.push(ruleLabel(key))
      continue
    }
    for (const panelKey of panelKeys) {
      rules[panelKey] = value
      set.add(panelKey)
    }
    convertedCount += 1
    // Kept in the panel either way; told about only when it awards points the engine cannot score.
    if (value !== 0 && panelKeys.every((panelKey) => !bridgeScoringKey(panelKey))) notScored.push(ruleLabel(panelKeys[0]!))
  }
  for (const [key, panelKeys] of Object.entries(FALLBACKS)) {
    const value = finite(sourceRules[key])
    if (value == null) continue
    let used = false
    for (const panelKey of panelKeys) {
      if (set.has(panelKey)) continue
      rules[panelKey] = value
      set.add(panelKey)
      used = true
    }
    if (used) convertedCount += 1
  }

  if (!CORE_PANEL_KEYS.some((key) => set.has(key))) return null

  const fantraxGaps = record(settings.fantrax_settings).scoringGaps
  if (Array.isArray(fantraxGaps)) for (const gap of fantraxGaps) if (typeof gap === 'string' && gap) notScored.push(gap)

  // Several panel keys collapse to one engine rule; a disagreement there is an approximation.
  const byEngine = new Map<string, Set<number>>()
  for (const panelKey of set) {
    const engineKey = bridgeScoringKey(panelKey)
    if (!engineKey) continue
    const values = byEngine.get(engineKey) ?? new Set<number>()
    values.add(rules[panelKey]!)
    byEngine.set(engineKey, values)
  }
  const approximated = [...byEngine.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([engineKey]) => ENGINE_LABELS[engineKey] ?? engineKey)
    .sort()

  const enableTEPremium = (rules.te_premium ?? 0) !== 0
  if (!enableTEPremium) delete rules.te_premium
  return { rules, enableTEPremium, convertedCount, notScored: [...new Set(notScored)].sort(), approximated }
}

const ENGINE_LABELS: Readonly<Record<string, string>> = {
  two_pt: '2-point conversions',
  fg_0_39: 'Field goals 0–39 yards',
  fg_50_plus: 'Field goals 50+ yards',
  fg_miss: 'Missed field goals',
  def_st_td: 'Return touchdowns',
  def_ya_450_plus: 'Yards allowed 450+',
}
