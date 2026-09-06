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

/*
 * The console comparison was tautological by construction: `toEnriched` hardcoded `adpValue: null`
 * and `idpValue: null`, and passed `fantasyCalcValue` ONLY when the console had itself priced from
 * fantasycalc. So the canonical engine regraded the console's own numbers and "agreement" partly
 * meant "arithmetic is deterministic". These tests pin the independent path.
 */
describe("compareConsoleVerdictWithCanonicalGrade — independent inputs", () => {
  const priced = (name: string, playerId: string, marketValue: number) => ({
    kind: "player" as const,
    name,
    playerId,
    position: "WR",
    projection: 10,
    marketValue,
    pricedSource: "fantasycalc",
  })

  it("reports NO independent inputs when no enrichment is supplied (the old behaviour, unchanged)", () => {
    const result = compareConsoleVerdictWithCanonicalGrade({
      give: [priced("A", "p1", 5000)],
      get: [priced("B", "p2", 5000)],
      consoleAdvantage: "even",
      context: ctx,
    })
    expect(result.independentInputs).toBe(false)
    expect(result.playerAssets).toBe(2)
    expect(result.playerAssetsWithId).toBe(2)
  })

  it("USES the supplied ADP instead of the console's own value, and says it did", () => {
    // The console prices both sides equally; independent ADP says one side is far better. If the
    // enrichment were ignored the grade would come back even, which is the whole defect.
    const result = compareConsoleVerdictWithCanonicalGrade({
      give: [priced("Star", "p1", 5000)],
      get: [priced("Scrub", "p2", 5000)],
      consoleAdvantage: "even",
      context: ctx,
      enrichment: { adpByPlayerId: { p1: 3, p2: 140 } },
    })
    expect(result.independentInputs).toBe(true)
    expect(result.canonicalValueDifference).not.toBe(0)
  })

  it("counts player assets that carry an id, so the resolution rate is visible from telemetry", () => {
    const result = compareConsoleVerdictWithCanonicalGrade({
      give: [priced("A", "p1", 5000), { kind: "player" as const, name: "TypedByHand", position: "WR", marketValue: 100 }],
      get: [{ kind: "pick" as const, year: 2027, round: 1 }],
      consoleAdvantage: "even",
      context: ctx,
      enrichment: { adpByPlayerId: { p1: 12 } },
    })
    // Two players, one with an id. The pick is not a player and must not be counted as one.
    expect(result.playerAssets).toBe(2)
    expect(result.playerAssetsWithId).toBe(1)
  })

  it("an enrichment that resolves NOTHING is not independent — an empty map must not relabel the row", () => {
    /*
     * 🛑 THE BUCKET IS THE CLAIM. `independentInputs` is what routes this comparison into its own
     * flip-gate surface, so it has to mean "a real independent value was applied", not "an
     * enrichment object was passed". An empty result would otherwise promote a tautological
     * comparison into the bucket reserved for independent evidence.
     */
    const result = compareConsoleVerdictWithCanonicalGrade({
      give: [priced("A", "p1", 5000)],
      get: [priced("B", "p2", 5000)],
      consoleAdvantage: "even",
      context: ctx,
      enrichment: { adpByPlayerId: {}, idpValueByPlayerId: {}, marketValueByPlayerId: {} },
    })
    expect(result.independentInputs).toBe(false)
  })
})
