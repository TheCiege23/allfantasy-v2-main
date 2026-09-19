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

  it("calls schedule refresh with the requested window", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=all&windowDays=3", "cron-secret"))

    expect(serviceMocks.refreshPlayoffScheduleMetadataForChallenge).toHaveBeenCalledWith({
      challengeId: "nba-1",
      provider: "espn",
      windowDays: 3,
      dryRun: false,
    })
  })

  /*
   * This replaces an assertion that `syncPlayoffChallengeSeries` was never
   * called at all. Its INTENT — "this cron must not do bracket discovery" — is
   * kept and sharpened: the danger was never calling the service, it was
   * calling it in a mode that rewrites team names on a bracket people have
   * already picked. So assert the mode, which is the thing that matters.
   */
  it("advances results, and only ever in results_only mode", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=all", "cron-secret"))

    expect(serviceMocks.syncPlayoffChallengeSeries).toHaveBeenCalledTimes(2)
    for (const call of serviceMocks.syncPlayoffChallengeSeries.mock.calls) {
      expect(call[0]).toMatchObject({ mode: "results_only" })
      expect(call[0].mode).not.toBe("official_bracket")
    }
  })

  it("never writes results on a dry run", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    const response = await GET(
      req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=all&dryRun=true", "cron-secret"),
    )
    const body = await response.json()

    // syncPlayoffChallengeSeries has no dryRun parameter and always writes, so
    // the caller is the only thing standing between a dry run and a real one.
    expect(serviceMocks.syncPlayoffChallengeSeries).not.toHaveBeenCalled()
    expect(body.resultsRan).toBe(false)
  })

  it("runs one phase only when asked", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?job=schedule", "cron-secret"))
    expect(serviceMocks.refreshPlayoffScheduleMetadataForChallenge).toHaveBeenCalled()
    expect(serviceMocks.syncPlayoffChallengeSeries).not.toHaveBeenCalled()

    vi.clearAllMocks()
    serviceMocks.prisma.playoffBracketChallenge.findMany.mockResolvedValue([{ id: "nba-1" }])

    await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?job=results", "cron-secret"))
    expect(serviceMocks.refreshPlayoffScheduleMetadataForChallenge).not.toHaveBeenCalled()
    expect(serviceMocks.syncPlayoffChallengeSeries).toHaveBeenCalledTimes(1)
  })

  it("isolates a failing challenge instead of losing the rest of the sweep", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    serviceMocks.syncPlayoffChallengeSeries.mockImplementation(({ challengeId }: { challengeId: string }) =>
      challengeId === "nba-1"
        ? Promise.reject(new Error("provider exploded"))
        : Promise.resolve({ seriesUpdated: 2, winnersUpdated: 1, warnings: [] }),
    )

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=all", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    // The healthy challenge still advanced.
    expect(body.resultsChallengesSynced).toBe(1)
    expect(body.winnersUpdated).toBe(1)
    expect(body.resultsErrors).toHaveLength(1)
    expect(body.resultsErrors[0]).toContain("nba-1")
  })

  /*
   * A stable order plus a time budget starves the tail forever, and silently:
   * the job reports success while the same pools never advance. The rotation
   * is what prevents that, so assert it actually moves.
   */
  it("rotates which challenge the results phase starts on", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")
    serviceMocks.prisma.playoffBracketChallenge.findMany.mockResolvedValue([
      { id: "a" }, { id: "b" }, { id: "c" },
    ])
    serviceMocks.syncPlayoffChallengeSeries.mockResolvedValue({ seriesUpdated: 0, winnersUpdated: 0, warnings: [] })

    const firstIdAtHour = async (hour: number) => {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 5, hour, 0, 0)))
      serviceMocks.syncPlayoffChallengeSeries.mockClear()
      await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?job=results", "cron-secret"))
      return serviceMocks.syncPlayoffChallengeSeries.mock.calls[0][0].challengeId
    }

    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      // Three challenges, so the start walks a→b→c across consecutive fires.
      expect(await firstIdAtHour(16)).toBe("b")
      expect(await firstIdAtHour(17)).toBe("c")
      expect(await firstIdAtHour(18)).toBe("a")
    } finally {
      vi.useRealTimers()
    }

    // Every challenge is still served on every fire when the budget allows.
    expect(serviceMocks.syncPlayoffChallengeSeries).toHaveBeenCalledTimes(3)
  })

  /*
   * The selector bug this sweep shipped with: `status` is never advanced past
   * "open", so matching on it alone kept 26 finished 2026 pools in the sweep
   * and wrote September preseason games onto April playoff series. The window
   * arms are what stop that, so assert they are present.
   */
  it("bounds the sweep to brackets that are actually current", async () => {
    const { GET } = await import("@/app/api/brackets/playoffs/cron/refresh-schedule/route")

    await GET(req("https://www.allfantasy.ai/api/brackets/playoffs/cron/refresh-schedule?sport=all", "cron-secret"))

    const where = serviceMocks.prisma.playoffBracketChallenge.findMany.mock.calls[0][0].where
    expect(where.OR).toHaveLength(2)

    const [recentStart, neverScheduled] = where.OR
    const cutoff = recentStart.series.some.startsAt.gte as Date
    expect(cutoff).toBeInstanceOf(Date)

    // 60 days back, give or take the clock ticking during the test.
    const daysBack = (Date.now() - cutoff.getTime()) / 86_400_000
    expect(daysBack).toBeGreaterThan(59)
    expect(daysBack).toBeLessThan(61)

    // The "created but never scheduled" arm must be freshness-bounded too, or
    // a pool whose series never got dates is swept forever.
    expect(neverScheduled.AND[0]).toEqual({ series: { every: { startsAt: null } } })
    expect(neverScheduled.AND[1].updatedAt.gte).toBeInstanceOf(Date)
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
