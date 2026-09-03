import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { routeTextCall } from "@/lib/ai/providerRouter"
import type { WorldCupMatchView } from "@/lib/world-cup/types"
import { buildWorldCupMatchupIntelligence } from "@/lib/world-cup/worldCupAIService"
import {
  getProbabilityBasedPickSides,
  describeBracketImpactIfTeamWins,
} from "@/lib/world-cup/worldCupPickStrategy"

/*
 * ⚠ THIS FILE USED TO MOCK `@/lib/openai-client`, WHICH THE SERVICE NO LONGER IMPORTS.
 * 1b9fcfe36 routed every World Cup LLM path through lib/ai/providerRouter so the validator and
 * audit log could not be bypassed — confirmed directly: that commit's parent names openaiChatText
 * three times and routeTextCall zero, and the commit itself the reverse. The mock was never moved.
 *
 * 🛑 THE COST WAS NOT ONLY TWO RED TESTS. `expect(spy).not.toHaveBeenCalled()` in the
 * not-entitled case was passing VACUOUSLY — the service never calls openaiChatText under any
 * conditions, so that assertion would have held even if the entitlement gate were deleted
 * entirely. Pointing the spy at the function the service actually calls is what restores it.
 */
vi.mock("@/lib/ai/providerRouter", () => ({
  routeTextCall: vi.fn().mockResolvedValue({
    ok: false,
    text: "",
    status: 503,
    details: "no ai",
    model: "x",
    provider: "x",
  }),
}))

/*
 * The service wraps every LLM call in an AiInsightCache lookup that reads and writes Postgres.
 * Stubbed to a guaranteed cache MISS that simply runs the factory, so these tests exercise the
 * prompt-construction path they are about rather than a database.
 */
vi.mock("@/lib/ai/aiInsightCache", () => ({
  getOrCreateWcMatchupInsight: vi.fn(
    async (
      _input: unknown,
      onCacheMiss: () => Promise<{
        resultText: string | null
        tokensUsed?: number
        provider?: string
        model?: string
      }>
    ) => {
      const miss = await onCacheMiss()
      return {
        text: miss.resultText ?? null,
        cacheHit: false,
        model: miss.model ?? null,
        tokensUsed: miss.tokensUsed ?? null,
        provider: miss.provider ?? null,
      }
    }
  ),
}))

// Audit logging writes a row; not what these tests are about.
vi.mock("@/lib/ai/auditLogger", () => ({
  logAiInteraction: vi.fn(),
}))

const baseMatch = (): WorldCupMatchView => ({
  id: "m1",
  apiFixtureId: null,
  round: "round_of_32",
  roundIndex: 1,
  matchNumber: 1,
  homeSlotKey: "A1",
  awaySlotKey: "B2",
  homeTeamId: "t-home",
  awayTeamId: "t-away",
  homeTeamName: "Alpha",
  awayTeamName: "Beta",
  homeTeamLogo: null,
  awayTeamLogo: null,
  homeScore: null,
  awayScore: null,
  homePenaltyScore: null,
  awayPenaltyScore: null,
  status: "scheduled",
  startsAt: null,
  winnerTeamId: null,
  winnerTeamName: null,
  nextMatchId: "m2",
  nextMatchSlot: "home",
  elapsedMinute: null,
  injuryTime: null,
  period: null,
  venueName: null,
  venueCity: null,
  apiStatusShort: null,
  lastScoreSyncedAt: null,
})

describe("worldCupPickStrategy", () => {
  it("Pick Safe side follows higher win probability", () => {
    const m = baseMatch()
    const sides = getProbabilityBasedPickSides(m, 0.72, 0.28)
    expect(sides.safePickSide).toBe("home")
    expect(sides.upsetPickSide).toBe("away")
    expect(sides.safePickTeamName).toBe("Alpha")
    expect(sides.upsetPickTeamName).toBe("Beta")
  })

  it("Pick Upset side follows lower win probability", () => {
    const m = baseMatch()
    const sides = getProbabilityBasedPickSides(m, 0.28, 0.72)
    expect(sides.safePickSide).toBe("away")
    expect(sides.upsetPickSide).toBe("home")
  })

  it("describes bracket impact for a knockout win", () => {
    const text = describeBracketImpactIfTeamWins(baseMatch(), "home")
    expect(text).toContain("Alpha")
    expect(text.length).toBeGreaterThan(20)
  })
})

