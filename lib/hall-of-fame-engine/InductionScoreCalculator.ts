/**
 * InductionScoreCalculator — computes Hall of Fame induction scores from raw metrics.
 * Explainable weights; supports all entity types and categories.
 */

import type { HallOfFameEntityType, HallOfFameCategory } from './types'

interface InductionMetrics {
  championships?: number
  seasonsPlayed?: number
  dominance?: number
  longevity?: number
  significance?: number
  upsetMagnitude?: number
  dynastyLength?: number
  comebackMagnitude?: number
  rivalryIntensity?: number
  recordValue?: number
}

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)

/**
 * Compute a 0–1 induction score from metrics and entity type/category.
 */
export function computeInductionScore(
  metrics: InductionMetrics,
  entityType: HallOfFameEntityType,
  category: HallOfFameCategory
): number {
  const c = championships(metrics)
  const s = seasons(metrics)
  const d = dominance(metrics)
  const l = longevity(metrics)
  const sig = significance(metrics)
  const upset = upsetMagnitude(metrics)
  const dynasty = dynastyLength(metrics)
  const comeback = comebackMagnitude(metrics)
  const rivalry = rivalryIntensity(metrics)

  switch (category) {
    case 'all_time_great_managers':
      return 0.4 * d + 0.35 * c + 0.15 * l + 0.1 * s
    case 'all_time_great_teams':
      return 0.35 * d + 0.35 * c + 0.2 * l + 0.1 * sig
    case 'greatest_moments':
      return 0.5 * sig + 0.3 * d + 0.2 * c
    case 'biggest_upsets':
      return 0.6 * upset + 0.25 * sig + 0.15 * d
    case 'best_championship_runs':
      return 0.5 * c + 0.3 * d + 0.2 * l
    case 'longest_dynasties':
      return 0.5 * dynasty + 0.3 * c + 0.2 * d
    case 'historic_comebacks':
      return 0.5 * comeback + 0.3 * sig + 0.2 * d
    case 'iconic_rivalries':
      return 0.5 * rivalry + 0.3 * sig + 0.2 * d
    default:
      return 0.3 * d + 0.3 * c + 0.2 * l + 0.2 * sig
  }
}

function championships(m: InductionMetrics): number {
  if (m.championships == null) return 0
  return clamp01(Math.min(1, m.championships / 5))
}

function seasons(m: InductionMetrics): number {
  if (m.seasonsPlayed == null) return 0
  return clamp01(Math.min(1, m.seasonsPlayed / 15))
}

function dominance(m: InductionMetrics): number {
  if (m.dominance == null) return 0
  return clamp01(m.dominance)
}

function longevity(m: InductionMetrics): number {
  if (m.longevity == null) return 0
  return clamp01(m.longevity)
}

function significance(m: InductionMetrics): number {
  if (m.significance == null) return 0
  return clamp01(m.significance)
}

function upsetMagnitude(m: InductionMetrics): number {
  if (m.upsetMagnitude == null) return 0
  return clamp01(m.upsetMagnitude)
}

function dynastyLength(m: InductionMetrics): number {
  if (m.dynastyLength == null) return 0
  return clamp01(Math.min(1, m.dynastyLength / 5))
}

function comebackMagnitude(m: InductionMetrics): number {
  if (m.comebackMagnitude == null) return 0
  return clamp01(m.comebackMagnitude)
}

function rivalryIntensity(m: InductionMetrics): number {
  if (m.rivalryIntensity == null) return 0
  return clamp01(m.rivalryIntensity)
}
