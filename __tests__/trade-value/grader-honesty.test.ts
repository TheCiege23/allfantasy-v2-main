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
