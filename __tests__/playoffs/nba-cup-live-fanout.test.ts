import { beforeEach, describe, expect, it, vi } from "vitest"
const readSnapshot = vi.hoisted(() => vi.fn())
const sync = vi.hoisted(() => vi.fn())
const windowOpen = vi.hoisted(() => vi.fn())
vi.mock("@/app/api/cron/_auth", () => ({ requireCronAuth: () => true }))
vi.mock("@/lib/production-health/syncJobRunTelemetry", () => ({
  withSyncJobRun: async (_meta: unknown, work: () => Promise<unknown>) => work(),
}))
vi.mock("@/lib/playoffs/nbaCupCache", () => ({ readNbaCupSnapshot: readSnapshot }))
vi.mock("@/lib/playoffs/nbaCupTournament", () => ({ nbaCupLiveWindowOpen: windowOpen }))
vi.mock("@/lib/playoffs/syncNbaCupTournament", () => ({ syncNbaCupTournament: sync }))
import { GET } from "@/app/api/cron/nba-cup-live/route"

beforeEach(() => {
  vi.clearAllMocks()
  windowOpen.mockReturnValue(false)
  sync.mockResolvedValue({ applied: true, gamesPublished: 1, poolsUpdated: 1, failures: [] })
})

describe("NBA Cup live catch-up", () => {
  it("drains a pending fan-out even after every game is final", async () => {
    readSnapshot.mockResolvedValue({ games: [], fanout: { eventIds: ["game-1"], cursor: "pool-099", restart: false } })
    const response = await GET({} as never)
    expect(response.status).toBe(200)
    expect(sync).toHaveBeenCalledWith(expect.objectContaining({ apply: true, liveOnly: true }))
  })

  it("stays idle outside the live window when no fan-out is pending", async () => {
    readSnapshot.mockResolvedValue({ games: [], fanout: null })
    const response = await GET({} as never)
    expect(response.status).toBe(200)
    expect(sync).not.toHaveBeenCalled()
  })
})
