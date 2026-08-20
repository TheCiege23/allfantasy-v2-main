import { beforeEach, describe, expect, it, vi } from "vitest"

const savePlayoffBracketPickMock = vi.hoisted(() => vi.fn())
const getPlayoffBracketViewMock = vi.hoisted(() => vi.fn())
const requireWorldCupApiUserMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/playoffs/playoffService", () => ({
  savePlayoffBracketPick: savePlayoffBracketPickMock,
  getPlayoffBracketView: getPlayoffBracketViewMock,
}))

vi.mock("@/app/api/brackets/playoffs/_utils", async () => {
  const actual = await vi.importActual<typeof import("@/app/api/brackets/playoffs/_utils")>(
    "@/app/api/brackets/playoffs/_utils"
  )
  return {
    ...actual,
    requireWorldCupApiUser: requireWorldCupApiUserMock,
  }
})

describe("playoff picks route — active entry scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireWorldCupApiUserMock.mockResolvedValue({
      ok: true,
      user: { id: "user-1", email: "u@example.com", name: "U" },
    })
    savePlayoffBracketPickMock.mockResolvedValue(undefined)
    getPlayoffBracketViewMock.mockResolvedValue({
      viewerUserId: "user-1",
      challenge: { id: "ch-1", sport: "nhl", name: "Pool" },
      activeEntry: { id: "entry-b", userId: "user-1", pickCount: 2, name: "B", isComplete: false, createdAt: "" },
      entries: [],
      picks: [],
      series: [],
      participants: [],
      rounds: [],
    })
  })

  it("calls getPlayoffBracketView with requestedEntryId after save", async () => {
    const { POST } = await import("@/app/api/brackets/playoffs/[challengeId]/entries/[entryId]/picks/route")

    const request = new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seriesId: "s1", pickTeamName: "Team A" }),
    })

    const response = await POST(request, { params: { challengeId: "ch-1", entryId: "entry-b" } })
    expect(response.status).toBe(200)

    expect(savePlayoffBracketPickMock).toHaveBeenCalledTimes(1)
    expect(getPlayoffBracketViewMock).toHaveBeenCalledWith({
      challengeId: "ch-1",
      user: { id: "user-1", email: "u@example.com", name: "U" },
      requestedEntryId: "entry-b",
    })
    const payload = await response.json()
    expect(payload.view.activeEntry?.id).toBe("entry-b")
  })
})