describe("worldCupAIService buildWorldCupMatchupIntelligence", () => {
  const prevKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
    vi.mocked(routeTextCall).mockClear()
  })

  afterEach(() => {
    if (prevKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prevKey
  })

  it("returns deterministic probabilities and aligned safe/upset sides without OpenAI", async () => {
    const intel = await buildWorldCupMatchupIntelligence({
      match: baseMatch(),
      strategy: "balanced",
      intent: "panel",
    })

    expect(intel.homeWinProbability).toBeGreaterThan(0)
    expect(intel.awayWinProbability).toBeGreaterThan(0)
    expect(intel.homeWinProbability + intel.awayWinProbability).toBeCloseTo(1, 1)

    const sides = getProbabilityBasedPickSides(
      baseMatch(),
      intel.homeWinProbability,
      intel.awayWinProbability
    )
    expect(intel.safePickSide).toBe(sides.safePickSide)
    expect(intel.upsetPickSide).toBe(sides.upsetPickSide)
    expect(intel.narrativesGenerative).toBe(false)
    expect(intel.whyThisPickMakesSense.length).toBeGreaterThan(10)
    expect(intel.howRiskyIsThisPick.length).toBeGreaterThan(10)
    expect(intel.whatThisMeansForYourBracket.length).toBeGreaterThan(10)
  })

  it("does not call OpenAI when bracketBrainAiEntitled is false even if OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test"
    const spy = vi.mocked(routeTextCall)

    await buildWorldCupMatchupIntelligence({
      match: baseMatch(),
      strategy: "balanced",
      intent: "panel",
      bracketBrainAiEntitled: false,
    })

    expect(spy).not.toHaveBeenCalled()

    await buildWorldCupMatchupIntelligence({
      match: baseMatch(),
      strategy: "balanced",
      intent: "explain",
      bracketBrainAiEntitled: false,
    })

    expect(spy).not.toHaveBeenCalled()
  })

  it("calls OpenAI for panel summary when entitled and key present", async () => {
    process.env.OPENAI_API_KEY = "sk-test"
    const spy = vi.mocked(routeTextCall)
    spy.mockResolvedValueOnce({
      ok: true,
      text: "Concise preview text that is long enough for the threshold.",
      status: 200,
      details: "",
      model: "gpt-4",
      baseUrl: "",
    })

    const intel = await buildWorldCupMatchupIntelligence({
      match: baseMatch(),
      strategy: "balanced",
      intent: "panel",
      bracketBrainAiEntitled: true,
    })

    expect(spy).toHaveBeenCalled()
    const call = spy.mock.calls[0]?.[0]
    const system = call?.messages?.find((message) => message.role === "system")?.content ?? ""
    const user = call?.messages?.find((message) => message.role === "user")?.content ?? ""
    expect(system).toContain("provided AllFantasy bracket model inputs")
    expect(system).toContain("Do not imply live data")
    expect(system).not.toContain("No caveats about live data")
    expect(user).toContain("Source: stored AllFantasy bracket model only")
    expect(intel.generative).toBe(true)
    expect(intel.summary.length).toBeGreaterThan(20)
  })

  it("grounds explicit matchup explanations to provided bracket model data", async () => {
    process.env.OPENAI_API_KEY = "sk-test"
    const spy = vi.mocked(routeTextCall)
    spy.mockResolvedValueOnce({
      ok: true,
      text: "WHY: Bracket-model guidance favors Alpha.\nRISK: This is a projection, not a live fact.\nBRACKET: Pick Alpha if you want the model lean.",
      status: 200,
      details: "",
      model: "gpt-4",
      baseUrl: "",
    })

    const intel = await buildWorldCupMatchupIntelligence({
      match: baseMatch(),
      strategy: "balanced",
      intent: "explain",
      bracketBrainAiEntitled: true,
    })

    const call = spy.mock.calls[0]?.[0]
    const system = call?.messages?.find((message) => message.role === "system")?.content ?? ""
    const user = call?.messages?.find((message) => message.role === "user")?.content ?? ""
    expect(system).toContain("GROUNDING")
    expect(system).toContain("I don't have reliable data for that yet")
    expect(user).toContain("no live feed")
    expect(intel.narrativesGenerative).toBe(true)
  })
})
