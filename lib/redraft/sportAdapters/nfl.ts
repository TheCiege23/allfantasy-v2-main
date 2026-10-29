import type { ParsedStats, SportAdapter } from './types'
import { NFL_CONFIG } from '@/lib/sportConfig/configs/nfl'
import { NFL_EXTRA_PLAYER_STAT_KEYS } from '@/lib/scoring-runtime/nflExtraStatKeys'

/** After `parseRawStats`, use `calculateScoreFromSportConfig` from `@/lib/redraft/scoringEngine` for league-aware points. */

/** Canonical scoring stat keys from centralized `SportConfig` (subset may be used per league). */
export const NFL_SCORING_CATEGORY_KEYS = NFL_CONFIG.scoringCategories.map((c) => c.key)

export const nflAdapter: SportAdapter = {
  parseRawStats(apiStats: Record<string, number>): ParsedStats {
    return {
      pass_yds: apiStats.pass_yds ?? 0,
      pass_td: apiStats.pass_td ?? 0,
      pass_int: apiStats.pass_int ?? 0,
      pass_300_bonus: apiStats.pass_300_bonus ?? 0,
      pass_400_bonus: apiStats.pass_400_bonus ?? 0,
      rush_yds: apiStats.rush_yds ?? 0,
      rush_td: apiStats.rush_td ?? 0,
      rush_100_bonus: apiStats.rush_100_bonus ?? 0,
      rec: apiStats.rec ?? 0,
      rec_yds: apiStats.rec_yds ?? 0,
      rec_td: apiStats.rec_td ?? 0,
      rec_100_bonus: apiStats.rec_100_bonus ?? 0,
      te_premium: apiStats.te_premium ?? 0,
      two_pt: apiStats.two_pt ?? 0,
      fum_lost: apiStats.fum_lost ?? 0,
      fumble_td: apiStats.fumble_td ?? 0,
      fg_0_39: apiStats.fg_0_39 ?? 0,
      fg_40_49: apiStats.fg_40_49 ?? 0,
      fg_50_plus: apiStats.fg_50_plus ?? 0,
      fg_miss: apiStats.fg_miss ?? 0,
      xp_made: apiStats.xp_made ?? 0,
      idp_solo: apiStats.idp_solo ?? 0,
      idp_assist: apiStats.idp_assist ?? 0,
      idp_sack: apiStats.idp_sack ?? 0,
      idp_int: apiStats.idp_int ?? 0,
      idp_pd: apiStats.idp_pd ?? 0,
      idp_ff: apiStats.idp_ff ?? 0,
      idp_fr: apiStats.idp_fr ?? 0,
      idp_td: apiStats.idp_td ?? 0,
      idp_safety: apiStats.idp_safety ?? 0,
      idp_tfl: apiStats.idp_tfl ?? 0,
      idp_qb_hit: apiStats.idp_qb_hit ?? 0,
      ...Object.fromEntries(NFL_EXTRA_PLAYER_STAT_KEYS.map((key) => [key, apiStats[key] ?? 0])),
    }
  },
  getLineupLockTime(_sport: string, gameTimeIso: string): Date {
    return new Date(gameTimeIso)
  },
}

export function getByeWeek(_playerId: string): number | null {
  return null
}

export function getInjuryStatus(_player: { injuryStatus?: string | null }): string | null {
  return _player.injuryStatus ?? null
}

export function getDefenseRank(_teamAbbr: string, _position: string): number {
  void _teamAbbr
  void _position
  return 16
}
