/**
 * Slice 11 (honesty pass) — the grader must refuse to grade what it can't see.
 *
 * Regression guard for the worst class of bug in the value stack: a trade with
 * NO resolvable value on either side scored fairness 100 → "A+ / within normal
 * market range" → commissionerReview.reviewRecommended = false.
 */
import { describe, expect, it } from "vitest"
import { gradeTrade } from "@/lib/trade-value/grader"
import type { AssetValueSnapshot, SideTotals } from "@/lib/trade-value/types"

function player(internalValue: number, withProjection: boolean): AssetValueSnapshot {
  return {
    kind: "player",
    fromRosterId: "r1",
    toRosterId: "r2",
    playerId: null,
    playerName: "Test",
    position: "WR",
    team: "DET",
    pickSeason: null,
    pickRound: null,
    pickLabel: null,
    faabAmount: null,
    sources: {
      projectionValue: withProjection ? 12 : null,
      rankingValue: null,
      adpValue: null,
      fantasyCalcValue: null,
    },
    internalValue,
  }
}

const side = (rosterId: string, total: number, assets: AssetValueSnapshot[]): SideTotals => ({
  rosterId,
  total,
  assets,
})

describe("gradeTrade — insufficient data", () => {
  it("refuses to grade when NOTHING resolved to a value (was: A+ / fair)", () => {
    const { grade, commissionerReview } = gradeTrade(
      side("r1", 0, [player(0, false)]),
      side("r2", 0, [player(0, false)]),
    )
    expect(grade.insufficientData).toBe(true)
    expect(grade.grade).toBeNull()
    expect(grade.fairnessScore).toBeNull()
    expect(grade.bullets[0]).toMatch(/Not enough value data/i)
    // Never claim market normality off zero data.
    expect(grade.bullets.join(" ")).not.toMatch(/within normal market range/i)
  })

  it("ungradeable is NOT auto-approved — a human is asked to look", () => {
    const { commissionerReview } = gradeTrade(side("r1", 0, []), side("r2", 0, []))
    expect(commissionerReview.reviewRecommended).toBe(true)
    expect(commissionerReview.fairnessScore).toBeNull()
    expect(commissionerReview.similarValueRange).toBeNull()
    // lopsided is a claim about imbalance; with no data it must not assert one.
    expect(commissionerReview.lopsided).toBe(false)
  })

  it("one-sided value still grades (it is genuinely lopsided, not unknown)", () => {
    const { grade, commissionerReview } = gradeTrade(
      side("r1", 5000, [player(5000, true)]),
      side("r2", 0, [player(0, false)]),
    )
    expect(grade.insufficientData).toBe(false)
    expect(grade.grade).toBe("F")
    expect(grade.fairnessScore).toBe(0)
    expect(commissionerReview.reviewRecommended).toBe(true)
  })

  it("normal trades are unchanged by the honesty pass", () => {
    const { grade } = gradeTrade(
      side("r1", 5000, [player(5000, true)]),
      side("r2", 4900, [player(4900, true)]),
    )
    expect(grade.insufficientData).toBe(false)
    expect(grade.fairnessScore).toBe(98)
    expect(grade.grade).toBe("A+")
    expect(grade.bullets).toContain("Trade is within normal market range")
  })
})

/**
 * Confidence measures WHETHER THE ENGINE COULD PRICE THE ASSET, not whether a projection existed.
 *
 * It counted projections only, while `normalizedPlayerValue` prices from IDP first, then
 * projection, then market value as a documented fallback. So a trade priced entirely off market
 * values produced a real grade and reported confidence 0 — and `consoleShadowCompare` withdraws the
 * agreement claim at `confidence <= 0`, which made every market-priced trade verdictless by
 * construction and unable to reach the Phase 3 flip gate.
 *
 * The fixture below is the shape production actually recorded: graded, fair, and priced — with no
 * projection anywhere.
 */
function pricedPlayer(
  internalValue: number,
  valuationBasis: AssetValueSnapshot["valuationBasis"],
  projectionValue: number | null = null,
): AssetValueSnapshot {
  return { ...player(internalValue, false), sources: { ...player(0, false).sources, projectionValue }, valuationBasis }
}

describe("computeConfidence — priced, not merely projected", () => {
  it("a market-priced trade is CONFIDENT, not zero (the production shape)", () => {
    const { grade } = gradeTrade(
      side("r1", 5000, [pricedPlayer(5000, "market")]),
      side("r2", 4900, [pricedPlayer(4900, "market")]),
    )
    expect(grade.insufficientData).toBe(false)
    expect(grade.grade).toBe("A+")
    // The whole point: this was 0, which made the trade verdictless downstream.
    expect(grade.confidenceScore).toBe(100)
    expect(grade.confidenceScore).toBeGreaterThan(0)
  })

  it("an IDP-priced defender counts — it outranks a projection in the engine", () => {
    const { grade } = gradeTrade(
      side("r1", 5000, [pricedPlayer(5000, "idp")]),
      side("r2", 4900, [pricedPlayer(4900, "idp")]),
    )
    expect(grade.confidenceScore).toBe(100)
  })

  it("'none' is a REFUSAL and still scores zero — the guard must keep working", () => {
    const { grade } = gradeTrade(
      side("r1", 5000, [pricedPlayer(5000, "none")]),
      side("r2", 4900, [pricedPlayer(4900, "none")]),
    )
    expect(grade.confidenceScore).toBe(0)
  })

  it("mixes proportionally: one priced, one refused", () => {
    const { grade } = gradeTrade(
      side("r1", 5000, [pricedPlayer(5000, "market")]),
      side("r2", 4900, [pricedPlayer(4900, "none")]),
    )
    expect(grade.confidenceScore).toBe(50)
  })

  it("a projection basis still counts, obviously", () => {
    const { grade } = gradeTrade(
      side("r1", 5000, [pricedPlayer(5000, "projection", 12)]),
      side("r2", 4900, [pricedPlayer(4900, "projection", 11)]),
    )
    expect(grade.confidenceScore).toBe(100)
  })

  it("legacy snapshots without a basis keep their old score — absent is not re-rated", () => {
    // `player()` sets no valuationBasis, which is exactly a pre-field snapshot.
    const withProj = gradeTrade(side("r1", 5000, [player(5000, true)]), side("r2", 4900, [player(4900, true)]))
    expect(withProj.grade.confidenceScore).toBe(100)
    const withoutProj = gradeTrade(side("r1", 5000, [player(5000, true)]), side("r2", 4900, [player(4900, false)]))
    expect(withoutProj.grade.confidenceScore).toBe(50)
  })

  it("picks/FAAB only is untouched at 60 — a separate assertion, not this fix", () => {
    const pick: AssetValueSnapshot = { ...player(3000, false), kind: "draft_pick", valuationBasis: null }
    const { grade } = gradeTrade(side("r1", 3000, [pick]), side("r2", 3000, [pick]))
    expect(grade.confidenceScore).toBe(60)
  })

  it("the reduced-confidence bullet names the measure it reports", () => {
    const { grade } = gradeTrade(
      side("r1", 5000, [pricedPlayer(5000, "market")]),
      side("r2", 4900, [pricedPlayer(4900, "none")]),
    )
    expect(grade.bullets.join(" ")).toMatch(/could not be priced from any source/i)
    expect(grade.bullets.join(" ")).not.toMatch(/lacked projection data/i)
  })
})
