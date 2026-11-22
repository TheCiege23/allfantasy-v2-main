/**
 * Analyzes roster composition: position distribution, value concentration, stacks.
 * Feeds StrategyPatternAnalyzer and meta dashboards.
 */
import type { PositionDistribution } from './types'

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
