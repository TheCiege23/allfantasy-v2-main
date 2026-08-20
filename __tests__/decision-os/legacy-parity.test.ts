/**
 * Slice 13 — verdict-vocabulary normalization for the uninstrumented surfaces.
 */
import { describe, expect, it } from "vitest"
import {
  buildSurfaceParity,
  engineVerdictToAdvantage,
  legacyVerdictToAdvantage,
  warRoomVerdictToAdvantage,
} from "@/lib/decision-os/trade/legacyParity"

describe("legacyVerdictToAdvantage", () => {
  it("maps af-legacy's Team-A-perspective verdicts", () => {
    expect(legacyVerdictToAdvantage("Fair")).toBe("even")
    expect(legacyVerdictToAdvantage("Slightly favors A")).toBe("you")
    expect(legacyVerdictToAdvantage("Strongly favors A")).toBe("you")
    expect(legacyVerdictToAdvantage("Slightly favors B")).toBe("opponent")
    expect(legacyVerdictToAdvantage("Strongly favors B")).toBe("opponent")
  })

  it("returns null for unknown/absent verdicts instead of guessing", () => {
    expect(legacyVerdictToAdvantage(null)).toBeNull()
    expect(legacyVerdictToAdvantage("")).toBeNull()
    expect(legacyVerdictToAdvantage("who knows")).toBeNull()
  })
})

describe("engine + war-room vocabularies", () => {
  it("engine accept/reject/counter", () => {
    expect(engineVerdictToAdvantage("accept")).toBe("you")
    expect(engineVerdictToAdvantage("reject")).toBe("opponent")
    expect(engineVerdictToAdvantage("counter")).toBe("even")
  })

  it("war-room accept/reject/neutral, and needs_more_data ABSTAINS", () => {
    expect(warRoomVerdictToAdvantage("accept")).toBe("you")
    expect(warRoomVerdictToAdvantage("reject")).toBe("opponent")
    expect(warRoomVerdictToAdvantage("neutral")).toBe("even")
    // Honest abstention must never be coerced into a verdict.
    expect(warRoomVerdictToAdvantage("needs_more_data")).toBeNull()
  })
})

describe("buildSurfaceParity", () => {
  it("records agreement when both sides reached the same read", () => {
    const parity = buildSurfaceParity({
      surfaceAdvantage: "you",
      engineAdvantage: "you",
      engineFairnessScore: 71,
      engineValueDifference: 220,
    })
    expect(parity.agreement).toBe(true)
    expect(parity.canonicalFairnessScore).toBe(71)
  })

  it("records disagreement", () => {
    expect(
      buildSurfaceParity({ surfaceAdvantage: "you", engineAdvantage: "opponent" }).agreement,
    ).toBe(false)
  })

  it("an abstention on EITHER side yields null agreement, never inflated parity", () => {
    expect(buildSurfaceParity({ surfaceAdvantage: null, engineAdvantage: "even" }).agreement).toBeNull()
    expect(buildSurfaceParity({ surfaceAdvantage: "even", engineAdvantage: null }).agreement).toBeNull()
    expect(buildSurfaceParity({ surfaceAdvantage: null, engineAdvantage: null }).agreement).toBeNull()
  })
})
