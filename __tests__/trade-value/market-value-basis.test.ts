/**
 * Slice 14 — market-value fallback basis in the canonical value engine.
 *
 * `sources.fantasyCalcValue` existed on the contract but was hardcoded null at
 * every write site, so surfaces whose only real signal is market data (af-legacy
 * runs entirely on FantasyCalc) priced every player at 0 — which, after the
 * slice-11 honesty pass, means "not gradeable at all".
 */
import { describe, expect, it } from "vitest"
import { normalizedPlayerValue, PROJ_TO_VALUE } from "@/lib/trade-value/valueEngine"

describe("normalizedPlayerValue — market fallback", () => {
  it("is byte-identical to the old formula when a projection exists", () => {
    const withoutMarket = normalizedPlayerValue({ projection: 200, adp: 30, position: "RB" })
    const withMarket = normalizedPlayerValue({ projection: 200, adp: 30, position: "RB", marketValue: 9999 })
    expect(withMarket).toBe(withoutMarket)
    // Projection basis: 200 * 26 * 1.15 (RB scarcity) + adp premium, clamped.
    expect(withoutMarket).toBe(Math.min(10000, Math.round(200 * PROJ_TO_VALUE * 1.15 + (120 - 30) * 6)))
  })

  it("uses market value when there is no projection (was: 0)", () => {
    expect(normalizedPlayerValue({ projection: null, position: "WR" })).toBe(0)
    expect(normalizedPlayerValue({ projection: null, position: "WR", marketValue: 6200 })).toBe(6200)
  })

  it("does NOT re-apply positional scarcity to market values (no double-counting)", () => {
    // RB scarcity is 1.15; a market-basis RB must not be inflated by it.
    expect(normalizedPlayerValue({ projection: null, position: "RB", marketValue: 5000 })).toBe(5000)
    expect(normalizedPlayerValue({ projection: null, position: "QB", marketValue: 5000 })).toBe(5000)
  })

  it("ignores unusable market values rather than inventing a floor", () => {
    for (const bad of [null, undefined, 0, -50, Number.NaN]) {
      expect(normalizedPlayerValue({ projection: null, position: "WR", marketValue: bad as number })).toBe(0)
    }
  })

  it("clamps market values to the 0–10000 scale", () => {
    expect(normalizedPlayerValue({ projection: null, marketValue: 25000 })).toBe(10000)
  })
})
