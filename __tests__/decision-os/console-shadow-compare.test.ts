/**
 * Slice 10 — console cross-engine shadow compare (pure).
 */
import { describe, expect, it } from "vitest"
import { compareConsoleVerdictWithCanonicalGrade } from "@/lib/decision-os/trade/consoleShadowCompare"

const ctx = { sport: "NFL", leagueType: "league", scoring: "PPR" }

describe("compareConsoleVerdictWithCanonicalGrade", () => {
  it("an even swap grades even and agrees with an even console verdict", () => {
    const side = [
      { kind: "player" as const, name: "A", position: "WR", projection: 15, marketValue: 5000, pricedSource: "fantasycalc" },
    ]
    const result = compareConsoleVerdictWithCanonicalGrade({
      give: side,
      get: [{ ...side[0]!, name: "B" }],
      consoleAdvantage: "even",
      context: ctx,
    })
    expect(result.canonicalAdvantage).toBe("even")
    expect(result.canonicalFairnessScore).toBeGreaterThanOrEqual(88)
    expect(result.agreement).toBe(true)
  })

  it("a lopsided give flags opponent advantage and disagrees with a 'you' console verdict", () => {
    const result = compareConsoleVerdictWithCanonicalGrade({
      give: [
        { kind: "player" as const, name: "Star", position: "WR", projection: 20, marketValue: 9000, pricedSource: "fantasycalc" },
      ],
      get: [
        { kind: "player" as const, name: "Scrub", position: "WR", projection: 4, marketValue: 400, pricedSource: "fantasycalc" },
      ],
      consoleAdvantage: "you",
      context: ctx,
    })
    expect(result.canonicalAdvantage).toBe("opponent")
    expect(result.canonicalValueDifference).toBeGreaterThan(0)
    expect(result.agreement).toBe(false)
  })

  it("mixed (multi-sport) console verdicts are not force-compared: agreement stays null", () => {
    const result = compareConsoleVerdictWithCanonicalGrade({
      give: [{ kind: "faab" as const, amount: 50 }],
      get: [{ kind: "pick" as const, year: 2027, round: 1 }],
      consoleAdvantage: "mixed",
      context: ctx,
    })
    expect(result.agreement).toBeNull()
  })

  it("handles pick and faab assets through the canonical value curves", () => {
    const result = compareConsoleVerdictWithCanonicalGrade({
      give: [{ kind: "pick" as const, year: 2027, round: 1 }],
      get: [{ kind: "faab" as const, amount: 10 }],
      consoleAdvantage: "opponent",
      context: ctx,
    })
    // A future 1st is worth far more than $10 FAAB on the canonical curves.
    expect(result.canonicalValueDifference).toBeGreaterThan(0)
    expect(result.canonicalAdvantage).toBe("opponent")
    expect(result.agreement).toBe(true)
  })
})
