import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  apiCallLogRecord: {
    groupBy: vi.fn(),
  },
  apiRateLimitRecord: {
    findMany: vi.fn(),
  },
  providerSyncState: {
    findMany: vi.fn(),
  },
  sportsTeam: {
    groupBy: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  sportsPlayer: {
    groupBy: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  gameSchedule: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  sportsGame: {
    groupBy: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  sportsInjury: {
    groupBy: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  injuryReportRecord: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  sportsNews: {
    groupBy: vi.fn(),
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  playerNewsRecord: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  playerSeasonStats: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  sportsDataCache: {
    count: vi.fn(),
  },
  worldCupTeam: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  worldCupOfficialFixture: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  worldCupOfficialGroupStanding: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  worldCupSyncLog: {
    count: vi.fn(),
  },
}))

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}))

vi.mock("@/lib/world-cup/live-providers/worldCupLiveProviderRegistry", () => ({
  getWorldCupLiveProviderChain: vi.fn(() => ["api_sports", "thesportsdb", "manual"]),
}))

const ENV_KEYS = [
  "WORLD_CUP_DATA_PROVIDER",
  "API_SPORTS_KEY",
  "API_FOOTBALL_KEY",
  "APISPORTS_FOOTBALL_KEY",
  "RAPIDAPI_KEY",
  "API_FOOTBALL_WORLD_CUP_LEAGUE_ID",
  "WORLD_CUP_CRON_SECRET",
  "SPORTSDATA_API_KEY",
  "ROLLING_INSIGHTS_API_KEY",
  "ROLLING_INSIGHTS_CLIENT_ID",
  "ROLLING_INSIGHTS_CLIENT_SECRET",
  "CLEARSPORTS_API_KEY",
  "CLEARSPORTS_API_BASE",
  "THESPORTSDB_API_KEY",
  "THESPORTSDB_NCAAF_LEAGUE_ID",
  "THESPORTSDB_NCAAM_LEAGUE_ID",
  "THESPORTSDB_SOCCER_LEAGUE_ID",
  "CFBD_API_KEY",
  "CFBD_KEY",
  "NEWS_API_KEY",
  "NEWSAPI_KEY",
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "KLIPY_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_VERIFY_SERVICE_SID",
]

function resetEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

function primeEmptyDb() {
  prismaMock.apiCallLogRecord.groupBy.mockResolvedValue([])
  prismaMock.apiRateLimitRecord.findMany.mockResolvedValue([])
  prismaMock.providerSyncState.findMany.mockResolvedValue([])
  prismaMock.sportsTeam.groupBy.mockResolvedValue([])
  prismaMock.sportsTeam.count.mockResolvedValue(0)
  prismaMock.sportsTeam.findFirst.mockResolvedValue(null)
  prismaMock.sportsPlayer.groupBy.mockResolvedValue([])
  prismaMock.sportsPlayer.count.mockResolvedValue(0)
  prismaMock.sportsPlayer.findFirst.mockResolvedValue(null)
  prismaMock.gameSchedule.count.mockResolvedValue(0)
  prismaMock.gameSchedule.findFirst.mockResolvedValue(null)
  prismaMock.sportsGame.groupBy.mockResolvedValue([])
  prismaMock.sportsGame.count.mockResolvedValue(0)
  prismaMock.sportsGame.findFirst.mockResolvedValue(null)
  prismaMock.sportsInjury.groupBy.mockResolvedValue([])
  prismaMock.sportsInjury.count.mockResolvedValue(0)
  prismaMock.sportsInjury.findFirst.mockResolvedValue(null)
  prismaMock.injuryReportRecord.count.mockResolvedValue(0)
  prismaMock.injuryReportRecord.findFirst.mockResolvedValue(null)
  prismaMock.sportsNews.groupBy.mockResolvedValue([])
  prismaMock.sportsNews.count.mockResolvedValue(0)
  prismaMock.sportsNews.findFirst.mockResolvedValue(null)
  prismaMock.playerNewsRecord.count.mockResolvedValue(0)
  prismaMock.playerNewsRecord.findFirst.mockResolvedValue(null)
  prismaMock.playerSeasonStats.count.mockResolvedValue(0)
  prismaMock.playerSeasonStats.findFirst.mockResolvedValue(null)
  prismaMock.sportsDataCache.count.mockResolvedValue(0)
  prismaMock.worldCupTeam.count.mockResolvedValue(0)
  prismaMock.worldCupTeam.findFirst.mockResolvedValue(null)
  prismaMock.worldCupOfficialFixture.count.mockResolvedValue(0)
  prismaMock.worldCupOfficialFixture.findFirst.mockResolvedValue(null)
  prismaMock.worldCupOfficialGroupStanding.count.mockResolvedValue(0)
  prismaMock.worldCupOfficialGroupStanding.findFirst.mockResolvedValue(null)
  prismaMock.worldCupSyncLog.count.mockResolvedValue(0)
}

