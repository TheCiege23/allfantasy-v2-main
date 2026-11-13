/**
 * Analyzes roster composition: position distribution, value concentration, stacks.
 * Feeds StrategyPatternAnalyzer and meta dashboards.
 */
import type { PositionDistribution } from './types'

export interface RosterCompositionResult {
  positionCounts: PositionDistribution
  positionValues: PositionDistribution
  totalValue: number
  /** Top N players' value / total (concentration). */
  assetConcentration: number
  /** Rookie vs veteran count (if ages available). */
  rookieCount?: number
  veteranCount?: number
  /** Same-team stacks (e.g. QB+WR). */
  stacks: Array<{ type: string; description: string; playerIds: string[] }>
}

/**
 * Extract position counts from roster playerData-like structure (array of { position } or record of ids → position).
 */
export function getPositionCountsFromRoster(players: Array<{ position?: string }>): PositionDistribution {
  const counts: PositionDistribution = {}
  for (const p of players) {
    const pos = (p.position ?? 'UNK').toUpperCase()
    counts[pos] = (counts[pos] ?? 0) + 1
  }
  return counts
}
