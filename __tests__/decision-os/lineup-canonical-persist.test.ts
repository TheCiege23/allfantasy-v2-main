/**
 * The lineup sweep's canonical writer (P5 step 1) — the first production caller the canonical
 * decision layer has ever had.
 *
 * 🛑 CONTEXT, BECAUSE IT IS THE WHOLE REASON THIS FILE EXISTS. Measured 2026-09-08:
 * `canonical_decisions` has a 46-column schema, a migration, a validated persistence boundary and
 * five adapters — and ZERO production callers of any of them, and ZERO rows. `adaptLineupStartSit`
 * and `shadowPersistDecisions` appeared only in their own definitions, the contract doc, and tests.
 * So the flag was never "the switch that fills the table"; there was no writer for it to gate.
 *
 * Every case here runs against `InMemoryCanonicalDecisionStore`, so the mapping is provable with no
 * database, no provider and no flag — which is also how the shape gets reviewed BEFORE any row is
 * written to production.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/lineup-actions/computeLineupActionsForUser", () => ({
  computeLineupActionsForUser: async () => ({ leagues: [{ leagueId: "L1" }] }),
}))
vi.mock("@/lib/decision-os/lineup/shadow", () => ({ runLineupShadowForSummary: async () => [] }))

import { persistLineupCanonicalDecisions } from "@/lib/decision-os/lineup/canonicalPersist"
import { InMemoryCanonicalDecisionStore } from "@/lib/decision-os/canonical"
import { runLineupShadowSweep, type ShadowSweepDeps } from "@/lib/decision-os/lineup/shadowSweep"
import type { LineupShadowResult } from "@/lib/decision-os/lineup/shadow"

const ON = { DECISION_OS_CANONICAL_SHADOW_ENABLED: "true" } as unknown as NodeJS.ProcessEnv
const OFF = {} as unknown as NodeJS.ProcessEnv

function ranResult(leagueId: string, over: Record<string, unknown> = {}): LineupShadowResult {
  return {
    ran: true,
    leagueId,
    source: "redraft_native",
    result: {
      world: { sport: "NFL", week: 5, season: 2026 },
      dco: {},
      decision: {
        decision_id: `dec-${leagueId}`,
        decision_type: "manager.lineup.set",
        four_answers: {
          what_happened: "2 lineup actions need attention before lock.",
          why_it_matters: "WR requires 2 starters; currently 1.",
          how_confident: "Medium confidence (data partial).",
          what_to_do: "Fill the empty WR slot before lock.",
        },
        explanation: "WR requires 2 starters; currently 1. Fill the empty WR slot before lock.",
        confidence: 74,
        ...(over.decision as object ?? {}),
      },
    },
    ...over,
  } as unknown as LineupShadowResult
}

const base = { userId: "u1", runId: "sweep-tick-1" }

describe("lineup canonical persist — the sweep's writer", () => {
  it("adapts a ran shadow result and persists it", async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const res = await persistLineupCanonicalDecisions({
      ...base, results: [ranResult("L1")], store, env: ON,
    })

    expect("persisted" in res && res.persisted).toBe(1)
    expect("rejected" in res ? res.rejected : []).toEqual([])
  })

  it("carries the four answers onto the contract's own fields", async () => {
    const store = new InMemoryCanonicalDecisionStore()
    await persistLineupCanonicalDecisions({ ...base, results: [ranResult("L1")], store, env: ON })

    const [row] = [...store.rows.values()]
    // headline / explanation / recommendedAction are three DIFFERENT contract fields, and the
    // engine's four answers are what fills them. A regression collapsing them would store the same
    // sentence three times and nobody reading a row would notice.
    expect(row!.headline).toBe("2 lineup actions need attention before lock.")
    expect(row!.recommendedAction).toBe("Fill the empty WR slot before lock.")
    expect(row!.explanation).toContain("WR requires 2 starters")
    expect(row!.confidencePct).toBe(74)
  })

  it("stamps period from the world's week, and leaves it null when the week is unknown", async () => {
    const withWeek = new InMemoryCanonicalDecisionStore()
    await persistLineupCanonicalDecisions({ ...base, results: [ranResult("L1")], store: withWeek, env: ON })
    expect([...withWeek.rows.values()][0]!.period).toBe("week:5")

    // `week:undefined` would be worse than nothing — it reads as a real period.
    const noWeek = ranResult("L2")
    ;(noWeek.result as unknown as { world: Record<string, unknown> }).world = { sport: "NFL", season: 2026 }
    const without = new InMemoryCanonicalDecisionStore()
    await persistLineupCanonicalDecisions({ ...base, results: [noWeek], store: without, env: ON })
    expect([...without.rows.values()][0]!.period).toBeNull()
  })

  it("does NOT report the input provenance as a fantasy platform", async () => {
    const store = new InMemoryCanonicalDecisionStore()
    await persistLineupCanonicalDecisions({
      ...base, results: [ranResult("L1", { source: "canonical_world_unavailable" })], store, env: ON,
    })
    // `source` is 'redraft_native' | 'canonical_world_*' — where the INPUTS came from. It is not
    // sleeper/espn/yahoo, and writing it into `sourcePlatform` would put provenance in a column
    // downstream readers treat as the platform.
    expect([...store.rows.values()][0]!.sourcePlatform).toBeNull()
  })

  it("writes NOTHING when the canonical shadow flag is off", async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const res = await persistLineupCanonicalDecisions({
      ...base, results: [ranResult("L1")], store, env: OFF,
    })

    expect([...store.rows.values()]).toHaveLength(0)
    expect("skippedReason" in res ? res.skippedReason : null).toBe("shadow_disabled")
  })

  it("skips results the shadow did not run, without touching the store", async () => {
    const store = new InMemoryCanonicalDecisionStore()
    const res = await persistLineupCanonicalDecisions({
      ...base,
      results: [{ ran: false, leagueId: "L9", error: "inputs_unavailable" } as LineupShadowResult],
      store, env: ON,
    })

    expect([...store.rows.values()]).toHaveLength(0)
    expect("error" in res ? res.error : null).toBe("no_ran_results")
  })

  it("never throws — a malformed result degrades to an error result", async () => {
    const store = new InMemoryCanonicalDecisionStore()
    // `ran: true` with a decision missing the four answers: the adapter or validator will object,
    // and a cron that also does real work must not die of it.
    const broken = { ran: true, leagueId: "L1", result: { world: {}, dco: {}, decision: {} } } as unknown as LineupShadowResult
    const res = await persistLineupCanonicalDecisions({ ...base, results: [broken], store, env: ON })

    expect(res).toBeTruthy()
    expect("persisted" in res ? res.persisted : 0).toBe(0)
  })

  it("one runId for the whole tick, so a re-run is one revision occurrence and not many", async () => {
    const store = new InMemoryCanonicalDecisionStore()
    await persistLineupCanonicalDecisions({
      ...base, results: [ranResult("L1"), ranResult("L2")], store, env: ON,
    })
    const runIds = new Set([...store.rows.values()].map((d) => d.runId))
    // Shadow persistence REJECTS a null runId, and a per-decision id would make every write its
    // own run — defeating the same-run conflict detection the revision table exists for.
    expect(runIds).toEqual(new Set(["sweep-tick-1"]))
  })
})

/**
 * 🛑 THE SUITE ABOVE PROVES THE MAPPING; THIS PROVES THE SWEEP ACTUALLY CALLS IT.
 *
 * Without these, deleting the `persistCanonical` call from `runLineupShadowSweep` reddens nothing:
 * every mapping assertion above invokes the writer directly and would keep passing over a sweep
 * that had stopped writing entirely. That is the "seam with no consumer" failure reached from the
 * test side — a green suite standing over a dead wire.
 */
