import { describe, expect, it } from 'vitest'

import { normalizeNflTeamDefenseWeeklyStats, normalizeNflWeeklyStats } from '@/lib/scoring-runtime/nflStatNormalization'
import { NFL_EXTRA_STATS } from '@/lib/scoring-runtime/nflExtraStatKeys'
import { resolveLeagueScoringRules } from '@/lib/redraft/leagueScoringRules'
import { scoreStatsWithCategories } from '@/lib/redraft/scoringEngine'
import { NFL_SCORING_CATEGORIES } from '@/lib/nfl-scoring/NflScoringCategories'
import { bridgeScoringKey } from '@/lib/nfl-scoring/scoringKeyBridge'

/*
 * The most-used NFL rules that scored nothing before (owner, 2026-10-25: "add the most common NFL
 * scoring rules"). Each is scored from the provider's own count, so this drives the whole path —
 * raw Sleeper week payload → stored stats → the commissioner panel's rules → points — with the
 * real normalizer, bridge, resolver and scorer.
 *
 * The raw keys are Sleeper's stat names as stored in production `player_game_stats.stat_payload`.
 */
const RB_WEEK = {
  rush_yd: 112, rush_td: 1, rush_att: 21, rush_fd: 6, rush_40p: 1, rush_td_40p: 1, rush_td_50p: 0,
  rec: 4, rec_yd: 31, rec_fd: 2, rec_tgt: 5, bonus_rec_rb: 4, bonus_fd_rb: 8,
  bonus_rush_yd_100: 1, bonus_rush_rec_yd_100: 1, bonus_rush_att_20: 1, fum: 1, fum_lost: 0,
  st_td: 0, kr_yd: 48, pts_ppr: 31.3,
}

const round = (n: number) => Math.round(n * 100) / 100

const score = (rules: Record<string, number>, stats: Record<string, number>) => {
  const { categories, overrides } = resolveLeagueScoringRules({ sport: 'NFL', settings: { nfl_scoring_config: { rules } } })!
  return round(scoreStatsWithCategories(categories, stats, overrides))
}

/** The four rules every test league sets; 112 rush yd, 1 rush TD, 4 rec, 31 rec yd = 22.3. */
const BASE = { rushing_yards: 0.1, rushing_td: 6, reception: 0.5, receiving_yards: 0.1, one_hundred_yd_rush_bonus: 0 }

