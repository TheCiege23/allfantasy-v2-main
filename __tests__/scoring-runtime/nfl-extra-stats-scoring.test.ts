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

  it('every new rule is reachable from a commissioner panel row', () => {
    const panelEngineKeys = new Set(
      NFL_SCORING_CATEGORIES.flatMap((c) => c.rows.map((r) => bridgeScoringKey(r.key))).filter(Boolean),
    )
    expect(NFL_EXTRA_STATS.map((s) => s.key).filter((k) => !panelEngineKeys.has(k))).toEqual([])
  })
})
