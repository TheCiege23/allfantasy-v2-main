/**
 * Shared deterministic player-value signal for the redraft War Room engines.
 *
 * Precedence (redraft, season-horizon): current-week projection → season-to-date
 * average actual → ADP/ranking value (rest-of-season proxy) → none. ADP is
 * inverted to a comparable value scale (lower ADP = higher value). No fabrication:
 * `none` means the player has no projection, actual, or ranking signal.
 */
import type { RedraftPlayerFact } from './types'

export type ValueSource = 'projection' | 'ros_projection' | 'season_avg' | 'adp' | 'none'

interface PlayerValue {
  value: number
  source: ValueSource
}

/** Map an average overall ADP (lower = better) onto a positive value scale. */
export function adpToValue(adp: number): number {
  return Math.round((Math.max(0, 260 - adp) / 10) * 100) / 100
}

/** Best available value signal for a player, by the redraft precedence. */
export function playerValue(p: RedraftPlayerFact): PlayerValue {
  if (p.weekProjection != null) return { value: p.weekProjection, source: 'projection' }
  if (p.restOfSeasonProjection != null) {
    const weeklyEquivalent =
      p.restOfSeasonProjection > 40 ? p.restOfSeasonProjection / 12 : p.restOfSeasonProjection
    return { value: Math.round(weeklyEquivalent * 100) / 100, source: 'ros_projection' }
  }
  if (p.seasonAvgActual != null) return { value: p.seasonAvgActual, source: 'season_avg' }
  if (p.adp != null) return { value: adpToValue(p.adp), source: 'adp' }
  return { value: 0, source: 'none' }
}

/** Confidence implied by the value source backing a recommendation. */
export function confidenceForSource(source: ValueSource): 'high' | 'medium' | 'low' | 'none' {
  if (source === 'projection') return 'high'
  if (source === 'ros_projection') return 'medium'
  if (source === 'season_avg') return 'medium'
  if (source === 'adp') return 'low'
  return 'none'
}