describe("AdminProviderHealthService", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    resetEnv()
    primeEmptyDb()
  })

  it("summarizes provider readiness without calling external APIs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const { getAdminProviderHealthRows } = await import("@/lib/admin-dashboard/AdminProviderHealthService")

    const rows = await getAdminProviderHealthRows()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(rows.find((row) => row.id === "api_football_world_cup")).toMatchObject({
      status: "missing_env",
      configured: false,
    })
    expect(rows.find((row) => row.id === "sportsdata_world_cup")).toMatchObject({
      status: "scaffold_only",
      configured: false,
    })
    expect(rows.find((row) => row.id === "sleeper")).toMatchObject({
      status: "public_fallback",
      configured: true,
    })
    fetchSpy.mockRestore()
  })

  it("reports configured World Cup provider, request telemetry, rate window, and sync errors", async () => {
    process.env.WORLD_CUP_DATA_PROVIDER = "apifootball"
    process.env.API_SPORTS_KEY = "test-key"
    process.env.API_FOOTBALL_WORLD_CUP_LEAGUE_ID = "1"
    process.env.WORLD_CUP_CRON_SECRET = "cron-secret"

    const syncAt = new Date("2026-06-04T12:00:00.000Z")
    prismaMock.apiCallLogRecord.groupBy.mockResolvedValue([
      {
        provider: "api_sports",
        _count: { _all: 3 },
        _avg: { latencyMs: 123.4 },
      },
    ])
    prismaMock.apiRateLimitRecord.findMany.mockResolvedValue([
      {
        provider: "api_sports",
        callsMade: 3,
        callsLimit: 7500,
        windowEnd: syncAt,
      },
    ])
    prismaMock.providerSyncState.findMany.mockResolvedValue([
      {
        provider: "api_sports",
        lastCompletedAt: syncAt,
        lastSuccessAt: syncAt,
        lastErrorAt: null,
        lastError: null,
        recordsImported: 12,
        recordsUpdated: 4,
        recordsSkipped: 0,
        updatedAt: syncAt,
      },
    ])
    prismaMock.worldCupTeam.count.mockResolvedValue(48)
    prismaMock.worldCupOfficialFixture.count.mockResolvedValue(104)
    prismaMock.worldCupOfficialGroupStanding.count.mockResolvedValue(48)

    const { getAdminProviderHealthRows } = await import("@/lib/admin-dashboard/AdminProviderHealthService")
    const rows = await getAdminProviderHealthRows()
    const worldCup = rows.find((row) => row.id === "api_football_world_cup")

    expect(worldCup).toMatchObject({
      status: "configured",
      configured: true,
      requestCount24h: 3,
      avgLatencyMs24h: 123,
      rateLimit: "3/7500 calls this window",
      importedRows: 200,
      lastSyncAt: syncAt.toISOString(),
    })
  })

  it("THE ACTUAL BUG: a configured provider whose last sync attempt errored escalates to configured_failing", async () => {
    // Same env as the "reports configured World Cup provider" case above, but the sync row's
    // most recent attempt errored instead of succeeding. Before this fix, statusFromConfig was
    // always called with no knowledge of syncSummary (only providerRow looks that up), so this
    // stayed "configured" forever and PROVIDER_FAULT.configured_failing could never fire.
    process.env.WORLD_CUP_DATA_PROVIDER = "apifootball"
    process.env.API_SPORTS_KEY = "test-key"
    process.env.API_FOOTBALL_WORLD_CUP_LEAGUE_ID = "1"
    process.env.WORLD_CUP_CRON_SECRET = "cron-secret"

    const syncAt = new Date("2026-09-03T12:00:00.000Z")
    prismaMock.providerSyncState.findMany.mockResolvedValue([
      {
        provider: "api_sports",
        lastCompletedAt: syncAt,
        lastSuccessAt: null,
        lastErrorAt: syncAt,
        lastError: "401 Unauthorized: API key revoked",
        recordsImported: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        updatedAt: syncAt,
      },
    ])
    prismaMock.worldCupTeam.count.mockResolvedValue(48)
    prismaMock.worldCupOfficialFixture.count.mockResolvedValue(104)
    prismaMock.worldCupOfficialGroupStanding.count.mockResolvedValue(48)

    const { getAdminProviderHealthRows } = await import("@/lib/admin-dashboard/AdminProviderHealthService")
    const rows = await getAdminProviderHealthRows()
    const worldCup = rows.find((row) => row.id === "api_football_world_cup")

    expect(worldCup).toMatchObject({
      status: "configured_failing",
      configured: true,
      lastError: "401 Unauthorized: API key revoked",
    })
  })

  it("does not escalate a provider that is not_production_ready even if its sync last errored", async () => {
    // A row with its own more specific fault (here: World Cup configured but not fully
    // production-ready) keeps that status -- a sync-error escalation only applies to a plain
    // "configured" row, so it cannot mask or override a status with its own distinct meaning.
    process.env.WORLD_CUP_DATA_PROVIDER = "apifootball"
    process.env.API_SPORTS_KEY = "test-key"
    // Deliberately omit API_FOOTBALL_WORLD_CUP_LEAGUE_ID / WORLD_CUP_CRON_SECRET so
    // apiFootballWorldCupProductionReady is false while apiFootballWorldCupKeyConfigured is true.

    const syncAt = new Date("2026-09-03T12:00:00.000Z")
    prismaMock.providerSyncState.findMany.mockResolvedValue([
      {
        provider: "api_sports",
        lastCompletedAt: syncAt,
        lastSuccessAt: null,
        lastErrorAt: syncAt,
        lastError: "some stale error",
        recordsImported: 0,
        recordsUpdated: 0,
        recordsSkipped: 0,
        updatedAt: syncAt,
      },
    ])

    const { getAdminProviderHealthRows } = await import("@/lib/admin-dashboard/AdminProviderHealthService")
    const rows = await getAdminProviderHealthRows()
    const worldCup = rows.find((row) => row.id === "api_football_world_cup")

    expect(worldCup?.status).toBe("not_production_ready")
  })

  it("reports per-sport import reliability from Neon tables without provider calls", async () => {
    process.env.WORLD_CUP_DATA_PROVIDER = "apifootball"
    process.env.API_SPORTS_KEY = "test-key"
    process.env.API_FOOTBALL_WORLD_CUP_LEAGUE_ID = "1"
    process.env.WORLD_CUP_CRON_SECRET = "cron-secret"
    process.env.CFBD_API_KEY = "cfbd-key"
    process.env.NEWS_API_KEY = "news-key"
    process.env.OPENAI_API_KEY = "openai-key"

    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const syncAt = new Date("2026-06-04T12:00:00.000Z")
    prismaMock.worldCupTeam.count.mockResolvedValue(48)
    prismaMock.worldCupOfficialFixture.count.mockResolvedValue(104)
    prismaMock.worldCupOfficialGroupStanding.count.mockResolvedValue(48)
    prismaMock.worldCupTeam.findFirst.mockResolvedValue({ updatedAt: syncAt })
    prismaMock.worldCupOfficialFixture.findFirst.mockResolvedValue({ updatedAt: syncAt })
    prismaMock.worldCupOfficialGroupStanding.findFirst.mockResolvedValue({ updatedAt: syncAt })
    prismaMock.sportsTeam.count.mockImplementation(async ({ where }: { where?: { sport?: string } }) =>
      where?.sport === "NCAAF" ? 134 : 0
    )
    prismaMock.gameSchedule.count.mockImplementation(async ({ where }: { where?: { sportType?: string } }) =>
      where?.sportType === "NCAAF" ? 900 : 0
    )
    prismaMock.sportsNews.count.mockImplementation(async ({ where }: { where?: { sport?: string } }) =>
      where?.sport === "NCAAF" ? 12 : 0
    )

    const { getAdminPerSportDataReliabilityRows } = await import("@/lib/admin-dashboard/AdminProviderHealthService")
    const rows = await getAdminPerSportDataReliabilityRows()

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(rows.map((row) => row.id)).toEqual([
      "world-cup",
      "nfl",
      "mlb",
      "nba",
      "nhl",
      "ncaaf",
      "ncaab",
      "soccer",
    ])
    expect(rows.find((row) => row.id === "world-cup")).toMatchObject({
      counts: {
        teams: 48,
        schedules: 104,
        standings: 48,
      },
      configuredProviders: expect.arrayContaining(["API-Football", "OpenAI"]),
    })
    expect(rows.find((row) => row.id === "ncaaf")).toMatchObject({
      counts: {
        teams: 134,
        schedules: 900,
        news: 12,
      },
      configuredProviders: expect.arrayContaining(["CFBD", "NewsAPI", "OpenAI"]),
    })
    fetchSpy.mockRestore()
  })
})
