import type { FutureStrengthSnapshot } from './types'

export function computeDynastyStrengthScore(future: FutureStrengthSnapshot): number {
  const { projectedStrengthNextYear, projectedStrength3Years, projectedStrength5Years } = future
  const weighted =
    projectedStrengthNextYear * 0.45 +
    projectedStrength3Years * 0.35 +
    projectedStrength5Years * 0.2
  return Math.round(Math.min(100, Math.max(0, weighted)))
}

