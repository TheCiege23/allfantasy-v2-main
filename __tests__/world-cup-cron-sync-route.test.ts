import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const serviceMocks = vi.hoisted(() => ({
  syncWorldCupTeams: vi.fn(),
  syncWorldCupFixtures: vi.fn(),
  syncWorldCupLiveScoresBatch: vi.fn(),
  syncWorldCupProviderGroupStandings: vi.fn(),
  recalculateWorldCupChallenge: vi.fn(),
  prisma: {
    worldCupBracketChallenge: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/prisma", () => ({ prisma: serviceMocks.prisma }))
vi.mock("@/lib/world-cup", () => ({
  syncWorldCupTeams: serviceMocks.syncWorldCupTeams,
  syncWorldCupFixtures: serviceMocks.syncWorldCupFixtures,
  syncWorldCupLiveScoresBatch: serviceMocks.syncWorldCupLiveScoresBatch,
  syncWorldCupProviderGroupStandings: serviceMocks.syncWorldCupProviderGroupStandings,
  recalculateWorldCupChallenge: serviceMocks.recalculateWorldCupChallenge,
}))

function req(url: string, secret?: string) {
  return new NextRequest(url, {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

describe("World Cup cron sync route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("WORLD_CUP_CRON_SECRET", "cron-secret")
    vi.stubEnv("API_SPORTS_KEY", "api-key")
    serviceMocks.prisma.worldCupBracketChallenge.findMany.mockResolvedValue([{ id: "c1" }])
    serviceMocks.syncWorldCupLiveScoresBatch.mockResolvedValue([{
      challengeId: "c1",
      result: { updated: 1, skipped: 0, finalMatches: 0, warnings: [], recalculated: true },
    }])
    serviceMocks.syncWorldCupTeams.mockResolvedValue({ created: 0, updated: 0, skipped: 0, warnings: [] })
  })

  it("rejects Vercel GET cron calls without a secret", async () => {
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=live"))

    expect(response.status).toBe(401)
  })

  it("runs GET live sync with cron secret and query params", async () => {
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=live&provider=apifootball&recalculate=true", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(serviceMocks.syncWorldCupLiveScoresBatch).toHaveBeenCalledWith({
      challengeIds: ["c1"],
      provider: "apifootball",
      seasonYear: 2026,
      dryRun: false,
      recalculate: true,
    })
  })

  it("supports GET teams sync for Vercel cron", async () => {
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=teams&provider=apifootball", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.result.teams).toEqual({ created: 0, updated: 0, skipped: 0, warnings: [] })
    expect(serviceMocks.prisma.worldCupBracketChallenge.findMany).not.toHaveBeenCalled()
    expect(serviceMocks.syncWorldCupTeams).toHaveBeenCalledWith({
      provider: "apifootball",
      seasonYear: 2026,
      dryRun: false,
    })
  })

  it("returns clear JSON when API-Football key is missing", async () => {
    vi.stubEnv("API_SPORTS_KEY", "")
    vi.stubEnv("API_FOOTBALL_KEY", "")
    vi.stubEnv("APISPORTS_FOOTBALL_KEY", "")
    vi.stubEnv("RAPIDAPI_KEY", "")
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=teams&provider=apifootball", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({
      ok: false,
      error: "missing_provider_key",
      job: "teams",
      provider: "apifootball",
      seasonYear: 2026,
    })
    expect(JSON.stringify(body)).not.toContain("api-key")
    expect(serviceMocks.syncWorldCupTeams).not.toHaveBeenCalled()
  })

  it("returns clear JSON when provider fetch fails", async () => {
    serviceMocks.syncWorldCupTeams.mockRejectedValue(new Error("API-Football teams failed: 403 Forbidden"))
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=teams&provider=apifootball", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({
      ok: false,
      error: "provider_fetch_failed",
      job: "teams",
      provider: "apifootball",
    })
    expect(body.message).toContain("API-Football teams failed")
  })

  it("returns clear JSON when sync/database work fails", async () => {
    serviceMocks.syncWorldCupTeams.mockRejectedValue(new Error("PrismaClientKnownRequestError: unique constraint failed"))
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=teams&provider=apifootball", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({
      ok: false,
      error: "database_write_failed",
      job: "teams",
      provider: "apifootball",
    })
  })

  it("recalculate returns 200 with per-challenge ok:true and leaderboard counts on success", async () => {
    serviceMocks.prisma.worldCupBracketChallenge.findMany.mockResolvedValue([{ id: "c1" }, { id: "c2" }])
    serviceMocks.recalculateWorldCupChallenge
      .mockResolvedValueOnce([{ entryId: "e1" }, { entryId: "e2" }])
      .mockResolvedValueOnce([])
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=recalculate", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.result.recalculated).toEqual([
      { challengeId: "c1", ok: true, leaderboardCount: 2 },
      { challengeId: "c2", ok: true, leaderboardCount: 0 },
    ])
    expect(body.result.recalculateSummary).toEqual({ attempted: 2, succeeded: 2, failed: 0 })
    expect(serviceMocks.recalculateWorldCupChallenge).toHaveBeenCalledTimes(2)
  })

  it("recalculate does NOT fail the whole cron when one challenge throws (200 + per-challenge failure detail)", async () => {
    serviceMocks.prisma.worldCupBracketChallenge.findMany.mockResolvedValue([{ id: "good" }, { id: "bad" }])
    serviceMocks.recalculateWorldCupChallenge.mockImplementation(async (id) => {
      if (id === "bad") throw new Error("PrismaClientKnownRequestError: foreign key constraint failed on entry")
      return [{ entryId: "e1" }]
    })
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=recalculate", "cron-secret"))
    const body = await response.json()

    // The scheduled workflow uses `curl --fail`; a partial per-challenge failure must stay 2xx.
    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    const results = body.result.recalculated as Array<Record<string, unknown>>
    expect(results).toContainEqual({ challengeId: "good", ok: true, leaderboardCount: 1 })
    const bad = results.find((r) => r.challengeId === "bad") as Record<string, unknown>
    expect(bad.ok).toBe(false)
    expect(bad.error).toBe("database_write_failed")
    expect(String(bad.message)).toContain("foreign key constraint failed")
    expect(body.result.recalculateSummary).toEqual({ attempted: 2, succeeded: 1, failed: 1 })
  })

  it("recalculate sanitizes secrets in per-challenge error messages", async () => {
    serviceMocks.prisma.worldCupBracketChallenge.findMany.mockResolvedValue([{ id: "leaky" }])
    serviceMocks.recalculateWorldCupChallenge.mockRejectedValue(
      new Error("fetch failed https://api.example.com/x?key=SUPERSECRET123 network error")
    )
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=recalculate", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(JSON.stringify(body)).not.toContain("SUPERSECRET123")
    expect(JSON.stringify(body)).toContain("[redacted]")
  })

  it("recalculate still returns a real 500 when loading challenge IDs fails (route-level DB failure)", async () => {
    serviceMocks.prisma.worldCupBracketChallenge.findMany.mockRejectedValue(new Error("prisma: connection timed out"))
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=recalculate", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.error).toBe("database_write_failed")
    expect(serviceMocks.recalculateWorldCupChallenge).not.toHaveBeenCalled()
  })

  it("recalculate honors dryRun without invoking the recalculation service", async () => {
    serviceMocks.prisma.worldCupBracketChallenge.findMany.mockResolvedValue([{ id: "c1" }])
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=recalculate&dryRun=true", "cron-secret"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.result.recalculated).toEqual([{ challengeId: "c1", ok: true, leaderboardCount: null }])
    expect(body.result.recalculateSummary).toEqual({ attempted: 1, succeeded: 1, failed: 0 })
    expect(serviceMocks.recalculateWorldCupChallenge).not.toHaveBeenCalled()
  })

  it("rejects invalid job input with 400 (unchanged) and never runs recalculation", async () => {
    const { GET } = await import("@/app/api/brackets/world-cup/cron/sync/route")

    const response = await GET(req("https://www.allfantasy.ai/api/brackets/world-cup/cron/sync?job=bogus", "cron-secret"))

    expect(response.status).toBe(400)
    expect(serviceMocks.recalculateWorldCupChallenge).not.toHaveBeenCalled()
  })
})
