/**
 * StatNormalizationService — standardizes raw stat payloads across sports for the warehouse.
 * Ensures sport-specific data is normalized without mixing incompatible structures.
 */

import type { WarehouseSport } from './types'
import { normalizeSportForWarehouse } from './types'

interface NormalizedStatMap {
  [key: string]: number
}

const SPORT_STAT_KEYS: Record<WarehouseSport, string[]> = {
  NFL: ['passingYards', 'passingTds', 'int', 'rushingYards', 'rushingTds', 'receptions', 'receivingYards', 'receivingTds', 'targets', 'fumbles'],
  NHL: ['goals', 'assists', 'shots', 'plusMinus', 'pim', 'ppGoals', 'ppAssists', 'shGoals', 'hits', 'blocks'],
  NBA: ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'threePointersMade', 'minutes'],
  MLB: ['ab', 'h', 'r', 'rbi', 'hr', 'sb', 'bb', 'so', 'avg', 'obp', 'slg', 'wins', 'saves', 'era', 'whip', 'inningsPitched'],
  NCAAB: ['points', 'rebounds', 'assists', 'steals', 'blocks', 'turnovers', 'threePointersMade', 'minutes'],
  NCAAF: ['passingYards', 'passingTds', 'int', 'rushingYards', 'rushingTds', 'receptions', 'receivingYards', 'receivingTds'],
  SOCCER: ['goals', 'assists', 'shots', 'shotsOnGoal', 'minutes', 'cleanSheets', 'goalsConceded'],
}

/**
 * Normalize a raw stat payload into a flat map of numeric values for a given sport.
 */
export function normalizeStatPayload(
  sport: string,
  raw: Record<string, unknown>
): NormalizedStatMap {
  const s = normalizeSportForWarehouse(sport)
  const keys = SPORT_STAT_KEYS[s] ?? SPORT_STAT_KEYS.NFL
  const out: NormalizedStatMap = {}
  for (const k of keys) {
    const v = raw[k]
    if (typeof v === 'number' && !Number.isNaN(v)) out[k] = v
    else if (typeof v === 'string') {
      const n = parseFloat(v)
      if (!Number.isNaN(n)) out[k] = n
    }
  }
  return out
}

