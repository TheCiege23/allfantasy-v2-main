import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ read: vi.fn(), publish: vi.fn() }))
vi.mock("@/lib/playoffs/publishSeasonBracketFinal", () => ({ readSeasonBracketGame: mocks.read, publishSeasonBracketFinal: mocks.publish }))
import { syncCfpOfficialResults } from "@/lib/playoffs/syncCfpOfficialResults"

const date = "2025-12-21T00:30:00.000Z"
const games = [{ seriesNumber: 2, matchupId: 42, startsAt: date }]
const completed = { id: 401779843, startDate: date, completed: true, homeTeam: { school: "Oregon" }, awayTeam: { school: "James Madison" }, homePoints: 51, awayPoints: 34 }
const payload = (game: unknown) => ({ rounds: [{ matchups: [{ id: 42, game }] }] })

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers().setSystemTime(new Date("2025-12-21T05:00:00Z"))
  mocks.read.mockResolvedValue({ ok: true, home: "Oregon", away: "James Madison" })
  mocks.publish.mockResolvedValue({ ok: true, updatedPools: 1 })
})
afterEach(() => vi.useRealTimers())

describe("official CFP final results", () => {
  it("publishes only a verified completed matchup", async () => {
    expect(await syncCfpOfficialResults({ season: 2025, games, payload: payload(completed) })).toEqual({ published: 1, failures: 0 })
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ seriesNumber: 2, homeScore: 51, awayScore: 34, expectedHome: "Oregon", expectedAway: "James Madison" }))
  })
  it("correctly orients the score when provider home and bracket home are reversed", async () => {
    mocks.read.mockResolvedValue({ ok: true, home: "James Madison", away: "Oregon" })
    await syncCfpOfficialResults({ season: 2025, games, payload: payload(completed) })
    expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({ homeScore: 34, awayScore: 51 }))
  })
  it("does not publish live games, wrong teams, invalid scores or mismatched kickoff times", async () => {
    for (const game of [
      { ...completed, completed: false },
      { ...completed, awayTeam: { school: "Different team" } },
      { ...completed, homePoints: 34 },
      { ...completed, startDate: "2025-12-23T00:30:00.000Z" },
    ]) await syncCfpOfficialResults({ season: 2025, games, payload: payload(game) })
    expect(mocks.publish).not.toHaveBeenCalled()
  })
})
