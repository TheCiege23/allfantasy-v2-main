/**
 * Slice 16 — valuation must reflect the league's real scoring settings.
 *
 * POSITION_SCARCITY is tuned for standard 1-QB redraft. Until now that was the
 * only market the engine could express, so a Superflex league's QBs and a
 * TE-premium league's tight ends were graded against the wrong market.
 */
import { describe, expect, it } from "vitest"
import {
  PPR_POSITION_LIFT,
  explainPlayerValue,
  normalizedPlayerValue,
  pprConversionFactor,
  scoringScarcityMultiplier,
} from "@/lib/trade-value/valueEngine"

describe("scoringScarcityMultiplier", () => {
  it("is exactly 1.0 when no scoring context is supplied (standard baseline)", () => {
    expect(scoringScarcityMultiplier("QB", null)).toBe(1)
    expect(scoringScarcityMultiplier("QB", {})).toBe(1)
    expect(scoringScarcityMultiplier("WR", { scoringFormat: "standard" })).toBe(1)
  })

  it("lifts QBs in superflex, and more in 2QB", () => {
    const sf = scoringScarcityMultiplier("QB", { isSuperflex: true })
    const twoQb = scoringScarcityMultiplier("QB", { is2QB: true })
    expect(sf).toBeGreaterThan(1)
    expect(twoQb).toBeGreaterThan(sf)
  })

  it("2QB wins when both flags are set (strictly stronger requirement)", () => {
    expect(scoringScarcityMultiplier("QB", { isSuperflex: true, is2QB: true })).toBe(
      scoringScarcityMultiplier("QB", { is2QB: true }),
    )
  })

  it("superflex does NOT inflate non-QBs", () => {
    expect(scoringScarcityMultiplier("RB", { isSuperflex: true })).toBe(1)
    expect(scoringScarcityMultiplier("WR", { is2QB: true })).toBe(1)
  })

  it("TE premium lifts only TEs, and is capped", () => {
    expect(scoringScarcityMultiplier("TE", { tePremium: 1 })).toBeGreaterThan(1)
    expect(scoringScarcityMultiplier("WR", { tePremium: 1 })).toBe(1)
    // An absurd setting cannot run away.
    expect(scoringScarcityMultiplier("TE", { tePremium: 99 })).toBeLessThanOrEqual(1.5)
  })

  it("PPR lifts pass-catchers; half-PPR lifts them half as much", () => {
    const ppr = scoringScarcityMultiplier("WR", { scoringFormat: "ppr" })
    const half = scoringScarcityMultiplier("WR", { scoringFormat: "half_ppr" })
    expect(ppr).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(1)
    expect(ppr - 1).toBeCloseTo((half - 1) * 2, 6)
    // QBs get no reception lift.
    expect(scoringScarcityMultiplier("QB", { scoringFormat: "ppr" })).toBe(1)
  })

  it("stacks superflex and PPR independently for a TE in a TE-premium SF league", () => {
    const combined = scoringScarcityMultiplier("TE", {
      isSuperflex: true,
      tePremium: 0.5,
      scoringFormat: "ppr",
    })
    // Superflex must not touch the TE; premium + PPR both should.
    expect(combined).toBeGreaterThan(scoringScarcityMultiplier("TE", { tePremium: 0.5 }))
  })
})

describe("normalizedPlayerValue — scoring aware", () => {
  const proj = { projection: 300, position: "QB" as const }

  it("is byte-identical to the pre-slice-16 result when scoring is omitted", () => {
    expect(normalizedPlayerValue(proj)).toBe(normalizedPlayerValue({ ...proj, scoring: null }))
  })

  it("values a superflex QB above a standard-league QB", () => {
    const standard = normalizedPlayerValue({ projection: 120, position: "QB" })
    const superflex = normalizedPlayerValue({
      projection: 120,
      position: "QB",
      scoring: { isSuperflex: true },
    })
    expect(superflex).toBeGreaterThan(standard)
  })

  it("values a TE-premium TE above a standard TE", () => {
    const standard = normalizedPlayerValue({ projection: 150, position: "TE" })
    const premium = normalizedPlayerValue({
      projection: 150,
      position: "TE",
      scoring: { tePremium: 1 },
    })
    expect(premium).toBeGreaterThan(standard)
  })

  it("does not apply scoring lift to the market-value fallback basis", () => {
    // Market values already embed the league-agnostic market; the fallback
    // path returns them as-is (see slice 14).
    const value = normalizedPlayerValue({
      projection: null,
      position: "QB",
      marketValue: 5000,
      scoring: { is2QB: true },
    })
    expect(value).toBe(5000)
  })
})

/**
 * 🛑 THE PROJECTION IS ALREADY FULL PPR. Every number that reaches this engine as a projection is
 * an `AFProjectionSnapshot` row (one canonical PPR row per player) or a `fantasy_projections` row
 * written under the `ppr` preset. The absolute lift above assumed a standard-scored input, so once
 * the league's real `rec` reached the engine a PPR league would have lifted receptions twice.
 */
