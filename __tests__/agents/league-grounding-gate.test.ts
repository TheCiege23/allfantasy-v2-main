/**
 * Slice 12 (honesty pass) — Chimmy must not give team-specific advice without
 * league grounding. Regression guards for the two holes the audit found.
 */
import { describe, expect, it } from "vitest"
import {
  isLeagueGroundedContext,
  requiresLeagueGroundingFor,
} from "@/lib/agents/leagueGroundingGate"

const ask = (userMessage: string, extra: Partial<Parameters<typeof requiresLeagueGroundingFor>[0]> = {}) =>
  requiresLeagueGroundingFor({ intent: "quick_ask", userMessage, ...extra })

describe("requiresLeagueGroundingFor", () => {
  it("draft_help is no longer exempt (was: draft advice with zero league data)", () => {
    expect(requiresLeagueGroundingFor({ intent: "draft_help", userMessage: "thoughts?" })).toBe(true)
  })

  it("catches decision verbs the old pattern missed", () => {
    for (const message of [
      "should I drop Gibbs for the trending RB?",
      "who should I add this week",
      "can I claim him off waivers",
      "worth a pick up?",
      "do I keep him at that round cost",
      "time to sell high on Nacua",
      "should i cut my kicker",
      "who do I flex here",
    ]) {
      expect(ask(message), message).toBe(true)
    }
  })

  it("still requires grounding for the originally-covered phrasings", () => {
    for (const message of ["is this trade fair", "who should I start", "my roster looks thin"]) {
      expect(ask(message), message).toBe(true)
    }
  })

  it("general strategy questions are NOT gated", () => {
    for (const message of [
      "how does superflex scoring work",
      "what is VORP",
      "explain dynasty rookie pick value curves",
      "when did the league format change",
    ]) {
      expect(ask(message), message).toBe(false)
    }
  })

  it("team-specific surfaces and an explicit teamId always require grounding", () => {
    expect(ask("hey", { teamId: "team-1" })).toBe(true)
    expect(ask("hey", { source: "draft_room" })).toBe(true)
    expect(ask("hey", { source: "roster_page" })).toBe(true)
    expect(ask("hey", { source: "marketing_email" })).toBe(false)
  })
})

describe("isLeagueGroundedContext", () => {
  it("a players-only context is NOT league grounding (the truthiness hole)", () => {
    expect(isLeagueGroundedContext({ players: { "josh allen": {} } })).toBe(false)
    expect(isLeagueGroundedContext({ players: {}, crossLeague: { connectedLeagueCount: 3 } })).toBe(false)
  })

  it("null/empty contexts are not grounding", () => {
    expect(isLeagueGroundedContext(null)).toBe(false)
    expect(isLeagueGroundedContext(undefined)).toBe(false)
    expect(isLeagueGroundedContext({})).toBe(false)
    expect(isLeagueGroundedContext({ league: {} })).toBe(false)
  })

  it("a real league block counts", () => {
    expect(isLeagueGroundedContext({ league: { id: "L1", name: "Dynasty" } })).toBe(true)
  })
})
