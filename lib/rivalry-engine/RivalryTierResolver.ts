/**
 * RivalryTierResolver — maps rivalry score to tier (Emerging, Heated, Blood Feud, League Classic).
 * Thresholds are configurable.
 */

import type { RivalryTier } from './types'
import { RIVALRY_TIERS, DEFAULT_TIER_THRESHOLDS } from './types'

interface TierThresholds {
  Emerging: { min: number; max?: number }
  Heated: { min: number; max?: number }
  'Blood Feud': { min: number; max?: number }
  'League Classic': { min: number; max?: number }
}

/**
 * Resolve rivalry score to a tier. Score is assumed 0–100.
 */
export function resolveRivalryTier(
  score: number,
  thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): RivalryTier {
  const clamped = Math.max(0, Math.min(100, score))
  const order: RivalryTier[] = ['League Classic', 'Blood Feud', 'Heated', 'Emerging']
  for (const tier of order) {
    const t = thresholds[tier]
    if (t.min <= clamped && (t.max == null || clamped <= t.max)) return tier
  }
  return 'Emerging'
}

/**
 * Get display label for tier (for UI/badges).
 */
export function getRivalryTierLabel(tier: RivalryTier): string {
  return tier
}

/**
 * Get badge color hint for tier (CSS class or color name).
 */
export function getRivalryTierBadgeColor(tier: RivalryTier): string {
  switch (tier) {
    case 'League Classic':
      return 'amber'
    case 'Blood Feud':
      return 'red'
    case 'Heated':
      return 'orange'
    case 'Emerging':
    default:
      return 'blue'
  }
}

export { RIVALRY_TIERS, DEFAULT_TIER_THRESHOLDS }