describe("pprConversionFactor — relative to the projection's own format", () => {
  const WR = PPR_POSITION_LIFT.WR
  const TE = PPR_POSITION_LIFT.TE

  it("a PPR league on a PPR projection moves by exactly nothing — no double count", () => {
    for (const pos of ["WR", "TE", "RB", "QB"]) {
      expect(pprConversionFactor(pos, "ppr", "ppr")).toBe(1)
    }
  })

  it("half-PPR and standard leagues move pass-catchers DOWN from a PPR projection", () => {
    expect(pprConversionFactor("WR", "half_ppr", "ppr")).toBeCloseTo((1 + WR / 2) / (1 + WR), 12)
    expect(pprConversionFactor("TE", "standard", "ppr")).toBeCloseTo(1 / (1 + TE), 12)
    expect(pprConversionFactor("WR", "standard", "ppr")).toBeLessThan(pprConversionFactor("WR", "half_ppr", "ppr"))
    expect(pprConversionFactor("WR", "half_ppr", "ppr")).toBeLessThan(1)
  })

  it("converts UP when the projection was scored in a thinner format than the league", () => {
    expect(pprConversionFactor("WR", "ppr", "standard")).toBeCloseTo(1 + WR, 12)
  })

  it("does nothing when the projection's format is unknown, or the league's is", () => {
    expect(pprConversionFactor("WR", "half_ppr", null)).toBe(1)
    expect(pprConversionFactor("WR", null, "ppr")).toBe(1)
    expect(pprConversionFactor("WR", undefined, "ppr")).toBe(1)
  })

  it("never touches a position with no reception lift", () => {
    expect(pprConversionFactor("QB", "standard", "ppr")).toBe(1)
    expect(pprConversionFactor("K", "standard", "ppr")).toBe(1)
    expect(pprConversionFactor(null, "standard", "ppr")).toBe(1)
  })

  it("keeps the old absolute lift, exactly, for a caller that does not say", () => {
    expect(pprConversionFactor("WR", "ppr")).toBe(1 + WR)
    expect(pprConversionFactor("WR", "half_ppr")).toBe(1 + WR / 2)
    expect(pprConversionFactor("WR", "standard")).toBe(1)
  })
})

describe("scoringScarcityMultiplier — with the projection's format", () => {
  it("a PPR TE-premium league applies the premium and nothing for receptions", () => {
    const scoring = { tePremium: 0.5, scoringFormat: "ppr" as const }
    expect(scoringScarcityMultiplier("TE", scoring, "ppr")).toBe(scoringScarcityMultiplier("TE", { tePremium: 0.5 }))
  })

  it("the premium still applies on top of a downward reception conversion", () => {
    const halfTep = scoringScarcityMultiplier("TE", { tePremium: 1, scoringFormat: "half_ppr" }, "ppr")
    const halfOnly = scoringScarcityMultiplier("TE", { scoringFormat: "half_ppr" }, "ppr")
    expect(halfTep).toBeGreaterThan(halfOnly)
    expect(halfOnly).toBeLessThan(1)
  })
})

describe("explainPlayerValue — the conversion is priced AND named", () => {
  const wr = { projection: 200, position: "WR", adp: null, marketValue: null, idpValue: null }

  it("a PPR league prices a PPR projection exactly as a league with no reception setting", () => {
    const ppr = explainPlayerValue({ ...wr, scoring: { scoringFormat: "ppr" }, projectionScoringFormat: "ppr" })
    const unknown = explainPlayerValue({ ...wr, scoring: {}, projectionScoringFormat: "ppr" })
    expect(ppr.value).toBe(unknown.value)
    expect(ppr.steps.map((s) => s.detail).join(" ")).not.toContain("because the projection is scored")
  })

  it("a half-PPR league prices the same receiver lower, and says why", () => {
    const ppr = explainPlayerValue({ ...wr, scoring: { scoringFormat: "ppr" }, projectionScoringFormat: "ppr" })
    const half = explainPlayerValue({ ...wr, scoring: { scoringFormat: "half_ppr" }, projectionScoringFormat: "ppr" })
    const std = explainPlayerValue({ ...wr, scoring: { scoringFormat: "standard" }, projectionScoringFormat: "ppr" })
    expect(half.value).toBeLessThan(ppr.value)
    expect(std.value).toBeLessThan(half.value)
    const note = half.steps.map((s) => s.detail).join(" ")
    expect(note).toContain("−3.7%")
    expect(note).toContain("scored full PPR and this league is half PPR")
  })

  it("normalizedPlayerValue agrees with the explanation", () => {
    const input = { ...wr, scoring: { scoringFormat: "standard" as const }, projectionScoringFormat: "ppr" as const }
    expect(normalizedPlayerValue(input)).toBe(explainPlayerValue(input).value)
  })
})
