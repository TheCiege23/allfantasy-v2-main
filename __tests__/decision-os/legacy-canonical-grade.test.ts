/**
 * Slice 14 — canonical grading for af-legacy, incl. the trade-direction
 * convention (the field's own doc comment contradicts the code; the code wins).
 */
import { describe, expect, it } from "vitest"
import {
  buildLegacyCanonicalGrade,
  fairnessToLegacyVerdict,
  type LegacyTradeAssetInput,
} from "@/lib/decision-os/trade/legacyCanonicalGrade"

const player = (name: string, pos = "WR"): LegacyTradeAssetInput => ({
  type: "player",
  player: { name, pos },
})

/** Market values keyed lowercase, exactly like legacy's FantasyCalc map. */
const market = (values: Record<string, number>) => (name: string) =>
  values[name.toLowerCase()] ?? null

describe("buildLegacyCanonicalGrade", () => {
  it("prices legacy players off FantasyCalc values and grades an even trade Fair", () => {
    const result = buildLegacyCanonicalGrade({
      assetsA: [player("Star A")],
      assetsB: [player("Star B")],
      marketValueFor: market({ "star a": 6000, "star b": 6000 }),
    })
    expect(result.insufficientData).toBe(false)
    expect(result.fairnessScore).toBe(100)
    expect(result.grade).toBe("A+")
    expect(result.verdict).toBe("Fair")
  })

  it("DIRECTION: Team A giving away more favors B (assetsA = what A receives)", () => {
    const result = buildLegacyCanonicalGrade({
      // A receives a scrub, A sends a star ⇒ favors B.
      assetsA: [player("Scrub")],
      assetsB: [player("Star")],
      marketValueFor: market({ scrub: 500, star: 9000 }),
    })
    expect(result.valueDifference).toBeGreaterThan(0)
    expect(result.verdict).toBe("Strongly favors B")
  })

  it("DIRECTION: Team A receiving more favors A", () => {
    const result = buildLegacyCanonicalGrade({
      assetsA: [player("Star")],
      assetsB: [player("Scrub")],
      marketValueFor: market({ scrub: 500, star: 9000 }),
    })
    expect(result.valueDifference).toBeLessThan(0)
    expect(result.verdict).toBe("Strongly favors A")
  })

  it("refuses to grade when no asset has a market value (honesty pass holds)", () => {
    const result = buildLegacyCanonicalGrade({
      assetsA: [player("Unknown One")],
      assetsB: [player("Unknown Two")],
      marketValueFor: () => null,
    })
    expect(result.insufficientData).toBe(true)
    expect(result.grade).toBeNull()
    expect(result.verdict).toBeNull()
    expect(result.fairnessScore).toBeNull()
  })

  it("prices picks off the canonical curve even with no market data", () => {
    const result = buildLegacyCanonicalGrade({
      assetsA: [{ type: "pick", pick: { year: 2027, round: 1 } }],
      assetsB: [{ type: "pick", pick: { year: 2027, round: 4 } }],
      marketValueFor: () => null,
      currentSeason: 2026,
    })
    expect(result.insufficientData).toBe(false)
    // A receives the 1st, sends the 4th ⇒ favors A.
    expect(result.valueDifference).toBeLessThan(0)
    expect(result.verdict).toBe("Strongly favors A")
  })

  it("skips nameless assets instead of pricing them as zero-value players", () => {
    const result = buildLegacyCanonicalGrade({
      assetsA: [player("Star A"), { type: "player", player: { name: "  " } }],
      assetsB: [player("Star B")],
      marketValueFor: market({ "star a": 6000, "star b": 6000 }),
    })
    expect(result.fairnessScore).toBe(100)
  })
})

describe("fairnessToLegacyVerdict", () => {
  it("reuses the grader's own bullet thresholds (88 / 65)", () => {
    expect(fairnessToLegacyVerdict(100, 0)).toBe("Fair")
    expect(fairnessToLegacyVerdict(88, 500)).toBe("Fair")
    expect(fairnessToLegacyVerdict(87, 500)).toBe("Slightly favors B")
    expect(fairnessToLegacyVerdict(65, -500)).toBe("Slightly favors A")
    expect(fairnessToLegacyVerdict(64, -500)).toBe("Strongly favors A")
  })
})
