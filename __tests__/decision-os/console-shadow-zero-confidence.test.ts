/**
 * Zero confidence is not agreement.
 *
 * Found by the FIRST real production trade-shadow observation, 2026-09-04, minutes after the flag
 * was turned on. A 2027 1st for a 2027 1st recorded:
 *
 *     canonicalFairnessScore: 100, canonicalGrade: "A+", canonicalConfidenceScore: 0,
 *     surfaceVerdict: "even", agreement: true
 *
 * Two engines failing to price the same deal and agreeing on the silence. The console's own UI said
 * so: "an even-looking score here means we have no signal, not that the trade is fair."
 *
 * 🛑 THE STATE IS MOCKED, AND THAT IS DELIBERATE RATHER THAN LAZY. Every zero-confidence input that
 * can be built from synthetic assets returns `fairnessScore: null`, which the FIRST honesty pass
 * already catches — verified across unpriced players, zero-value players and far-future picks. The
 * production combination (confidence 0 WITH a non-null fairness score) is not reachable that way,
 * so a test written through real inputs would pass while exercising nothing. Mocking the snapshot is
 * the only way to reach the branch this file exists to protect.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

const buildTradeValueSnapshot = vi.hoisted(() => vi.fn())
vi.mock("@/lib/trade-value/snapshot", () => ({ buildTradeValueSnapshot }))

import { compareConsoleVerdictWithCanonicalGrade } from "@/lib/decision-os/trade/consoleShadowCompare"

const ctx = { sport: "NFL", leagueType: "league", scoring: "PPR" }

/** The exact grade shape production recorded, parameterised on the one field under test. */
function snapshotWithConfidence(confidenceScore: number) {
  return {
    grade: {
      grade: "A+",
      fairnessScore: 100,
      confidenceScore,
      valueDifference: 0,
      insufficientData: false,
    },
  }
}

const evenPickSwap = {
  give: [{ kind: "pick" as const, year: 2027, round: 1 }],
  get: [{ kind: "pick" as const, year: 2027, round: 1 }],
  consoleAdvantage: "even" as const,
  context: ctx,
}

beforeEach(() => {
  buildTradeValueSnapshot.mockReset()
})

describe("zero confidence is not agreement", () => {
  it("withdraws the agreement claim at confidence 0 — the production case", () => {
    buildTradeValueSnapshot.mockReturnValue(snapshotWithConfidence(0))
    const result = compareConsoleVerdictWithCanonicalGrade(evenPickSwap)

    // Both engines said "even". Counting that would satisfy the Phase 3 gate fastest on exactly
    // the deals nobody can price.
    expect(result.canonicalAdvantage).toBe("even")
    expect(result.agreement).toBeNull()
  })

  it("keeps the computed grade — only the agreement claim is withdrawn", () => {
    buildTradeValueSnapshot.mockReturnValue(snapshotWithConfidence(0))
    const result = compareConsoleVerdictWithCanonicalGrade(evenPickSwap)

    // Unlike the ungradeable pass, which nulls everything, a zero-confidence grade WAS produced.
    // Discarding it would lose the one field that explains why agreement is null.
    expect(result.canonicalGrade).toBe("A+")
    expect(result.canonicalFairnessScore).toBe(100)
    expect(result.canonicalConfidenceScore).toBe(0)
  })

  it("counts agreement again as soon as there is any confidence at all", () => {
    // 1, not 50: zero is the line, deliberately, rather than an invented floor. Any positive
    // signal is reported and the gate can weight it.
    buildTradeValueSnapshot.mockReturnValue(snapshotWithConfidence(1))
    expect(compareConsoleVerdictWithCanonicalGrade(evenPickSwap).agreement).toBe(true)
  })

  it("still disagrees when the engines genuinely differ and confidence is real", () => {
    buildTradeValueSnapshot.mockReturnValue(snapshotWithConfidence(90))
    const result = compareConsoleVerdictWithCanonicalGrade({ ...evenPickSwap, consoleAdvantage: "you" })

    // Canonical says even, console says "you" — a real disagreement, which the gate needs to see.
    expect(result.agreement).toBe(false)
  })

  it("a mixed console verdict stays null regardless of confidence", () => {
    buildTradeValueSnapshot.mockReturnValue(snapshotWithConfidence(90))
    const result = compareConsoleVerdictWithCanonicalGrade({ ...evenPickSwap, consoleAdvantage: "mixed" })
    expect(result.agreement).toBeNull()
  })

  it("the FIRST honesty pass still wins for an ungradeable trade", () => {
    // Not superseded by the new branch: an ungradeable trade nulls the grade too, which the
    // zero-confidence case deliberately does not.
    buildTradeValueSnapshot.mockReturnValue({
      grade: { grade: null, fairnessScore: null, confidenceScore: 0, valueDifference: 0, insufficientData: true },
    })
    const result = compareConsoleVerdictWithCanonicalGrade(evenPickSwap)
    expect(result.canonicalGrade).toBeNull()
    expect(result.canonicalAdvantage).toBeNull()
    expect(result.agreement).toBeNull()
  })
})
