import type { ParsedStats, SportAdapter } from './types'
import { NBA_CONFIG } from '@/lib/sportConfig/configs/nba'

export const NBA_SCORING_CATEGORY_KEYS = NBA_CONFIG.scoringCategories.map((c) => c.key)

export const nbaAdapter: SportAdapter = {
  parseRawStats(raw: Record<string, number>): ParsedStats {
    return {
      pts: raw.pts ?? 0,
      reb: raw.reb ?? 0,
      ast: raw.ast ?? 0,
      stl: raw.stl ?? 0,
      blk: raw.blk ?? 0,
      to: raw.to ?? 0,
      threes: raw.threes ?? 0,
      fgm: raw.fgm ?? 0,
      ftm: raw.ftm ?? 0,
      fga: raw.fga ?? 0,
      fta: raw.fta ?? 0,
      dbl_dbl: raw.dbl_dbl ?? 0,
      trpl_dbl: raw.trpl_dbl ?? 0,
    }
  },
  getLineupLockTime(_sport: string, gameTimeIso: string): Date {
    return new Date(gameTimeIso)
  },
}

export function getLoadManagementRisk(_playerId: string): 'high' | 'medium' | 'low' {
  void _playerId
  return 'low'
}

export function getBackToBackSchedule(_teamId: string, _week: number): boolean {
  void _teamId
  void _week
  return false
}
