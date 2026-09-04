import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMock = vi.hoisted(() => ({
  playerGameLogCache: {
    count: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  playerIdentityMap: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  providerSyncState: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  redraftRoster: {
    findMany: vi.fn(),
  },
  redraftRosterPlayer: {
    findMany: vi.fn(),
  },
  redraftSeason: {
    findFirst: vi.fn(),
  },
  sportsDataCache: {
    findMany: vi.fn(),
  },
  sportsPlayer: {
    findFirst: vi.fn(),
  },
  sportsTeam: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  syncJobRun: {
    count: vi.fn(),
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

const rateLimitManagerMock = vi.hoisted(() => ({
  canCall: vi.fn(),
  recordCall: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }))
vi.mock("@/lib/workers/rate-limit-manager", () => ({ rateLimitManager: rateLimitManagerMock }))

describe("PlayerGameLogImportService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rateLimitManagerMock.canCall.mockResolvedValue(true)
    rateLimitManagerMock.recordCall.mockResolvedValue(undefined)
    prismaMock.playerGameLogCache.count.mockResolvedValue(0)
    prismaMock.playerGameLogCache.findFirst.mockResolvedValue(null)
    prismaMock.playerGameLogCache.findMany.mockResolvedValue([])
    prismaMock.playerGameLogCache.upsert.mockResolvedValue({})
    prismaMock.playerIdentityMap.findFirst.mockResolvedValue({
      id: "identity-1",
      sleeperId: "p-1",
      canonicalName: "Player One",
      currentTeam: "KC",
    })
    prismaMock.playerIdentityMap.findMany.mockResolvedValue([])
    prismaMock.providerSyncState.findMany.mockResolvedValue([])
    prismaMock.providerSyncState.upsert.mockResolvedValue({})
    prismaMock.sportsDataCache.findMany.mockResolvedValue([])
    prismaMock.sportsPlayer.findFirst.mockResolvedValue(null)
    prismaMock.sportsTeam.findFirst.mockResolvedValue({ id: "team-1", shortName: "KC", name: "Kansas City" })
    prismaMock.sportsTeam.findMany.mockResolvedValue([{ id: "team-1", shortName: "KC", name: "Kansas City" }])
    prismaMock.syncJobRun.count.mockResolvedValue(0)
    prismaMock.syncJobRun.create.mockResolvedValue({ id: "sync-1" })
    prismaMock.syncJobRun.findUnique.mockResolvedValue({ startedAt: new Date("2026-09-01T00:00:00.000Z") })
    prismaMock.syncJobRun.update.mockResolvedValue({})
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          "1": {
            pass_yd: 250,
            pass_td: 2,
            rec: 1,
            week: 1,
          },
        }),
      })),
    )
  })

  it("imports NFL Sleeper game logs into PlayerGameLogCache and preserves raw payloads", async () => {
    const { importPlayerGameLogs } = await import("@/lib/sports-reporting/PlayerGameLogImportService")

    const result = await importPlayerGameLogs({
      sport: "NFL",
      provider: "sleeper",
      season: "2026",
      weeks: [1],
      playerIds: ["p-1"],
    })

    expect(result).toMatchObject({
      ok: true,
      provider: "sleeper",
      sport: "NFL",
      rawRowsRead: 1,
      importedCount: 1,
    })
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://api.sleeper.com/stats/nfl/player/p-1"),
      expect.objectContaining({ cache: "no-store" }),
    )
    expect(prismaMock.playerGameLogCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          uniq_player_game_log_cache: {
            playerId: "p-1",
            sport: "NFL",
            season: "2026",
            seasonType: "regular",
          },
        },
        create: expect.objectContaining({
          payload: expect.objectContaining({
            gameLogs: [
              expect.objectContaining({
                week: 1,
                sourceProvider: "sleeper",
                canonicalIdentityId: "identity-1",
                stats: expect.objectContaining({ pass_yd: 250, pass_td: 2 }),
                raw: expect.objectContaining({ pass_yd: 250 }),
              }),
            ],
          }),
        }),
      }),
    )
  })

  it("merges game logs idempotently and detects duplicate incoming rows", async () => {
    const { mergeGameLogPayload } = await import("@/lib/sports-reporting/PlayerGameLogImportService")
    const row = {
      week: 1,
      gameId: "g-1",
      team: "KC",
      opponent: "LV",
      playedAt: null,
      status: null,
      sourceProvider: "sleeper" as const,
      providerPlayerId: "p-1",
      canonicalIdentityId: "identity-1",
      stats: { pass_yd: 250 },
      raw: { week: 1, pass_yd: 250 },
    }

    const merged = mergeGameLogPayload({
      existingPayload: { gameLogs: [row] },
      incomingRows: [row, row],
      provider: "sleeper",
      sport: "NFL",
      season: "2026",
      seasonType: "regular",
      importedAt: new Date("2026-09-01T00:00:00.000Z"),
    })

    expect(merged.imported).toBe(0)
    expect(merged.updated).toBe(0)
    expect(merged.duplicates).toBe(1)
    expect(merged.unchanged).toBe(1)
    expect((merged.payload.gameLogs as unknown[])).toHaveLength(1)
  })

  it("reports PlayerGameLogCache health from cached rows only", async () => {
    prismaMock.playerGameLogCache.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
    prismaMock.playerGameLogCache.findFirst.mockResolvedValue({ syncedAt: new Date("2026-09-01T00:00:00.000Z") })
    prismaMock.playerGameLogCache.findMany
      .mockResolvedValueOnce([
        {
          payload: {
            gameLogs: [
              {
                week: 1,
                gameId: "g-1",
                sourceProvider: "sleeper",
                providerPlayerId: "p-1",
                stats: { pass_yd: 250 },
                raw: {},
              },
            ],
          },
        },
      ])
      .mockResolvedValueOnce([{ playerId: "p-1" }])
    prismaMock.providerSyncState.findMany.mockResolvedValue([
      {
        provider: "sleeper",
        lastSuccessAt: new Date("2026-09-01T00:00:00.000Z"),
        lastErrorAt: null,
        lastError: null,
      },
    ])

    const { getPlayerGameLogHealthDashboard } = await import("@/lib/sports-reporting/PlayerGameLogImportService")
    const health = await getPlayerGameLogHealthDashboard(["NFL"])

    expect(health.rows[0]).toMatchObject({
      sport: "NFL",
      totalCacheRows: 1,
      sampledGameLogs: 1,
      latestWeekImported: 1,
      staleRecords: 1,
      providerFreshness: [expect.objectContaining({ provider: "sleeper" })],
    })
  })
})
