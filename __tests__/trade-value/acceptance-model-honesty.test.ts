/**
 * Slice 16 — acceptance probability must not be mostly constant.
 *
 * Four of six features have no producer anywhere in the codebase. They used to
 * default to 50, contributing a fixed +11.0 to z against an intercept of -4 —
 * i.e. two thirds of the "model" was an offset that inflated every result,
 * while the output was rendered as a per-trade percentage.
 */
import { describe, expect, it } from "vitest"
import {
  acceptanceProbabilityDetailed,
  acceptanceProbabilityWithLiquidity,
  extractAcceptanceFeatures,
} from "@/lib/acceptance-model"

describe("extractAcceptanceFeatures", () => {
  it("leaves producerless features NULL instead of defaulting them to 50", () => {
    const features = extractAcceptanceFeatures({
      lineupImpactScore: 60,
      vorpScore: 70,
      marketScore: 50,
    })
    expect(features.fairnessScore).toBeCloseTo(6, 5)
    expect(features.volatilityDelta).toBeCloseTo(0.5, 5)
    // No producer exists for any of these.
    expect(features.ldiAlignment).toBeNull()
    expect(features.needsFitScore).toBeNull()
    expect(features.archetypeMatch).toBeNull()
    expect(features.dealShapeScore).toBeNull()
  })

  it("emits null fairness/volatility when their own inputs are absent", () => {
    const features = extractAcceptanceFeatures({})
    expect(features.fairnessScore).toBeNull()
    expect(features.volatilityDelta).toBeNull()
  })

  it("uses real values when they ARE supplied", () => {
    const features = extractAcceptanceFeatures({ ldiScore: 80, needsFitScore: 40 })
    expect(features.ldiAlignment).toBe(8)
    expect(features.needsFitScore).toBe(4)
  })
})

describe("acceptanceProbabilityDetailed", () => {
  it("reports coverage and flags degradation when most of the model is missing", () => {
    const result = acceptanceProbabilityDetailed(
      extractAcceptanceFeatures({ lineupImpactScore: 60, vorpScore: 70, marketScore: 50 }),
    )
    expect(result.featureCoverage).toBeCloseTo(2 / 6, 5)
    expect(result.degraded).toBe(true)
    expect(result.missingFeatures).toEqual([
      "ldiAlignment",
      "needsFitScore",
      "archetypeMatch",
      "dealShapeScore",
    ])
  })

  it("missing features contribute NOTHING (no fabricated midpoint)", () => {
    const onlyFairness = acceptanceProbabilityDetailed({
      fairnessScore: 5,
      ldiAlignment: null,
      needsFitScore: null,
      archetypeMatch: null,
      dealShapeScore: null,
      volatilityDelta: null,
    })
    // z = -4 + 0.8*5 = 0  →  sigmoid(0) = 0.5
    expect(onlyFairness.probability).toBeCloseTo(0.5, 6)

    // The old behavior added 0.6*5 + 0.7*5 + 0.5*5 + 0.4*5 = 11 to z, which
    // saturates the sigmoid to the 0.95 clamp regardless of the real feature.
    const asIfDefaulted = acceptanceProbabilityDetailed({
      fairnessScore: 5,
      ldiAlignment: 5,
      needsFitScore: 5,
      archetypeMatch: 5,
      dealShapeScore: 5,
      volatilityDelta: null,
    })
    expect(asIfDefaulted.probability).toBe(0.95)
    expect(onlyFairness.probability).toBeLessThan(asIfDefaulted.probability)
  })

  it("full coverage is not degraded", () => {
    const result = acceptanceProbabilityDetailed({
      fairnessScore: 5,
      ldiAlignment: 5,
      needsFitScore: 5,
      archetypeMatch: 5,
      dealShapeScore: 5,
      volatilityDelta: 1,
    })
    expect(result.featureCoverage).toBe(1)
    expect(result.degraded).toBe(false)
    expect(result.missingFeatures).toEqual([])
  })

  it("stays clamped to [0.05, 0.95]", () => {
    const low = acceptanceProbabilityDetailed({
      fairnessScore: 0, ldiAlignment: 0, needsFitScore: 0,
      archetypeMatch: 0, dealShapeScore: 0, volatilityDelta: 10,
    })
    expect(low.probability).toBe(0.05)
  })
})

describe("acceptanceProbabilityWithLiquidity", () => {
  it("propagates coverage so consumers can suppress a thin number", () => {
    const result = acceptanceProbabilityWithLiquidity(
      extractAcceptanceFeatures({ lineupImpactScore: 60, vorpScore: 70, marketScore: 50 }),
      70,
    )
    expect(result.degraded).toBe(true)
    expect(result.featureCoverage).toBeCloseTo(2 / 6, 5)
    expect(result.missingFeatures.length).toBe(4)
  })
})
