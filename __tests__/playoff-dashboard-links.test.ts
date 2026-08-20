import { describe, expect, it } from "vitest"
import {
  PLAYOFF_DASHBOARD_LEADERBOARD_DOM_ID,
  playoffChallengeLeaderboardHref,
} from "@/lib/playoffs/playoffBracketDataSource"

describe("playoff dashboard deep links", () => {
  it("builds leaderboard href with tab and hash targeting the leaderboard anchor id", () => {
    expect(playoffChallengeLeaderboardHref("ch-uuid")).toBe(
      `/brackets/leagues/ch-uuid?tab=leaderboard#${PLAYOFF_DASHBOARD_LEADERBOARD_DOM_ID}`
    )
    expect(PLAYOFF_DASHBOARD_LEADERBOARD_DOM_ID).toBe("playoff-dashboard-leaderboard")
  })
})
