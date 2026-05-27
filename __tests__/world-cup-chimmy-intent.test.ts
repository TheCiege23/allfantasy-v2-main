/**
 * Chimmy intent classifier — pure unit tests (no mocks needed).
 *
 * detectChimmyIntent, isLiveDataIntent, isScheduleIntent are pure functions
 * with no external dependencies; test them directly against regex patterns.
 */
import { describe, expect, it } from "vitest"
import {
  detectChimmyIntent,
  isLiveDataIntent,
  isScheduleIntent,
} from "@/lib/world-cup/worldCupChimmyIntent"

describe("detectChimmyIntent", () => {
  // ── live_score ───────────────────────────────────────────────────────────
  it("classifies score questions as live_score", () => {
    expect(detectChimmyIntent("What's the score?")).toBe("live_score")
    expect(detectChimmyIntent("Who is winning right now?")).toBe("live_score")
    expect(detectChimmyIntent("Current score in the final")).toBe("live_score")
    expect(detectChimmyIntent("Latest score Brazil vs Argentina")).toBe("live_score")
  })

  it("classifies goal/result questions as live_score", () => {
    expect(detectChimmyIntent("How many goals so far?")).toBe("live_score")
    expect(detectChimmyIntent("Any goals yet?")).toBe("live_score")
    expect(detectChimmyIntent("What is the result?")).toBe("live_score")
  })

  // ── live_stats ───────────────────────────────────────────────────────────
  it("classifies possession/xg questions as live_stats", () => {
    expect(detectChimmyIntent("What is the possession?")).toBe("live_stats")
    expect(detectChimmyIntent("How many shots on target?")).toBe("live_stats")
    expect(detectChimmyIntent("Show me the match statistics")).toBe("live_stats")
  })

  // ── schedule ─────────────────────────────────────────────────────────────
  it("classifies fixture/kickoff questions as schedule", () => {
    expect(detectChimmyIntent("When does the next match start?")).toBe("schedule")
    expect(detectChimmyIntent("What time does Brazil play today?")).toBe("schedule")
    expect(detectChimmyIntent("Show me upcoming fixtures")).toBe("schedule")
    expect(detectChimmyIntent("Who plays tomorrow?")).toBe("schedule")
  })

  // ── standings ────────────────────────────────────────────────────────────
  it("classifies group table questions as standings", () => {
    expect(detectChimmyIntent("What are the group standings?")).toBe("standings")
    expect(detectChimmyIntent("Who advances from the group?")).toBe("standings")
    expect(detectChimmyIntent("Is Germany eliminated?")).toBe("standings")
  })

  // ── leaderboard_rank ─────────────────────────────────────────────────────
  it("classifies pool rank questions as leaderboard_rank", () => {
    expect(detectChimmyIntent("What is my pool rank?")).toBe("leaderboard_rank")
    expect(detectChimmyIntent("How am I doing in this pool?")).toBe("leaderboard_rank")
    expect(detectChimmyIntent("How many points am I behind in the pool?")).toBe("leaderboard_rank")
    expect(detectChimmyIntent("Where do I stand in the pool?")).toBe("leaderboard_rank")
    expect(detectChimmyIntent("Show me the leaderboard")).toBe("leaderboard_rank")
  })

  // ── scoring_rules ────────────────────────────────────────────────────────
  it("classifies point/scoring rule questions as scoring_rules", () => {
    expect(detectChimmyIntent("How many points do I get for the semifinal?")).toBe("scoring_rules")
    expect(detectChimmyIntent("How does scoring work?")).toBe("scoring_rules")
    expect(detectChimmyIntent("What is the champion bonus worth?")).toBe("scoring_rules")
    expect(detectChimmyIntent("Point breakdown for quarterfinals")).toBe("scoring_rules")
  })

  // ── third_place_strategy ─────────────────────────────────────────────────
  it("classifies third-place questions as third_place_strategy", () => {
    expect(detectChimmyIntent("Should I care about the third place match?")).toBe("third_place_strategy")
    expect(detectChimmyIntent("Does the 3rd place pick matter?")).toBe("third_place_strategy")
  })

  // ── group_strategy ───────────────────────────────────────────────────────
  it("classifies group ranking strategy questions as group_strategy", () => {
    expect(detectChimmyIntent("Who should I rank first in Group A?")).toBe("group_strategy")
    expect(detectChimmyIntent("My predicted ranking for group B")).toBe("group_strategy")
  })

  // ── bracket_strategy ─────────────────────────────────────────────────────
  it("classifies bracket pick questions as bracket_strategy", () => {
    expect(detectChimmyIntent("Who should I pick for the quarterfinal?")).toBe("bracket_strategy")
    expect(detectChimmyIntent("Is my bracket looking risky?")).toBe("bracket_strategy")
    expect(detectChimmyIntent("Dark horse pick for the champion?")).toBe("bracket_strategy")
    expect(detectChimmyIntent("Who do I choose for the final?")).toBe("bracket_strategy")
  })

  // ── general_chat ─────────────────────────────────────────────────────────
  it("falls back to general_chat for unrecognised input", () => {
    expect(detectChimmyIntent("Tell me something interesting")).toBe("general_chat")
    expect(detectChimmyIntent("Hi Chimmy!")).toBe("general_chat")
    expect(detectChimmyIntent("")).toBe("general_chat")
  })
})

describe("isLiveDataIntent", () => {
  it("returns true for live_score and live_stats", () => {
    expect(isLiveDataIntent("live_score")).toBe(true)
    expect(isLiveDataIntent("live_stats")).toBe(true)
  })

  it("returns false for all other intents", () => {
    const others = [
      "schedule", "standings", "bracket_strategy", "group_strategy",
      "third_place_strategy", "scoring_rules", "leaderboard_rank", "general_chat",
    ] as const
    for (const intent of others) {
      expect(isLiveDataIntent(intent), `isLiveDataIntent("${intent}") should be false`).toBe(false)
    }
  })
})

describe("isScheduleIntent", () => {
  it("returns true only for schedule", () => {
    expect(isScheduleIntent("schedule")).toBe(true)
  })

  it("returns false for all other intents", () => {
    const others = [
      "live_score", "live_stats", "standings", "bracket_strategy", "group_strategy",
      "third_place_strategy", "scoring_rules", "leaderboard_rank", "general_chat",
    ] as const
    for (const intent of others) {
      expect(isScheduleIntent(intent), `isScheduleIntent("${intent}") should be false`).toBe(false)
    }
  })
})