describe('NFL provider-count rules', () => {
  it('the stats are kept from the raw week payload instead of dropped', () => {
    const stats = normalizeNflWeeklyStats(RB_WEEK)
    expect(stats).toMatchObject({ rush_fd: 6, rush_att: 21, rush_td_40p: 1, bonus_rec_rb: 4, bonus_fd_rb: 8, fum: 1, kr_yd: 48 })
    expect(stats).not.toHaveProperty('pts_ppr')
    expect(normalizeNflTeamDefenseWeeklyStats({ def_st_ff: 1, def_st_fum_rec: 2 })).toMatchObject({ def_st_ff: 1, def_st_fum_rec: 2 })
  })

  it('a league that sets none of them scores exactly as before', () => {
    const withExtras = normalizeNflWeeklyStats(RB_WEEK)
    const withoutExtras = Object.fromEntries(
      Object.entries(withExtras).filter(([k]) => !NFL_EXTRA_STATS.some((s) => s.key === k)),
    )
    expect(score(BASE, withExtras)).toBe(score(BASE, withoutExtras))
    expect(score(BASE, withExtras)).toBe(22.3)
  })

  it('panel values on first downs, long-TD bonuses, RB catch bonuses and fumbles now score', () => {
    const rules = {
      ...BASE,
      rushing_first_down: 0.5, receiving_first_down: 0.5, forty_yd_rush_td_bonus: 2, rec_bonus_rb: 0.25,
      one_hundred_combined_bonus: 1, twenty_carries_bonus: 1, fumble: -1, st_player_kick_return_yards: 0.04,
    }
    const extra = 6 * 0.5 + 2 * 0.5 + 2 + 4 * 0.25 + 1 + 1 - 1 + 48 * 0.04
    expect(score(rules, normalizeNflWeeklyStats(RB_WEEK))).toBe(round(22.3 + extra))
  })

  it('team defence: forced fumbles, 3-and-outs, 4th-down stops, tackles and return yards score from the DEF row', () => {
    const def = normalizeNflTeamDefenseWeeklyStats({
      sack: 3, pts_allow: 17, yds_allow: 310, ff: 2, def_3_and_out: 4, def_4_and_stop: 1, tkl_loss: 5, qb_hit: 6,
      tkl: 60, tkl_solo: 40, tkl_ast: 20, int_ret_yd: 35, def_pass_def: 7, def_forced_punts: 5, sack_yd: 21,
    })
    expect(def).toMatchObject({ def_sack: 3, def_ff: 2, def_3_and_out: 4, def_4_and_stop: 1, def_tkl_loss: 5, def_qb_hit: 6, def_int_ret_yd: 35 })
    const rules = {
      dst_sack: 1, dst_pa_14_20: 1, dst_forced_fumble: 1, dst_three_and_out: 0.5, dst_fourth_down_stop: 1,
      dst_tackle_for_loss: 0.5, dst_qb_hit: 0.25, dst_int_return_yards: 0.1, dst_pts_per_pa: -0.1,
    }
    // 3 + 1 + 2 + 2 + 1 + 2.5 + 1.5 + 3.5 − 1.7, every other DEF rule at its preset/0 default.
    const { categories, overrides } = resolveLeagueScoringRules({ sport: 'NFL', settings: { nfl_scoring_config: { rules } } })!
    const only = categories.filter((c) => c.group === 'team_def')
    expect(round(scoreStatsWithCategories(only, def, overrides))).toBe(round(3 + 1 + 2 + 2 + 1 + 2.5 + 1.5 + 3.5 - 1.7))
  })

  it('kicker: FG made, points per FG yard and per yard over 30', () => {
    const k = normalizeNflWeeklyStats({ fgm_30_39: 1, fgm_40_49: 1, fgm: 2, fgm_yds: 81, fgm_yds_over_30: 21, xpm: 3 })
    expect(score({ fg_30_39: 0, fg_40_49: 0, pat_made: 0, fg_made: 3, fg_per_yard: 0.1, fg_per_yard_over_30: 0.1 }, k)).toBe(round(6 + 8.1 + 2.1))
  })

  it('IDP: Sleeper-named tackles, passes defended, recoveries, TFLs, TDs and safeties now reach the IDP rules', () => {
    const lb = normalizeNflWeeklyStats({
      idp_tkl_solo: 7, idp_tkl_ast: 4, idp_pass_def: 2, idp_fum_rec: 1, idp_tkl_loss: 2, idp_def_td: 1, idp_safe: 1,
      idp_tkl: 11, bonus_tkl_10p: 1, idp_sack_yd: 9,
    })
    expect(lb).toMatchObject({ idp_solo: 7, idp_assist: 4, idp_pd: 2, idp_fr: 1, idp_tfl: 2, idp_td: 1, idp_safety: 1, idp_tkl: 11, bonus_tkl_10p: 1 })
    const settings = { sportConfig: { enableIDP: true }, nfl_scoring_config: { rules: { idp_ten_tackle_bonus: 2, idp_sack_yards: 0.1 } } }
    const { categories, overrides } = resolveLeagueScoringRules({ sport: 'NFL', settings })!
    expect(categories.some((c) => c.key === 'bonus_tkl_10p')).toBe(true)
    expect(overrides).toMatchObject({ bonus_tkl_10p: 2, idp_sack_yd: 0.1 })
    // Without IDP on, the new IDP rules are not scored, like every other IDP rule.
    const off = resolveLeagueScoringRules({ sport: 'NFL', settings: { nfl_scoring_config: { rules: {} } } })!
    expect(off.categories.some((c) => c.key === 'bonus_tkl_10p')).toBe(false)
  })

  it('every new rule is reachable from a commissioner panel row', () => {
    const panelEngineKeys = new Set(
      NFL_SCORING_CATEGORIES.flatMap((c) => c.rows.map((r) => bridgeScoringKey(r.key))).filter(Boolean),
    )
    expect(NFL_EXTRA_STATS.map((s) => s.key).filter((k) => !panelEngineKeys.has(k))).toEqual([])
  })
})
