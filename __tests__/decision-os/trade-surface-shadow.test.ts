/**
 * Phase 2 (AF_TRADE_UNIFICATION_BRIEF) — per-surface trade shadow instrumentation.
 */
import { afterEach, describe, expect, it } from "vitest"
import {
  registerDecisionTelemetrySink,
  type DecisionTelemetryEvent,
} from "@/lib/decision-os/core/telemetry"
import {
  canonicalInputSkipReason,
  recordTradeSurfaceShadow,
  shouldRunTradeSurfaceShadow,
  tradeSurfaceFlagEnvVar,
  type TradeSurface,
} from "@/lib/decision-os/trade/surfaceShadow"

const SURFACES: TradeSurface[] = ["console", "dynasty", "keeper", "draftpick"]

function captureEvents(): { events: DecisionTelemetryEvent[]; stop: () => void } {
  const events: DecisionTelemetryEvent[] = []
  registerDecisionTelemetrySink((e) => events.push(e))
  return { events, stop: () => registerDecisionTelemetrySink(null) }
}

afterEach(() => registerDecisionTelemetrySink(null))

describe("trade surface shadow flags", () => {
  it("each surface binds its own DECISION_OS_TRADE_SHADOW_<SURFACE> env var", () => {
    expect(SURFACES.map(tradeSurfaceFlagEnvVar)).toEqual([
      "DECISION_OS_TRADE_SHADOW_CONSOLE",
      "DECISION_OS_TRADE_SHADOW_DYNASTY",
      "DECISION_OS_TRADE_SHADOW_KEEPER",
      "DECISION_OS_TRADE_SHADOW_DRAFTPICK",
    ])
  })

  it("is off by default and per-surface independent", () => {
    const env = { DECISION_OS_TRADE_SHADOW_CONSOLE: "true" } as NodeJS.ProcessEnv
    expect(shouldRunTradeSurfaceShadow("console", env)).toBe(true)
    expect(shouldRunTradeSurfaceShadow("dynasty", env)).toBe(false)
    expect(shouldRunTradeSurfaceShadow("console", {} as NodeJS.ProcessEnv)).toBe(false)
  })
})

describe("canonical input skip taxonomy (league → rosters → snapshot)", () => {
  it("reports the FIRST missing canonical input", () => {
    expect(canonicalInputSkipReason({ surface: "console" })).toBe("missing_league_scope")
    expect(canonicalInputSkipReason({ surface: "console", leagueId: "L1" })).toBe(
      "missing_roster_identity",
    )
    expect(
      canonicalInputSkipReason({
        surface: "draftpick",
        leagueId: "L1",
        proposerRosterId: "r1",
        receiverRosterId: "r2",
      }),
    ).toBe("missing_snapshot")
    expect(
      canonicalInputSkipReason({
        surface: "draftpick",
        leagueId: "L1",
        proposerRosterId: "r1",
        receiverRosterId: "r2",
        hasDeterministicSnapshot: true,
      }),
    ).toBe("full_inputs_available_use_proposal_shadow")
  })
})

describe("recordTradeSurfaceShadow", () => {
  it("emits nothing when the surface flag is off", () => {
    const { events } = captureEvents()
    recordTradeSurfaceShadow({ surface: "console" }, {} as NodeJS.ProcessEnv)
    expect(events).toEqual([])
  })

  it("emits a decision.shadow_parity event carrying the surface verdict when flagged on", () => {
    const { events } = captureEvents()
    recordTradeSurfaceShadow(
      {
        surface: "console",
        userId: "u1",
        leagueId: "L1",
        assetsGive: 2,
        assetsGet: 1,
        surfaceVerdict: "you",
        surfaceConfidence: 71,
        surfaceValueDeltaPct: -4.2,
        surfaceAnalysisMode: "league",
      },
      { DECISION_OS_TRADE_SHADOW_CONSOLE: "true" } as NodeJS.ProcessEnv,
    )
    expect(events).toHaveLength(1)
    const e = events[0]!
    expect(e.event).toBe("decision.shadow_parity")
    expect(e.decision_type).toBe("manager.trade.evaluate")
    expect(e.flags).toMatchObject({
      shadow: true,
      surface: "console",
      ran: false,
      reason: "missing_roster_identity",
      leagueScoped: true,
      authenticated: true,
      assetsGive: 2,
      assetsGet: 1,
      surfaceVerdict: "you",
      surfaceConfidence: 71,
      surfaceValueDeltaPct: -4.2,
      surfaceAnalysisMode: "league",
    })
  })

  it("carries the league and user IDS, not just booleans about them", () => {
    // Found on the first real production observation, 2026-09-04: every trade row landed with
    // decision_parity_record.leagueId and .userId NULL. persistParityEvent lifts `flags.leagueId`
    // and `flags.userId` into those columns, and this recorded only whether they EXISTED.
    //
    // It matters for the Phase 3 gate rather than for reporting: without the ids a sample cannot be
    // scoped to a league, cannot exclude the team's own test leagues, and cannot be weighted per
    // user. A gate satisfied by one enthusiastic tester in one league is not evidence about the
    // surface.
    const cap = captureEvents()
    try {
      recordTradeSurfaceShadow(
        { surface: "console", leagueId: "league-abc", userId: "user-123", assetsGive: 1, assetsGet: 1 },
        { DECISION_OS_TRADE_SHADOW_CONSOLE: "true" } as NodeJS.ProcessEnv,
      )
      expect(cap.events).toHaveLength(1)
      expect(cap.events[0]!.flags).toMatchObject({
        leagueId: "league-abc",
        userId: "user-123",
        // The booleans stay: they are what the skip taxonomy reads, and dropping them would
        // change canonicalInputSkipReason's inputs.
        leagueScoped: true,
        authenticated: true,
      })
    } finally {
      cap.stop()
    }
  })

  it("records nulls rather than omitting the ids on an anonymous console browse", () => {
    // The console allows unauthenticated use. A null is a fact about the sample; an absent key is
    // indistinguishable from a version of this code that never recorded it.
    const cap = captureEvents()
    try {
      recordTradeSurfaceShadow(
        { surface: "console", assetsGive: 1, assetsGet: 1 },
        { DECISION_OS_TRADE_SHADOW_CONSOLE: "true" } as NodeJS.ProcessEnv,
      )
      expect(cap.events).toHaveLength(1)
      const flags = cap.events[0]!.flags as Record<string, unknown>
      expect(flags).toHaveProperty("leagueId", null)
      expect(flags).toHaveProperty("userId", null)
      expect(flags.leagueScoped).toBe(false)
      expect(flags.authenticated).toBe(false)
    } finally {
      cap.stop()
    }
  })

  it("never throws, even when the telemetry sink explodes", () => {
    registerDecisionTelemetrySink(() => {
      throw new Error("sink boom")
    })
    expect(() =>
      recordTradeSurfaceShadow(
        { surface: "dynasty", surfaceVerdict: "Side A" },
        { DECISION_OS_TRADE_SHADOW_DYNASTY: "true" } as NodeJS.ProcessEnv,
      ),
    ).not.toThrow()
  })
})

