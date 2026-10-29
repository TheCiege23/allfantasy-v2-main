import type { ParsedStats, SportAdapter } from './types'
import { NHL_CONFIG } from '@/lib/sportConfig/configs/nhl'

export const NHL_SCORING_CATEGORY_KEYS = NHL_CONFIG.scoringCategories.map((c) => c.key)

export const nhlAdapter: SportAdapter = {
  parseRawStats(raw: Record<string, number>): ParsedStats {
    // Every engine category, so a category added to the config is never silently dropped here.
    const parsed: ParsedStats = {}
    for (const key of NHL_SCORING_CATEGORY_KEYS) parsed[key] = raw[key] ?? 0
    return parsed
  },
  getLineupLockTime(_sport: string, gameTimeIso: string): Date {
    return new Date(gameTimeIso)
  },
}

export function getPowerPlayTime(_playerId: string): number {
  void _playerId
  return 0
}
