import type { ParsedStats, SportAdapter } from './types'
import { NCAAB_CONFIG } from '@/lib/sportConfig/configs/ncaab'

export const NCAAB_SCORING_CATEGORY_KEYS = NCAAB_CONFIG.scoringCategories.map((c) => c.key)

export const ncaabAdapter: SportAdapter = {
  parseRawStats(raw: Record<string, number>): ParsedStats {
    return {
      pts: raw.pts ?? 0,
      reb: raw.reb ?? 0,
      ast: raw.ast ?? 0,
      stl: raw.stl ?? 0,
      blk: raw.blk ?? 0,
      to: raw.to ?? 0,
      threes: raw.threes ?? 0,
      ftm: raw.ftm ?? 0,
      dbl_dbl: raw.dbl_dbl ?? 0,
      trpl_dbl: raw.trpl_dbl ?? 0,
      quad_dbl: raw.quad_dbl ?? 0,
      min: raw.min ?? 0,
      pf: raw.pf ?? 0,
      fg2m: raw.fg2m ?? 0,
      fg2_miss: raw.fg2_miss ?? 0,
      fg3_miss: raw.fg3_miss ?? 0,
      ft_miss: raw.ft_miss ?? 0,
    }
  },
  getLineupLockTime(_sport: string, gameTimeIso: string): Date {
    return new Date(gameTimeIso)
  },
}
