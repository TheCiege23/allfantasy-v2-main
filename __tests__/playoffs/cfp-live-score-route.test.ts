import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), load: vi.fn(), resolve: vi.fn() }))
vi.mock("@/lib/prisma", () => ({ prisma: { sportsGame: { findMany: mocks.findMany } } }))
vi.mock("@/lib/sport-teams/collegeTeamIndexStore", () => ({ loadCollegeTeamIndex: mocks.load }))
vi.mock("@/lib/sport-teams/collegeTeamIdentity", () => ({ resolveCollegeTeam: mocks.resolve }))
import { GET } from "@/app/api/brackets/cfp/live-scores/route"

describe("CFP public live score feed", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.load.mockResolvedValue({}); mocks.resolve.mockImplementation((name: string) => ({ school: name })) })
  it("reads fresh ESPN live games and preserves zero scores", async () => {
    const at = new Date(Date.now() - 60_000)
    mocks.findMany.mockResolvedValue([{ homeTeam: "Oregon", awayTeam: "Georgia", homeScore: 0, awayScore: 7, startTime: at, fetchedAt: at }])
    const result = await GET()
    expect((await result.json()).scores).toEqual([{ home: "Oregon", away: "Georgia", homeScore: 0, awayScore: 7, startsAt: at.toISOString(), fetchedAt: at.toISOString() }])
    expect(mocks.findMany.mock.calls[0][0].where).toMatchObject({ sport: "NCAAF", source: "espn", status: "in_progress" })
    expect(result.headers.get("Cache-Control")).toBe("no-store")
  })
  it("does not guess unknown teams or missing scores", async () => {
    const at = new Date()
    mocks.resolve.mockReturnValue(null)
    mocks.findMany.mockResolvedValue([{ homeTeam: "unknown", awayTeam: "Georgia", homeScore: null, awayScore: 7, startTime: at, fetchedAt: at }])
    expect((await (await GET()).json()).scores).toEqual([])
  })
  it("fails closed when the score store is unavailable", async () => {
    mocks.findMany.mockRejectedValue(new Error("database unavailable"))
    expect((await GET()).status).toBe(503)
  })
})
