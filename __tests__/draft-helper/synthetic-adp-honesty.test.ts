/**
 * Slice 11 (honesty pass) — a synthetic ADP must never speak as market data.
 *
 * `getAdp` falls back to `overall + 20` when a player has no real ADP. That
 * prior is fine for ordering, but the engine was emitting
 * "typically drafted later (ADP ~87) — this is a reach at pick 67" from it.
 */
import { describe, expect, it } from "vitest"
import {
  computeDraftPlayerRankings,
  computeDraftRecommendation,
  type RecommendationInput,
} from "@/lib/draft-helper/RecommendationEngine"

const base = (extra: Partial<RecommendationInput>): RecommendationInput => ({
  available: [],
  teamRoster: [],
  rosterSlots: ["QB", "RB", "WR", "TE"],
  round: 6,
  pick: 7,
  totalTeams: 10,
  sport: "NFL",
  ...extra,
})

describe("synthetic ADP is flagged, not spoken", () => {
  it("marks rows with no real ADP as adpIsReal=false", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Real Adp", position: "WR", team: "AAA", adp: 40 },
          { name: "No Adp", position: "WR", team: "BBB" },
        ],
      }),
    )!
    expect(result.scored.find((r) => r.player.name === "Real Adp")!.adpIsReal).toBe(true)
    expect(result.scored.find((r) => r.player.name === "No Adp")!.adpIsReal).toBe(false)
  })

  /*
   * ⚠ THIS TEST ASSERTED THE OPPOSITE AND WAS DELIBERATELY REVERSED (user decision):
   * "no, don't speak AI ADP as market data."
   *
   * It was named "aiAdpByKey counts as real market data" and required adpIsReal === true. The
   * reasoning was that an AI-derived number is observed rather than invented, so it is not
   * what the honesty pass guards against. But these strings assert what THE MARKET does, and
   * an AllFantasy board built from nine in-house drafts is not the market. The number is still
   * used for ORDERING — `row.adp` is 22 below — it just stops being narrated.
   */
  it("aiAdpByKey orders the board but is NOT speakable as market data", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [{ name: "Site Adp", position: "WR", team: "CCC" }],
        aiAdpByKey: { "site adp|wr|ccc": 22 },
      }),
    )!
    const row = result.scored[0]!
    expect(row.adp).toBe(22) // still orders by it
    expect(row.adpIsReal).toBe(false) // but may not be spoken
  })

  it("says no MARKET adp rather than no adp, when the AI board did supply one", () => {
    const out = computeDraftRecommendation(
      base({
        available: [{ name: "Site Adp", position: "WR", team: "CCC" }],
        aiAdpByKey: { "site adp|wr|ccc": 22 },
      }),
    )
    // Claiming "no ADP data" would be false — the engine is ordering by 22 right now.
    expect(out.evidence.join(" ")).toMatch(/no market ADP/i)
    expect(out.evidence.join(" ")).not.toMatch(/no ADP data/i)
  })

  it("emits no reach or value warning for an AI-priced player", () => {
    // The whole point: a player the MARKET has not priced gets no market claim at all.
    const out = computeDraftRecommendation(
      base({
        round: 1,
        pick: 1,
        available: [{ name: "Site Adp", position: "WR", team: "CCC" }],
        aiAdpByKey: { "site adp|wr|ccc": 200 },
      }),
    )
    expect(out.reachWarning).toBeNull()
    expect(out.valueWarning).toBeNull()
    expect(out.recommendation!.reason).not.toMatch(/value vs ADP/i)
  })

  it("exposes adpIsReal on the returned recommendation so callers outside can gate", () => {
    /*
     * `lib/ai/draft/aiDraftIntelligence.ts` calls this engine WITHOUT aiAdpByKey, so an
     * unpriced player gets the synthetic `overall + 20` and adpEdge pins to exactly -20 at
     * every pick — which made "Current pick is a reach vs platform ADP" fire 100% of the time
     * for a wholly unpriced pool. It could not tell, because the flag stopped at this
     * function's boundary.
     */
    const unpriced = computeDraftRecommendation(
      base({ available: [{ name: "No Adp", position: "WR", team: "BBB" }] }),
    )
    expect(unpriced.recommendation!.adpIsReal).toBe(false)
    // The -20 pin the caller was reading as a market verdict.
    expect(unpriced.recommendation!.adpEdge).toBe(-20)

    const priced = computeDraftRecommendation(
      base({ available: [{ name: "Real Adp", position: "WR", team: "AAA", adp: 40 }] }),
    )
    expect(priced.recommendation!.adpIsReal).toBe(true)
  })

  it("withholds the tier-cliff ADP claim when the anchor is not a real ADP", () => {
    // The gap is measured from getAdp's anchor to REAL ADPs; a non-real anchor compares
    // two different things, and this line was the only ADP evidence without the guard.
    const out = computeDraftRecommendation(
      base({
        available: [
          { name: "No Adp", position: "WR", team: "BBB" },
          { name: "Later One", position: "WR", team: "CCC", adp: 120 },
          { name: "Later Two", position: "WR", team: "DDD", adp: 140 },
        ],
      }),
    )
    if (!out.recommendation!.adpIsReal) {
      expect(out.evidence.join(" ")).not.toMatch(/Tier cliff/i)
    }
  })

  it("still speaks freely when the market HAS priced the player", () => {
    // Positive control: the gate must not have silenced everything.
    const out = computeDraftRecommendation(
      base({
        round: 1,
        pick: 1,
        available: [{ name: "Real Adp", position: "WR", team: "AAA", adp: 90 }],
      }),
    )
    expect(out.reachWarning).toMatch(/typically drafted later/i)
    expect(out.evidence.join(" ")).toMatch(/picks vs ADP/)
  })
})

