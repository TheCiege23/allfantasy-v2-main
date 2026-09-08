/**
 * Wrap-fidelity comparisons get their own parity surface, so they cannot top up a real one.
 *
 * `manager.lineup.set` and `commissioner.league.health` emitted NO `surface` and bucketed as
 * `'default'`. Both are self-comparisons — the wrapper is handed the legacy answer and then
 * compared against it — so their agreement rate proves the wrapper adds no drift and nothing about
 * whether the recommendation is good.
 *
 * `ADR_DECISION_OS_PHASE3_WHAT_COUNTS_AS_FLIP_EVIDENCE` settles what that means (§5.2: such a
 * surface "licenses replacing the call site, it does not license trusting the recommendation") and
 * its §7 says to label these emitters BEFORE either decision type gains a second surface, because a
 * mislabelled sample cannot be re-attributed once it is fifty rows deep. This is that label.
 *
 * 🛑 THE ADR EXPLICITLY REJECTED THE OTHER FIX, AND THIS SUITE EXISTS PARTLY TO RECORD WHY.
 * Teaching `flipReadiness` to refuse wrap-fidelity surfaces would hardcode "which surfaces are
 * tautological" — a fact about wiring — into a summariser that only reports and would not be
 * updated when the wiring changes. So the summariser stays dumb and the emitter stays honest:
 * `flipReadiness` groups on `flags.surface`, and naming the surface is the whole mechanism.
 *
 * ⚠ WHICH MEANS A WRAP-FIDELITY SURFACE STILL REACHES `readiness: 'ready'`, AND MUST. The gate's
 * arithmetic is correct; what changed is that the sample is now in a bucket a reader can identify.
 * Asserting it reads `accumulating` would be asserting the rejected design.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import { summarizeFlipReadiness } from "@/lib/decision-os/core/parity/flipReadiness"
import { WRAP_FIDELITY_SURFACE } from "@/lib/decision-os/core/parity/telemetry"
import type { DecisionTelemetryDebugEvent } from "@/lib/decision-os/core/telemetryDebugStore"

/**
 * ⚠ ONLY `emitShadowParity` IS REPLACED; THE REST OF THE BARREL IS THE REAL MODULE — including
 * `WRAP_FIDELITY_SURFACE` itself. Mocking the whole barrel would supply the constant the assertions
 * then check, so the suite would be verifying its own mock rather than the emitter.
 */
const emitted = vi.hoisted(() => vi.fn())
vi.mock("@/lib/decision-os/core/parity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/decision-os/core/parity")>()),
  emitShadowParity: emitted,
}))

import { runCommissionerHealthShadow } from "@/lib/decision-os/commissioner-health/shadow"
import { runLineupShadow } from "@/lib/decision-os/lineup/shadow"

function event(flags: Record<string, unknown>, decisionType: string): DecisionTelemetryDebugEvent {
  return {
    event: "decision.shadow_parity",
    decision_type: decisionType,
    flags,
    at: new Date().toISOString(),
    userId: null,
    leagueId: null,
  }
}

const agreeing = (n: number, surface: string | undefined, type: string) =>
  Array.from({ length: n }, () =>
    event({ ...(surface ? { surface } : {}), ran: true, parity_passed: true }, type),
  )

describe("wrap-fidelity surface keeps self-comparisons in their own bucket", () => {
  it("does not share a bucket with an independently-fed surface of the same decision type", () => {
    // The failure this prevents: 60 wrapper self-comparisons topping up 5 real ones to satisfy
    // the 50-comparison gate, proving far less than the number claims.
    const summaries = summarizeFlipReadiness([
      ...agreeing(60, WRAP_FIDELITY_SURFACE, "manager.lineup.set"),
      ...agreeing(5, "independent", "manager.lineup.set"),
    ])

    expect(summaries).toHaveLength(2)
    const wrap = summaries.find((s) => s.surface === WRAP_FIDELITY_SURFACE)!
    const indep = summaries.find((s) => s.surface === "independent")!

    expect(wrap.comparisons).toBe(60)
    expect(indep.comparisons).toBe(5)
    // The real surface is judged on its own five, not on sixty-five.
    expect(indep.readiness).toBe("accumulating")
  })

  it("still reports the wrap-fidelity surface as ready — the ADR rejected refusing it here", () => {
    // Deliberate. `flipReadiness` only reports; a human reads the surface name and decides. If this
    // ever asserts 'accumulating', someone has moved the policy into the summariser, which the ADR
    // considered and turned down.
    const [only] = summarizeFlipReadiness(agreeing(60, WRAP_FIDELITY_SURFACE, "manager.lineup.set"))
    expect(only!.readiness).toBe("ready")
    expect(only!.surface).toBe(WRAP_FIDELITY_SURFACE)
  })

  it("an unlabelled emitter falls back to 'default' — which is what this label replaces", () => {
    // Pins the pre-existing behaviour the label exists to move away from, so a regression that
    // drops `surface` from an emitter is visible as a bucket rename rather than silently merging.
    const [only] = summarizeFlipReadiness(agreeing(3, undefined, "manager.lineup.set"))
    expect(only!.surface).toBe("default")
  })

  it("labels commissioner health the same way, so the two self-comparisons read alike", () => {
    const summaries = summarizeFlipReadiness([
      ...agreeing(2, WRAP_FIDELITY_SURFACE, "manager.lineup.set"),
      ...agreeing(2, WRAP_FIDELITY_SURFACE, "commissioner.league.health"),
    ])
    // Same surface name, still separate rows: grouping is decisionType + surface, not surface alone.
    expect(summaries).toHaveLength(2)
    expect(summaries.every((s) => s.surface === WRAP_FIDELITY_SURFACE)).toBe(true)
  })
})

/**
 * 🛑 THE SUITE ABOVE GUARDS THE GROUPING, WHICH `flip-readiness.test.ts` ALREADY GUARDED. These
 * guard the thing that actually changed: that the two emitters PUT the label on. Without them a
 * regression dropping `surface` from an emit site reddens nothing — the summariser would keep
 * grouping correctly, on a field nobody was sending.
 */
describe("the self-comparison emitters carry the label", () => {
  beforeEach(() => emitted.mockReset())

  it("commissioner health tags its skip", async () => {
    await runCommissionerHealthShadow({
      userId: "u1",
      // The fallback path is the cheapest reachable emit — it needs no decision run.
      snapshot: { leagueId: "L1", source: "dashboard-fallback" } as never,
    })

    expect(emitted).toHaveBeenCalledTimes(1)
    const [decisionType, flags] = emitted.mock.calls[0]!
    expect(decisionType).toBe("commissioner.league.health")
    expect((flags as Record<string, unknown>).surface).toBe(WRAP_FIDELITY_SURFACE)
  })

  it("lineup tags its skip", async () => {
    await runLineupShadow(
      { userId: "u1", leagueId: "L1", legacySummary: { leagues: [] } as never },
      // Both loaders refuse, so the shadow takes the `inputs_unavailable` emit without needing a
      // world, a ruleset or a database.
      {
        loadInputs: async () => null,
        loadCanonicalInputs: async () => ({ input: null, source: "canonical_world_unavailable", warnings: [] }),
      } as never,
    )

    expect(emitted).toHaveBeenCalledTimes(1)
    const [decisionType, flags] = emitted.mock.calls[0]!
    expect(decisionType).toBe("manager.lineup.set")
    expect((flags as Record<string, unknown>).surface).toBe(WRAP_FIDELITY_SURFACE)
  })
})
