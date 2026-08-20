/**
 * Slice 16 — valuation must reflect the league's real scoring settings.
 *
 * POSITION_SCARCITY is tuned for standard 1-QB redraft. Until now that was the
 * only market the engine could express, so a Superflex league's QBs and a
 * TE-premium league's tight ends were graded against the wrong market.
 */
import { describe, expect, it } from "vitest"
import { normalizedPlayerValue, scoringScarcityMultiplier } from "@/lib/trade-value/valueEngine"

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
