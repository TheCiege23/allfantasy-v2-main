import { describe, expect, it } from "vitest"
import { requestContractToUnified } from "@/lib/ai-tool-registry/request-adapter"

describe("requestContractToUnified", () => {
  it("builds a tool envelope with canonical feature key and sport normalization", () => {
    const unified = requestContractToUnified({
      tool: "League Rankings Explainer",
      sport: "soccer",
      leagueId: "lg-1",
      deterministicContext: {
        ordering: ["Team A", "Team B"],
        tiers: { tier1: ["Team A"] },
      },
      userMessage: "Explain these rankings.",
    })

    expect(unified.envelope.featureType).toBe("rankings")
    expect(unified.envelope.sport).toBe("SOCCER")
    expect(unified.envelope.hardConstraints).toEqual(
      expect.arrayContaining(["Deterministic-first: never override hard engine outputs."])
    )
  })

  // Milestone 32: the `psychological` tool is retired from the registry (the routes
  // refuse it — see ai-psychological-tool-retired.test.ts), and the adapter no
  // longer builds its profile-explanation envelope either.
  it("builds no profile-explanation envelope for the retired psychological tool", () => {
    const unified = requestContractToUnified({
      tool: "psychological",
      sport: "NFL",
      deterministicContext: { profile: { style: "aggressive" }, evidence: ["trade frequency"] },
      userMessage: "Explain this profile.",
    })
    expect(unified.envelope.hardConstraints).not.toContain(
      "Explain only using the provided profile scores and evidence."
    )
    expect(unified.envelope.deterministicContextEnvelope ?? null).toBeNull()
  })

  it("maps simulation alias into matchup adapter and respects requested mode", () => {
    const unified = requestContractToUnified({
      tool: "simulation",
      sport: "NBA",
      deterministicContext: {
        matchupSummary: { spread: -2.5 },
        projections: { winProbability: 61 },
      },
      aiMode: "consensus",
      userMessage: "Explain this matchup edge.",
    })

    expect(unified.envelope.featureType).toBe("matchup")
    expect(unified.envelope.promptIntent).toBe("explain")
    expect(unified.mode).toBe("consensus")
  })

  it("forces single_model when a supported provider is explicitly requested", () => {
    const unified = requestContractToUnified({
      tool: "trade_analyzer",
      sport: "NFL",
      deterministicContext: {
        fairnessScore: 54,
        valueDelta: 110,
        sideATotalValue: 8400,
        sideBTotalValue: 8290,
      },
      provider: "deepseek",
      aiMode: "consensus",
      userMessage: "Break down this trade.",
    })

    expect(unified.mode).toBe("single_model")
    expect(unified.envelope.modelRoutingHints).toEqual(["deepseek"])
  })
})