describe("independent inputs get their own flip-gate bucket", () => {
  const base = {
    surface: "console" as TradeSurface,
    leagueId: "L1",
    userId: "u1",
    assetsGive: 1,
    assetsGet: 1,
  }
  const cmp = (over: Record<string, unknown> = {}) => ({
    canonicalGrade: "B",
    canonicalFairnessScore: 80,
    canonicalConfidenceScore: 88,
    canonicalValueDifference: 100,
    canonicalAdvantage: "you",
    agreement: true,
    playerAssets: 2,
    playerAssetsWithId: 2,
    ...over,
  })
  const env = { DECISION_OS_TRADE_SHADOW_CONSOLE: "true" } as never

  /** The bucket `flipReadiness` groups on — re-implemented here rather than trusted. */
  const bucketOf = (e: DecisionTelemetryEvent) => {
    const f = (e.flags ?? {}) as Record<string, unknown>
    return typeof f.surface === "string" && f.surface ? f.surface : "default"
  }

  it("a comparison fed the surface's OWN numbers stays in the original bucket", () => {
    const cap = captureEvents()
    recordTradeSurfaceShadow({ ...base, comparison: cmp({ independentInputs: false }) }, env)
    cap.stop()
    const parity = cap.events.filter((e) => e.event === "decision.shadow_parity")
    expect(parity).toHaveLength(1)
    expect(bucketOf(parity[0]!)).toBe("console")
  })

  it("a comparison fed INDEPENDENT values lands in a separate bucket", () => {
    const cap = captureEvents()
    recordTradeSurfaceShadow({ ...base, comparison: cmp({ independentInputs: true }) }, env)
    cap.stop()
    const parity = cap.events.filter((e) => e.event === "decision.shadow_parity")
    expect(parity).toHaveLength(1)
    expect(bucketOf(parity[0]!)).toBe("console_independent")
    // 🛑 The whole point: the two samples must not merge. flipReadiness groups on this string alone.
    expect(bucketOf(parity[0]!)).not.toBe("console")
  })

  it("carries the screen and the resolution rate alongside the bucket", () => {
    /*
     * Once `surface` can carry a suffix it no longer answers "which screen", and both questions get
     * asked. `playerAssetsWithId` is the yield that could not be read from existing telemetry — it
     * is emitted from the first request rather than waited for.
     */
    const cap = captureEvents()
    recordTradeSurfaceShadow(
      { ...base, comparison: cmp({ independentInputs: true, playerAssets: 3, playerAssetsWithId: 1 }) },
      env,
    )
    cap.stop()
    const f = (cap.events.find((e) => e.event === "decision.shadow_parity")?.flags ?? {}) as Record<string, unknown>
    expect(f.surfaceScreen).toBe("console")
    expect(f.independentInputs).toBe(true)
    expect(f.playerAssets).toBe(3)
    expect(f.playerAssetsWithId).toBe(1)
  })

  it("a SKIPPED observation is never promoted — no comparison means no independence claim", () => {
    const cap = captureEvents()
    recordTradeSurfaceShadow({ ...base, comparison: null }, env)
    cap.stop()
    const parity = cap.events.filter((e) => e.event === "decision.shadow_parity")
    expect(bucketOf(parity[0]!)).toBe("console")
    expect((parity[0]!.flags as Record<string, unknown>).independentInputs).toBe(false)
  })
})
