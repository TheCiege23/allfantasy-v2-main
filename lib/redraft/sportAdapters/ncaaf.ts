import type { ParsedStats, SportAdapter } from './types'
import { NCAAF_CONFIG } from '@/lib/sportConfig/configs/ncaaf'

export const NCAAF_SCORING_CATEGORY_KEYS = NCAAF_CONFIG.scoringCategories.map((c) => c.key)

export const ncaafAdapter: SportAdapter = {
  parseRawStats(raw: Record<string, number>): ParsedStats {
    return {
      pass_yds: raw.pass_yds ?? 0,
      pass_td: raw.pass_td ?? 0,
      pass_int: raw.pass_int ?? 0,
      rush_yds: raw.rush_yds ?? 0,
      rush_td: raw.rush_td ?? 0,
      rec: raw.rec ?? 0,
      rec_yds: raw.rec_yds ?? 0,
      rec_td: raw.rec_td ?? 0,
      kr_td: raw.kr_td ?? 0,
      pr_td: raw.pr_td ?? 0,
      fumble_td: raw.fumble_td ?? 0,
      te_premium: raw.te_premium ?? 0,
      fg_made: raw.fg_made ?? 0,
      xp_made: raw.xp_made ?? 0,
      fg_miss: raw.fg_miss ?? 0,
      xp_miss: raw.xp_miss ?? 0,
      idp_solo: raw.idp_solo ?? 0,
      idp_tackle: raw.idp_tackle ?? 0,
      idp_sack: raw.idp_sack ?? 0,
      idp_pd: raw.idp_pd ?? 0,
      idp_tfl: raw.idp_tfl ?? 0,
      idp_td: raw.idp_td ?? 0,
      idp_int: raw.idp_int ?? 0,
      idp_int_return_yards: raw.idp_int_return_yards ?? 0,
      two_pt: raw.two_pt ?? 0,
      fum_lost: raw.fum_lost ?? 0,
      def_td: raw.def_td ?? 0,
      def_int: raw.def_int ?? 0,
      def_fr: raw.def_fr ?? 0,
      def_sack: raw.def_sack ?? 0,
    }
  },
  getLineupLockTime(_sport: string, gameTimeIso: string): Date {
    return new Date(gameTimeIso)
  },
}
