/**
 * Slice 10 — flip-readiness aggregation over shadow-parity telemetry (pure).
 */
import { describe, expect, it } from "vitest"
import { summarizeFlipReadiness } from "@/lib/decision-os/core/parity/flipReadiness"
import type { DecisionTelemetryDebugEvent } from "@/lib/decision-os/core/telemetryDebugStore"

function event(flags: Record<string, unknown>, decisionType = "manager.trade.evaluate"): DecisionTelemetryDebugEvent {
  return {
    event: "decision.shadow_parity",
    decision_type: decisionType,
    flags,
    at: new Date().toISOString(),
    userId: null,
    leagueId: null,
  }
}

describe("summarizeFlipReadiness", () => {
  it("groups by decision type + surface, splitting comparisons from skips with reasons", () => {
    const events = [
      event({ surface: "console", ran: true, agreement: true }),
      event({ surface: "console", ran: true, agreement: false }),
      event({ surface: "console", ran: false, reason: "missing_roster_identity" }),
      event({ surface: "dynasty", ran: false, reason: "missing_roster_identity" }),
      event({ sameTopPlayer: true, ran: true }, "manager.draft.pick"),
    ]
    const summaries = summarizeFlipReadiness(events)
    expect(summaries).toHaveLength(3)
    const console_ = summaries.find((s) => s.surface === "console")!
    expect(console_.comparisons).toBe(2)
    expect(console_.agreements).toBe(1)
    expect(console_.disagreements).toBe(1)
    expect(console_.agreementRate).toBe(0.5)
    expect(console_.skips).toBe(1)
    expect(console_.skipReasons).toEqual({ missing_roster_identity: 1 })
    const draft = summaries.find((s) => s.decisionType === "manager.draft.pick")!
    expect(draft.agreements).toBe(1)
  })

  it("applies the Phase 3 gate: ready needs >=50 verdicts at >=95% agreement", () => {
    const agreeing = Array.from({ length: 50 }, () => event({ surface: "console", ran: true, agreement: true }))
    const ready = summarizeFlipReadiness(agreeing)[0]!
    expect(ready.readiness).toBe("ready")

    const almostEnough = summarizeFlipReadiness(agreeing.slice(0, 49))[0]!
    expect(almostEnough.readiness).toBe("accumulating")

    const disagreeing = summarizeFlipReadiness([
      ...agreeing.slice(0, 47),
      event({ surface: "console", ran: true, agreement: false }),
      event({ surface: "console", ran: true, agreement: false }),
      event({ surface: "console", ran: true, agreement: false }),
    ])[0]!
    expect(disagreeing.agreementRate).toBeLessThan(0.95)
    expect(disagreeing.readiness).toBe("accumulating")
  })

  it("verdictless comparisons never count as agreement; skip-only surfaces are no_signal", () => {
    const summaries = summarizeFlipReadiness([
      event({ surface: "console", ran: true }), // comparison with no verdict signal
      event({ surface: "keeper", ran: false, reason: "missing_roster_identity" }),
    ])
    const console_ = summaries.find((s) => s.surface === "console")!
    expect(console_.verdictlessComparisons).toBe(1)
    expect(console_.agreementRate).toBeNull()
    const keeper = summaries.find((s) => s.surface === "keeper")!
    expect(keeper.readiness).toBe("no_signal")
  })

  it("honors custom gate parameters", () => {
    const events = Array.from({ length: 5 }, () => event({ surface: "console", ran: true, agreement: true }))
    expect(summarizeFlipReadiness(events, { minComparisons: 5 })[0]!.readiness).toBe("ready")
    expect(summarizeFlipReadiness(events, { minComparisons: 6 })[0]!.readiness).toBe("accumulating")
  })
})
