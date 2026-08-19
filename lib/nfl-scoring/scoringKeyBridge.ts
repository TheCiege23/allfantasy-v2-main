/**
 * UI → engine scoring-key bridge (R1).
 *
 * The commissioner NFL scoring panel (`NflScoringSettingsPanel`) speaks one key
 * namespace (`passing_td`, `dst_sack`, `dst_pa_7_13`); the scoring engine
 * (`calculateScoreFromSportConfig` → `scoreStatsWithCategories`) reads
 * `sportConfig.categoryPoints` in another (`pass_td`, `def_sack`, `def_pa_7_13`).
 * They were disconnected, so panel edits never changed scored points. This module
 * maps UI rule keys → engine category keys so a save can write the canonical
 * `sportConfig.categoryPoints` the engine actually scores.
 *
 * Pure + deterministic. Only keys with a real engine category are emitted (so we
 * never write spurious keys); unmapped UI keys (e.g. `passing_first_down`, which
 * the engine has no category for) are dropped, not invented.
 */
import { expandSportConfigToggles, getScoringCategories } from '@/lib/sportConfig'

/** Every valid engine category key (all toggles on, so IDP/TE-premium included). */
const ENGINE_KEYS: ReadonlySet<string> = new Set(
  getScoringCategories('NFL', expandSportConfigToggles(['IDP', 'SUPERFLEX', 'TE_PREMIUM'])).map((c) => c.key),
)

export function isEngineScoringKey(key: string): boolean {
  return ENGINE_KEYS.has(key)
}

/** Explicit UI → engine key map (offense, kicking, DST counting, special teams). */
const STATIC_MAP: Readonly<Record<string, string>> = {
  // Passing
  passing_yards: 'pass_yds',
  passing_td: 'pass_td',
  interception_thrown: 'pass_int',
  passing_2pt: 'two_pt',
  // Rushing
  rushing_yards: 'rush_yds',
  rushing_td: 'rush_td',
  rushing_2pt: 'two_pt',
  // Receiving
  reception: 'rec',
  receiving_yards: 'rec_yds',
  receiving_td: 'rec_td',
  receiving_2pt: 'two_pt',
  // Misc / fumbles (UI catalog uses `off_fumble_recovery_td`; accept aliases too)
  fumble_lost: 'fum_lost',
  fumbles_lost: 'fum_lost',
  off_fumble_recovery_td: 'fumble_td',
  fumble_recovery_td: 'fumble_td',
  // Yardage / passing bonuses
  three_hundred_yd_pass_bonus: 'pass_300_bonus',
  four_hundred_yd_pass_bonus: 'pass_400_bonus',
  one_hundred_yd_rush_bonus: 'rush_100_bonus',
  one_hundred_yd_rec_bonus: 'rec_100_bonus',
  // IDP — UI catalog keys → engine keys (engine uses short forms). The ones that
  // are already engine keys (idp_sack/idp_td/idp_safety/idp_qb_hit) resolve via
  // the identity fallback; these are the UI keys that DIFFER from the engine key.
  idp_solo_tackle: 'idp_solo',
  idp_assisted_tackle: 'idp_assist',
  idp_interception: 'idp_int',
  idp_pass_defended: 'idp_pd',
  idp_fumble_forced: 'idp_ff',
  idp_fumble_recovery: 'idp_fr',
  idp_tackle_for_loss: 'idp_tfl',
  // Kicking (engine buckets FG 0-39 together; collapse the UI sub-buckets)
  fg_0_19: 'fg_0_39',
  fg_20_29: 'fg_0_39',
  fg_30_39: 'fg_0_39',
  fg_40_49: 'fg_40_49',
  fg_50_59: 'fg_50_plus',
  fg_50_plus: 'fg_50_plus',
  fg_60_plus: 'fg_50_plus',
  pat_made: 'xp_made',
  fg_missed_0_19: 'fg_miss',
  fg_missed_20_29: 'fg_miss',
  fg_missed_30_39: 'fg_miss',
  fg_missed_40_49: 'fg_miss',
  fg_missed_50_59: 'fg_miss',
  // Team Defense — counting (accept both the prompt's names and the actual UI keys)
  dst_sack: 'def_sack',
  dst_int: 'def_int',
  dst_interception: 'def_int',
  dst_fumble_recovery: 'def_fr',
  dst_safety: 'def_safety',
  dst_blocked_kick: 'def_blk_kick',
  dst_td: 'def_td',
  dst_defensive_td: 'def_td',
  // Special teams / return TDs (engine has one return/ST-TD bucket)
  st_td: 'def_st_td',
  dst_special_teams_td: 'def_st_td',
  dst_kick_return_td: 'def_st_td',
  dst_punt_return_td: 'def_st_td',
  // Return yardage (G9) — UI Special-Teams keys → engine return-yard keys.
  st_kick_return_yards: 'def_kr_yd',
  st_punt_return_yards: 'def_pr_yd',
  dst_kick_return_yards: 'def_kr_yd',
  dst_punt_return_yards: 'def_pr_yd',
}

/** Map a tiered DST key (`dst_pa_7_13`, `dst_ya_450_499`) to its engine key, or null. */
export function bridgeTierKey(uiKey: string): string | null {
  const pa = /^dst_pa_(.+)$/.exec(uiKey)
  if (pa) {
    const candidate = `def_pa_${pa[1]}`
    return ENGINE_KEYS.has(candidate) ? candidate : null
  }
  const ya = /^dst_ya_(.+)$/.exec(uiKey)
  if (ya) {
    const direct = `def_ya_${ya[1]}`
    if (ENGINE_KEYS.has(direct)) return direct
    // Engine collapses 450+ into a single bucket; route the UI's 450/500/550 tiers there.
    if (/^(450|500|550)/.test(ya[1])) return 'def_ya_450_plus'
    return null
  }
  return null
}

/** Resolve one UI key → engine key (static map → tier map → identity if already engine). */
export function bridgeScoringKey(uiKey: string): string | null {
  if (STATIC_MAP[uiKey]) return STATIC_MAP[uiKey]
  const tier = bridgeTierKey(uiKey)
  if (tier) return tier
  if (ENGINE_KEYS.has(uiKey)) return uiKey // already an engine key (e.g. te_premium, idp_*)
  return null
}

/**
 * Bridge a full UI rules map → engine `categoryPoints`. Deterministic: only
 * finite numeric values on mappable keys are emitted; when multiple UI keys
 * collapse to one engine key (FG buckets, YA 450+), the last non-undefined value
 * wins. Never fabricates keys the engine doesn't have.
 */
export function bridgeUiRulesToEngineCategoryPoints(
  uiRules: Record<string, number> | null | undefined,
): Record<string, number> {
  const out: Record<string, number> = {}
  if (!uiRules || typeof uiRules !== 'object') return out
  for (const [uiKey, value] of Object.entries(uiRules)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    const engineKey = bridgeScoringKey(uiKey)
    if (engineKey) out[engineKey] = value
  }
  return out
}