/**
 * 🛑 REAL ADP ALWAYS WINS — `aiAdpByKey` is a FALLBACK, never an override.
 *
 * `getAdp` used to return `aiAdpByKey[key]` in preference to `p.adp`, so an AllFantasy board
 * built from as few as nine in-house drafts silently replaced the market board for every
 * player it covered, and `hasRealAdp` then reported the substitute as real. Nothing in the
 * suite would have caught a re-inversion, which is what these tests are for.
 */
describe("real ADP outranks the AI board", () => {
  it("uses the market ADP when both are present", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [{ name: "Both Adp", position: "WR", team: "DDD", adp: 40 }],
        aiAdpByKey: { "both adp|wr|ddd": 12 },
      }),
    )!
    const row = result.scored[0]!
    expect(row.adp).toBe(40)
    expect(row.adp).not.toBe(12)
    expect(row.adpIsReal).toBe(true)
  })

  it("still uses the AI board where the market has no price — the rookie gap it exists for", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Both Adp", position: "WR", team: "DDD", adp: 40 },
          { name: "Rookie Only", position: "RB", team: "EEE" },
        ],
        aiAdpByKey: { "both adp|wr|ddd": 12, "rookie only|rb|eee": 31.7 },
      }),
    )!
    expect(result.scored.find((r) => r.player.name === "Both Adp")!.adp).toBe(40)
    expect(result.scored.find((r) => r.player.name === "Rookie Only")!.adp).toBe(31.7)
  })

  it("does not let an AI value change the pick order of a market-priced player", () => {
    /*
     * The behavioural version of the same rule: an AI board that rates B far higher must not
     * reorder two players the market has already priced.
     */
    const withoutAi = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Early A", position: "WR", team: "AAA", adp: 10 },
          { name: "Late B", position: "WR", team: "BBB", adp: 90 },
        ],
      }),
    )!
    const withAi = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Early A", position: "WR", team: "AAA", adp: 10 },
          { name: "Late B", position: "WR", team: "BBB", adp: 90 },
        ],
        aiAdpByKey: { "late b|wr|bbb": 1 },
      }),
    )!
    const order = (r: typeof withoutAi) => r.scored.map((s) => s.player.name)
    expect(order(withAi)).toEqual(order(withoutAi))
  })

  it("falls through to the AI board when p.adp is present but unusable", () => {
    const result = computeDraftPlayerRankings(
      base({
        available: [
          { name: "Nan Adp", position: "WR", team: "FFF", adp: Number.NaN as unknown as number },
        ],
        aiAdpByKey: { "nan adp|wr|fff": 55 },
      }),
    )!
    // A NaN adp used to produce a NaN adpEdge and poison the score.
    expect(result.scored[0]!.adp).toBe(55)
    expect(Number.isFinite(result.scored[0]!.adp)).toBe(true)
  })
})

describe("synthetic ADP is flagged, not spoken (cont.)", () => {
  it("emits NO reach/value warning and no market-edge claim for synthetic ADP", () => {
    const out = computeDraftRecommendation(
      base({ available: [{ name: "No Adp", position: "WR", team: "BBB" }] }),
    )
    expect(out.reachWarning).toBeNull()
    expect(out.valueWarning).toBeNull()
    expect(out.evidence.join(" ")).toMatch(/Market edge: unavailable/)
    expect(out.evidence.join(" ")).not.toMatch(/picks vs ADP/)
    expect(out.recommendation!.reason).not.toMatch(/value vs ADP/i)
  })

  it("still emits real reach warnings when ADP is genuine", () => {
    const out = computeDraftRecommendation(
      // overall = (6-1)*10 + 7 = 57; ADP 90 is a genuine reach.
      base({ available: [{ name: "Real Reach", position: "WR", team: "AAA", adp: 90 }] }),
    )
    expect(out.reachWarning).toMatch(/typically drafted later \(ADP ~90\)/)
    expect(out.evidence.join(" ")).toMatch(/picks vs ADP/)
  })
})
