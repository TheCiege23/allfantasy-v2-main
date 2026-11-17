/**
 * DramaScoreCalculator — scores a drama event 0–100 based on type and context.
 */

import type { DramaType } from './types'
import { normalizeSportForDrama, getDramaCadenceConfig } from './SportDramaResolver'

const BASE_SCORES: Record<DramaType, number> = {
  REVENGE_GAME: 75,
  MAJOR_UPSET: 85,
  RIVALRY_CLASH: 80,
  WIN_STREAK: 65,
  LOSING_STREAK: 60,
  PLAYOFF_BUBBLE: 70,
  TITLE_DEFENSE: 80,
  TRADE_FALLOUT: 65,
  REBUILD_PROGRESS: 55,
  DYNASTY_SHIFT: 75,
}

interface DramaScoreInput {
  dramaType: DramaType
  sport?: string
  /** Optional: streak length, upset margin, etc. to boost. */
  intensityFactor?: number
  /** Optional: number of related managers/teams (more = slightly higher). */
  relatedCount?: number
  rivalryScore?: number
  upsetMagnitude?: number
  playoffSwing?: number
  recencyWeight?: number
  managerBehaviorHeat?: number
  leagueGraphHeat?: number
}

/**
 * Compute drama score 0–100 for an event.
 */
export function calculateDramaScore(input: DramaScoreInput): number {
  const base = BASE_SCORES[input.dramaType] ?? 50
  const intensity = Math.min(1.3, 1 + (input.intensityFactor ?? 0) * 0.1)
  const related = input.relatedCount != null && input.relatedCount > 0
    ? Math.min(1.1, 1 + input.relatedCount * 0.02)
    : 1

  const sportNorm = normalizeSportForDrama(input.sport)
  const cadence = sportNorm ? getDramaCadenceConfig(sportNorm) : null
  const upsetMultiplier =
    input.dramaType === 'MAJOR_UPSET' && cadence
      ? cadence.upsetScoreMultiplier
      : 1
  const rivalryBoost = input.rivalryScore != null ? Math.min(1.18, 1 + input.rivalryScore / 220) : 1
  const upsetBoost =
    input.upsetMagnitude != null ? Math.min(1.15, 1 + input.upsetMagnitude / 250) : 1
  const playoffBoost =
    input.playoffSwing != null ? Math.min(1.12, 1 + Math.abs(input.playoffSwing) / 1.6) : 1
  const recencyBoost =
    input.recencyWeight != null ? Math.min(1.1, Math.max(0.92, input.recencyWeight)) : 1
  const behaviorHeatBoost =
    input.managerBehaviorHeat != null ? Math.min(1.08, 1 + input.managerBehaviorHeat / 400) : 1
  const graphHeatBoost =
    input.leagueGraphHeat != null ? Math.min(1.08, 1 + input.leagueGraphHeat / 420) : 1

  const raw =
    base *
    intensity *
    related *
    upsetMultiplier *
    rivalryBoost *
    upsetBoost *
    playoffBoost *
    recencyBoost *
    behaviorHeatBoost *
    graphHeatBoost
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10))
}
