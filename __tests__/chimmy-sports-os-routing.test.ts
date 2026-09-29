import { describe, expect, it } from "vitest"
import {
  intentToToolId,
  resolveToolLaunches,
} from "@/lib/chimmy-orchestration/tool-routing-map"

/**
 * The chimmy-context intent classifier and provider selector this suite also exercised were
 * deleted as dead code on 2026-09-29 (their only runtime caller was the removed /api/ai/chat
 * route). The tool-routing-map assertions test a live module and stay.
 */
describe("Chimmy Sports OS intent routing", () => {
  it("routes commissioner requests to the commissioner tool launch", () => {
    expect(intentToToolId("commissioner")).toBe("commissioner_report")
    expect(resolveToolLaunches("commissioner", { leagueId: "league-1", sport: "NFL" }).primary?.href)
      .toContain("tab=commissioner")
  })

  it("routes bracket, injury, and weather intents away from generic chat", () => {
    expect(intentToToolId("bracket")).toBe("bracket_intelligence")
    expect(intentToToolId("injury")).toBe("injury_report")
    expect(intentToToolId("weather")).toBe("weather_engine")
  })
})
