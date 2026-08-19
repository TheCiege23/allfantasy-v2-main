/**
 * Trade acceptance probability — hand-set logistic model.
 *
 * HONESTY PASS (Slice 16). This model has six features, but FOUR of them
 * (`ldiAlignment`, `needsFitScore`, `archetypeMatch`, `dealShapeScore`) have no
 * producer anywhere in the codebase — `ldiScore`, `archetypeMatchScore` and
 * `dealShapeScore` are emitted by nothing, and the real `needsFitScore` lives
 * in a different engine and is never attached to the object passed in here.
 *
 * Previously each missing feature silently defaulted to `50`, which after the
 * `/10` scaling contributed a CONSTANT `0.6*5 + 0.7*5 + 0.5*5 + 0.4*5 = 11.0`
 * to `z` against an intercept of `-4`. In other words: two thirds of the model
 * was a fixed offset that inflated every probability, while the output was
 * presented as a per-trade percentage.
 *
 * Now missing features are `null` and are EXCLUDED from `z` (their weight is
 * not applied at all, rather than applied to a fabricated midpoint), and the
 * result carries `featureCoverage` + `missingFeatures` so callers can see how
 * much of the model actually ran. `degraded` is true when the majority of the
 * signal is unavailable.
 *
 * Real signals DO exist for these features elsewhere — `lib/engine/acceptance.ts`
 * consumes genuine needs-fit, per-position LDI and manager tendencies. Routing
 * this model onto those inputs is the follow-up; this change stops it from
 * overstating what it knows in the meantime.
 */

/** A feature is `null` when no real value was supplied. Never defaulted. */
export interface AcceptanceFeatures {
  fairnessScore: number | null
  ldiAlignment: number | null
  needsFitScore: number | null
  archetypeMatch: number | null
  dealShapeScore: number | null
  volatilityDelta: number | null
}

const DEFAULT_WEIGHTS = {
  fairness: 0.8,
  ldi: 0.6,
  needs: 0.7,
  archetype: 0.5,
  dealShape: 0.4,
  volatility: -0.5,
  intercept: -4,
}

const FEATURE_WEIGHT_KEYS: Array<[keyof AcceptanceFeatures, keyof typeof DEFAULT_WEIGHTS]> = [
  ['fairnessScore', 'fairness'],
  ['ldiAlignment', 'ldi'],
  ['needsFitScore', 'needs'],
  ['archetypeMatch', 'archetype'],
  ['dealShapeScore', 'dealShape'],
  ['volatilityDelta', 'volatility'],
]

export interface AcceptanceResult {
  probability: number
  /** Fraction of the model's features that had real values (0–1). */
  featureCoverage: number
  /** Feature names that had no producer / no supplied value. */
  missingFeatures: string[]
  /** True when most of the model's signal was unavailable. */
  degraded: boolean
}

function isUsable(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Compute acceptance probability from whatever features are genuinely present.
 * Missing features contribute NOTHING (no fabricated midpoint).
 */
export function acceptanceProbabilityDetailed(
  features: AcceptanceFeatures,
  customWeights?: Partial<typeof DEFAULT_WEIGHTS>,
): AcceptanceResult {
  const w = { ...DEFAULT_WEIGHTS, ...customWeights }

  let z = w.intercept
  const missingFeatures: string[] = []
  let present = 0
  for (const [featureKey, weightKey] of FEATURE_WEIGHT_KEYS) {
    const value = features[featureKey]
    if (isUsable(value)) {
      z += w[weightKey] * value
      present += 1
    } else {
      missingFeatures.push(featureKey)
    }
  }

  const probability = Math.max(0.05, Math.min(0.95, 1 / (1 + Math.exp(-z))))
  const featureCoverage = present / FEATURE_WEIGHT_KEYS.length
  return {
    probability,
    featureCoverage,
    missingFeatures,
    degraded: featureCoverage < 0.5,
  }
}

/** Back-compatible scalar form. Prefer `acceptanceProbabilityDetailed`. */
export function acceptanceProbability(
  features: AcceptanceFeatures,
  customWeights?: Partial<typeof DEFAULT_WEIGHTS>,
): number {
  return acceptanceProbabilityDetailed(features, customWeights).probability
}

export function acceptanceProbabilityWithLiquidity(
  features: AcceptanceFeatures,
  liquidityScore: number,
  customWeights?: Partial<typeof DEFAULT_WEIGHTS>,
): {
  probability: number
  liquidityAdjusted: boolean
  counterRequired: boolean
  featureCoverage: number
  missingFeatures: string[]
  degraded: boolean
} {
  const base = acceptanceProbabilityDetailed(features, customWeights)

  const liquidityNorm = liquidityScore / 100
  const adjustment = (liquidityNorm - 0.5) * 0.1
  const adjusted = Math.max(0.05, Math.min(0.95, base.probability + adjustment))

  return {
    probability: adjusted,
    liquidityAdjusted: Math.abs(adjustment) > 0.01,
    counterRequired: adjusted < 0.25 && liquidityNorm < 0.4,
    featureCoverage: base.featureCoverage,
    missingFeatures: base.missingFeatures,
    degraded: base.degraded,
  }
}

/**
 * Map trade-driver output onto the feature vector. Fields with no producer stay
 * `null` — the whole point of the honesty pass. `fairnessScore` and
 * `volatilityDelta` are the two features that are genuinely computed today, and
 * they are only emitted when their own inputs are real.
 */
export function extractAcceptanceFeatures(tradeDriverData: {
  lineupImpactScore?: number
  vorpScore?: number
  marketScore?: number
  behaviorScore?: number
  acceptProbability?: number
  ldiScore?: number
  needsFitScore?: number
  archetypeMatchScore?: number
  dealShapeScore?: number
}): AcceptanceFeatures {
  const fairnessParts = [
    tradeDriverData.lineupImpactScore,
    tradeDriverData.vorpScore,
    tradeDriverData.marketScore,
  ].filter(isUsable)
  const fairness =
    fairnessParts.length > 0
      ? fairnessParts.reduce((sum, n) => sum + n, 0) / fairnessParts.length
      : null

  const volatility =
    isUsable(tradeDriverData.lineupImpactScore) && isUsable(tradeDriverData.marketScore)
      ? Math.abs(tradeDriverData.lineupImpactScore - tradeDriverData.marketScore) / 20
      : null

  const scaled = (value: number | undefined) => (isUsable(value) ? value / 10 : null)

  return {
    fairnessScore: fairness != null ? fairness / 10 : null,
    ldiAlignment: scaled(tradeDriverData.ldiScore),
    needsFitScore: scaled(tradeDriverData.needsFitScore),
    archetypeMatch: scaled(tradeDriverData.archetypeMatchScore),
    dealShapeScore: scaled(tradeDriverData.dealShapeScore),
    volatilityDelta: volatility,
  }
}
