import { describe, expect, it } from "vitest"
import { matchCfpLiveScore } from "@/lib/playoffs/cfpLiveScores"
import type { PlayoffSeriesView } from "@/lib/playoffs/types"

const now = Date.parse("2026-12-31T01:00:00Z")
const game = { homeTeamName: "Oregon", awayTeamName: "Georgia", startsAt: "2026-12-31T00:30:00Z" } as PlayoffSeriesView
const row = { home: "Georgia", away: "Oregon", homeScore: 7, awayScore: 0, startsAt: "2026-12-31T00:30:00Z", fetchedAt: "2026-12-31T00:59:00Z" }

describe("CFP live score matching", () => {
  it("matches both actual participants, even if home and away are reversed", () => expect(matchCfpLiveScore(game, [row], now)).toEqual(row))
  it("rejects a projected opponent, a stale feed, and ambiguous duplicate events", () => {
    expect(matchCfpLiveScore({ ...game, awayTeamName: "Texas" }, [row], now)).toBeNull()
    expect(matchCfpLiveScore(game, [{ ...row, fetchedAt: "2026-12-31T00:40:00Z" }], now)).toBeNull()
    expect(matchCfpLiveScore(game, [row, row], now)).toBeNull()
  })
})