describe("the sweep calls the writer", () => {
  const sweepDeps = (over: Partial<ShadowSweepDeps> = {}): ShadowSweepDeps => ({
    countCandidates: async () => 1,
    listCandidateUserIds: async () => ["u1"],
    computeSummary: async () => ({ leagues: [{ leagueId: "L1" }] }) as never,
    runShadow: async () => [{ ran: true, leagueId: "L1" } as never],
    now: () => 0,
    ...over,
  })

  it("hands the tick's results to persistCanonical", async () => {
    const seen: Array<{ userId: string; n: number }> = []
    await runLineupShadowSweep(
      sweepDeps({ persistCanonical: async (userId, results) => { seen.push({ userId, n: results.length }) } }),
      { enabled: true },
    )
    expect(seen).toEqual([{ userId: "u1", n: 1 }])
  })

  it("is entirely optional — omitting it leaves the sweep byte-identical", async () => {
    // The dep is optional precisely so the two features stay independently gated. A sweep with no
    // writer must still count its comparisons exactly as before.
    const res = await runLineupShadowSweep(sweepDeps(), { enabled: true })
    expect(res.ran).toBe(true)
    expect(res.comparisons).toBe(1)
  })

  it("a writer that rejects cannot abort the tick", async () => {
    // The persist swallows its own failures, but the sweep must not depend on that being true
    // forever — a telemetry-adjacent write has no business failing a cron that also does real work.
    const res = await runLineupShadowSweep(
      sweepDeps({ persistCanonical: async () => { throw new Error("store down") } }),
      { enabled: true },
    )
    expect(res.ran).toBe(true)
    expect(res.errors).toBe(1)
  })
})
