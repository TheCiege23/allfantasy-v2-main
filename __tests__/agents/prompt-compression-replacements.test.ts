/**
 * Slice 8 — replacement-options grounding section in the compressed Chimmy prompt.
 */
import { describe, expect, it } from "vitest"
import { buildCompressedSystemPrompt } from "@/lib/agents/prompt-compression"

const ctx = { sport: "NFL", leagueFormat: "redraft", scoring: "PPR" }

describe("buildCompressedSystemPrompt — REPLACEMENT OPTIONS section", () => {
  it("renders deterministic candidates with deltas and the do-not-invent instruction", () => {
    const prompt = buildCompressedSystemPrompt({
      rawPrompt: "BASE PROMPT",
      ctx,
      structuredFantasyContext: {
        replacementOptions: {
          playerName: "Amon-Ra St. Brown",
          affectedProjection: 16.4,
          projectionWeek: 3,
          benchOptions: [
            { playerId: "b1", name: "Jameson Williams", position: "WR", projectedPoints: 13.1, delta: -3.3 },
          ],
          freeAgentOptions: [
            { playerId: "f1", name: "Darnell Mooney", position: "WR", projectedPoints: 12.2, delta: -4.2 },
            { playerId: "f2", name: "Quentin Johnston", position: "WR", projectedPoints: 11.8, delta: -4.6 },
          ],
          claimTarget: { kind: "native", url: "/waiver-wire?leagueId=L1" },
          limitation: null,
        },
      },
    })
    expect(prompt).toContain("## REPLACEMENT OPTIONS — Amon-Ra St. Brown")
    expect(prompt).toContain("cite these numbers, do not invent alternatives")
    expect(prompt).toContain("Amon-Ra St. Brown projects 16.4 (week 3)")
    expect(prompt).toContain("Jameson Williams WR 13.1 proj (-3.3)")
    expect(prompt).toContain("Darnell Mooney WR 12.2 proj (-4.2)")
    expect(prompt).toContain("AllFantasy waiver wire")
  })

  it("provider leagues get the advise-not-execute line", () => {
    const prompt = buildCompressedSystemPrompt({
      rawPrompt: "BASE PROMPT",
      ctx,
      structuredFantasyContext: {
        replacementOptions: {
          playerName: "Test Player",
          affectedProjection: 10,
          projectionWeek: 2,
          benchOptions: [],
          freeAgentOptions: [{ playerId: "f1", name: "Someone", position: null, projectedPoints: 9.1, delta: -0.9 }],
          claimTarget: { kind: "provider", provider: "sleeper", url: "https://sleeper.com/leagues/1/players" },
          limitation: null,
        },
      },
    })
    expect(prompt).toContain("lives on sleeper")
    expect(prompt).toContain("cannot execute the claim")
  })

  it("no-projection leagues instruct honesty instead of estimates", () => {
    const prompt = buildCompressedSystemPrompt({
      rawPrompt: "BASE PROMPT",
      ctx,
      structuredFantasyContext: {
        replacementOptions: {
          playerName: "Test Player",
          limitation: "no_projection_data",
          benchOptions: [],
          freeAgentOptions: [],
        },
      },
    })
    expect(prompt).toContain("No real projection data exists for this league yet")
  })

  it("absent replacementOptions leaves the prompt untouched", () => {
    const without = buildCompressedSystemPrompt({ rawPrompt: "BASE PROMPT", ctx, structuredFantasyContext: {} })
    expect(without).not.toContain("REPLACEMENT OPTIONS")
  })
})
