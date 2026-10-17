import type { ParsedStats, SportAdapter } from './types'
import { SOCCER_CONFIG } from '@/lib/sportConfig/configs/soccer'

export const SOCCER_SCORING_CATEGORY_KEYS = SOCCER_CONFIG.scoringCategories.map((c) => c.key)

export const soccerAdapter: SportAdapter = {
  parseRawStats(raw: Record<string, number>): ParsedStats {
    return {
      goals: raw.goals ?? 0,
      assists: raw.assists ?? 0,
      clean_sheet_def: raw.clean_sheet_def ?? 0,
      clean_sheet_gk: raw.clean_sheet_gk ?? 0,
      saves: raw.saves ?? 0,
      yellow_card: raw.yellow_card ?? 0,
      red_card: raw.red_card ?? 0,
      own_goal: raw.own_goal ?? 0,
      pen_miss: raw.pen_miss ?? 0,
      pen_save: raw.pen_save ?? 0,
      // Box-score keys the panel can score (soccerStatNormalization.ts).
      shots_on_target: raw.shots_on_target ?? 0,
      shots: raw.shots ?? 0,
      minutes_played: raw.minutes_played ?? 0,
      appearance: raw.appearance ?? 0,
      gk_goals_against: raw.gk_goals_against ?? 0,
      fouls_committed: raw.fouls_committed ?? 0,
      fouls_drawn: raw.fouls_drawn ?? 0,
    }
  },
  getLineupLockTime(_sport: string, gameTimeIso: string): Date {
    return new Date(gameTimeIso)
  },
}

export function getFixtureDifficulty(_teamId: string, _week: number): 1 | 2 | 3 | 4 | 5 {
  void _teamId
  void _week
  return 3
}
