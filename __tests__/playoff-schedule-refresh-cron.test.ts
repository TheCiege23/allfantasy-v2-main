import { readFileSync } from "fs"
import { resolve } from "path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const serviceMocks = vi.hoisted(() => ({
  refreshPlayoffScheduleMetadataForChallenge: vi.fn(),
  syncPlayoffChallengeSeries: vi.fn(),
  prisma: {
    playoffBracketChallenge: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: serviceMocks.prisma }))
vi.mock("@/lib/playoffs/playoffSeriesSyncService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/playoffs/playoffSeriesSyncService")>()
  return {
    ...actual,
    refreshPlayoffScheduleMetadataForChallenge: serviceMocks.refreshPlayoffScheduleMetadataForChallenge,
    syncPlayoffChallengeSeries: serviceMocks.syncPlayoffChallengeSeries,
  }
})

function req(url: string, secret?: string) {
  return new NextRequest(url, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

function mockRefreshResult(challengeId: string, sport: "nba" | "nhl") {
  return {
    ok: true,
    challengeId,
    sport,
    provider: "espn",
    dryRun: false,
    updatedSeries: 1,
    scheduleGamesSeen: 2,
    scheduleGamesMatched: 1,
    liveGamesMatched: 1,
    broadcastFieldsFound: 1,
    venueFieldsFound: 1,
    warnings: [],
    diagnostics: {
      scheduleSupplementProvider: "espn_live",
      scheduleGamesSeen: 2,
      scheduleGamesMatched: 1,
      liveGamesMatched: 1,
      broadcastFieldsFound: 1,
      venueFieldsFound: 1,
      unmatchedScheduleExamples: [],
    },
  }
}

describe("playoff schedule refresh cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "cron-secret")
    serviceMocks.prisma.playoffBracketChallenge.findMany.mockResolvedValue([{ id: "nba-1" }, { id: "nhl-1" }])
    serviceMocks.refreshPlayoffScheduleMetadataForChallenge.mockImplementation(({ challengeId }) =>
      Promise.resolve(mockRefreshResult(challengeId, challengeId.startsWith("nhl") ? "nhl" : "nba"))
    )
  })

  it("rejects missing or invalid auth", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    const missing = await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule"))
    const invalid = await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule", "bad-secret"))

    expect(missing.status).toBe(401)
    expect(invalid.status).toBe(401)
    expect(serviceMocks.prisma.playoffBracketChallenge.findMany).not.toHaveBeenCalled()
  })

  it("supports sport=all and returns structured diagnostics", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=all&provider=espn&dryRun=true", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      job: "playoff_schedule_refresh",
      sport: "all",
      provider: "espn",
      challengeCount: 2,
      updatedSeries: 2,
      scheduleGamesSeen: 4,
      scheduleGamesMatched: 2,
      liveGamesMatched: 2,
      broadcastFieldsFound: 2,
      venueFieldsFound: 2,
      dryRun: true,
      windowDays: 7,
    })
    expect(body.syncedAt).toEqual(expect.any(String))
    expect(serviceMocks.prisma.playoffBracketChallenge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        sport: { in: ["nba", "nhl"] },
        status: { in: ["open", "locked", "live"] },
      }),
    }))
  })

  it("supports sport=nba", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=nba", "cron-secret"))

    expect(serviceMocks.prisma.playoffBracketChallenge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sport: { in: ["nba"] } }),
    }))
  })

  it("supports sport=nhl", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=nhl", "cron-secret"))

    expect(serviceMocks.prisma.playoffBracketChallenge.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ sport: { in: ["nhl"] } }),
    }))
  })

  it("calls schedule refresh only, not series discovery", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=all&windowDays=3", "cron-secret"))

    expect(serviceMocks.refreshPlayoffScheduleMetadataForChallenge).toHaveBeenCalledWith({
      challengeId: "nba-1",
      provider: "espn",
      windowDays: 3,
      dryRun: false,
    })
    expect(serviceMocks.syncPlayoffChallengeSeries).not.toHaveBeenCalled()
  })
})

describe("playoff schedule refresh cron Vercel config", () => {
  it("registers the ESPN schedule refresh during 16:00-19:00 UTC", () => {
    const root = resolve(__dirname, "..")
    const json = JSON.parse(readFileSync(resolve(root, "cron-schedule.json"), "utf8")) as { crons?: Array<{ path: string; schedule: string }> }
    const entry = json.crons?.find((cron) => cron.path === "/api/brackets/playoffs/cron/refresh-schedule?sport=all&provider=espn")

    expect(entry).toEqual({
      path: "/api/brackets/playoffs/cron/refresh-schedule?sport=all&provider=espn",
      schedule: "0 16-19 * * *",
    })
  })
})
