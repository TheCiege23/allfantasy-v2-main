import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PlayoffChallengeView } from "@/lib/playoffs/types"
import { buildPlayoffTemplate } from "@/lib/playoffs/playoffTemplate"
const mocks = vi.hoisted(() => ({ view: vi.fn(), picks: vi.fn(), games: vi.fn(), injuries: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { playoffBracketPick: { findMany: mocks.picks }, sportsGame: { findMany: mocks.games } } }))
vi.mock("@/lib/playoffs/playoffService", () => ({ getPlayoffBracketView: mocks.view }))
vi.mock("@/lib/injuries/injuryReadPort", () => ({ listInjuryFacts: mocks.injuries }))
import { loadBracketCoach, loadMatchupEvidence } from "@/lib/playoffs/bracketCoachService"
const view = (): PlayoffChallengeView => ({
  challenge: { id: "cup", name: "Friends", ownerUserId: "owner", sport: "nba_cup", seasonYear: 2026, status: "open", isTestMode: false, createdAt: "", updatedAt: "" },
  viewerUserId: "me", activeEntry: { id: "mine", name: "Mine", userId: "me", isComplete: true, finalizedAt: "2020-01-01", pickCount: 1, createdAt: "" },
  entries: [{ id: "mine", name: "Mine", userId: "me", isComplete: true, pickCount: 1, createdAt: "" }, { id: "other", name: "Other", userId: "rival", isComplete: true, finalizedAt: "2020-01-01", pickCount: 1, totalScore: 2, createdAt: "" }],
  series: ["locked", "open"].map((id) => ({ ...buildPlayoffTemplate({ sport: "nba_cup", seasonYear: 2026 })[0], id, round: "cup_group_play", homeTeamName: "Boston Celtics", awayTeamName: "Atlanta Hawks", status: id === "locked" ? "in_progress" : "scheduled", startsAt: id === "locked" ? "2020-01-01T01:00:00Z" : "2099-01-01T01:00:00Z" })),
  picks: [], rounds: [],
})
beforeEach(() => { vi.clearAllMocks(); mocks.view.mockResolvedValue(view()); mocks.picks.mockResolvedValue([]); mocks.games.mockResolvedValue([]); mocks.injuries.mockResolvedValue({ facts: [], feedStale: true, coverage: { sourceAvailable: true } }) })
describe("private coach access", () => {
  it("rejects nonmembers and foreign entry IDs before reading any rival picks", async () => {
    const outsider = view(); outsider.entries = []; outsider.activeEntry = null
    mocks.view.mockResolvedValueOnce(outsider)
    await expect(loadBracketCoach({ challengeId: "cup", user: { id: "stranger" } })).rejects.toMatchObject({ status: 403 })
    await expect(loadBracketCoach({ challengeId: "cup", entryId: "someone-elses", user: { id: "me" } })).rejects.toMatchObject({ status: 404 })
    expect(mocks.picks).not.toHaveBeenCalled()
  })
  it("scopes rival SQL to this pool and its locked series and refuses unrelated or draft rivals", async () => {
    await loadBracketCoach({ challengeId: "cup", user: { id: "me" } })
    expect(mocks.picks).toHaveBeenCalledWith({ where: { challengeId: "cup", entryId: "other", seriesId: { in: ["locked"] } }, select: { seriesId: true, pickTeamName: true } })
    await expect(loadBracketCoach({ challengeId: "cup", rivalId: "different-pool", user: { id: "me" } })).rejects.toMatchObject({ status: 404 })
    const draft = view(); draft.entries[1].isComplete = false; mocks.view.mockResolvedValueOnce(draft)
    await expect(loadBracketCoach({ challengeId: "cup", rivalId: "other", user: { id: "me" } })).rejects.toMatchObject({ status: 404 })
  })
  it("keeps missing or stale injury coverage explicit and never sends raw provider data", async () => {
    const result = await loadMatchupEvidence({ challengeId: "cup", seriesId: "open", user: { id: "me" } })
    expect(result.evidence.risks.join(" ")).toMatch(/injury coverage is unavailable or stale/)
    expect(result.evidence.home.injuries).toEqual([])
    expect(result.evidence).not.toHaveProperty("raw")
    expect(mocks.injuries).toHaveBeenCalledWith(expect.objectContaining({ sport: "NBA", maxAgeHours: 24, maxReportAgeHours: 24, designationsOnly: true }))
  })
})
