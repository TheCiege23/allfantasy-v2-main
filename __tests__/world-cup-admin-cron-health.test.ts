import { beforeEach, describe, expect, it, vi } from "vitest"

const requireCronAuthMock = vi.hoisted(() => vi.fn())
const cronSyncAllMock = vi.hoisted(() => vi.fn())
const isAuthorizedRequestMock = vi.hoisted(() => vi.fn())
const getWorldCupApiUserMock = vi.hoisted(() => vi.fn())
const getWorldCupAdminStateMock = vi.hoisted(() => vi.fn())
const syncWorldCupChallengeMock = vi.hoisted(() => vi.fn())
const syncAllChallengesMock = vi.hoisted(() => vi.fn())
const recalculateWorldCupChallengeMock = vi.hoisted(() => vi.fn())
const runWorldCupDiagnosticsMock = vi.hoisted(() => vi.fn())
const worldCupSyncLogCreateMock = vi.hoisted(() => vi.fn())
const worldCupChallengeFindManyMock = vi.hoisted(() => vi.fn())
const appUserFindManyMock = vi.hoisted(() => vi.fn())

vi.mock("@/app/api/cron/_auth", () => ({
  requireCronAuth: requireCronAuthMock,
}))

vi.mock("@/lib/world-cup/worldCupSyncService", () => ({
  syncAllOpenWorldCupChallenges: cronSyncAllMock,
}))

vi.mock("@/lib/adminAuth", () => ({
  isAuthorizedRequest: isAuthorizedRequestMock,
}))

vi.mock("@/app/api/brackets/world-cup/_utils", () => ({
  assertWorldCupManager: vi.fn(),
  getWorldCupApiUser: getWorldCupApiUserMock,
  getWorldCupAdminState: getWorldCupAdminStateMock,
  requireWorldCupApiUser: vi.fn(),
  worldCupChallengeParamsSchema: { safeParse: vi.fn() },
  worldCupInviteParamsSchema: { safeParse: vi.fn() },
}))

vi.mock("@/lib/world-cup", () => ({
  createAdditionalWorldCupInvite: vi.fn(),
  createWorldCupBracketChallenge: vi.fn(),
  getWorldCupChallengeByInvite: vi.fn(),
  getWorldCupChallengeView: vi.fn(),
  joinWorldCupChallengeByInvite: vi.fn(),
  recalculateWorldCupChallenge: recalculateWorldCupChallengeMock,
  saveWorldCupPicks: vi.fn(),
  syncAllOpenWorldCupChallenges: syncAllChallengesMock,
  syncWorldCupChallenge: syncWorldCupChallengeMock,
  updateWorldCupChallengeSettings: vi.fn(),
}))

vi.mock("@/lib/world-cup/worldCupDiagnosticsService", () => ({
  runWorldCupDiagnostics: runWorldCupDiagnosticsMock,
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worldCupSyncLog: {
      create: worldCupSyncLogCreateMock,
    },
    worldCupBracketChallenge: {
      findMany: worldCupChallengeFindManyMock,
      findUnique: vi.fn(async () => ({ id: "wc1", status: "open" })),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
    },
    appUser: {
      findMany: appUserFindManyMock,
    },
  },
}))

describe("World Cup cron and admin routes", () => {
  it("uses LEAGUE_CRON_SECRET fallback when preferred secret is blank", async () => {
    const { requireCronAuth } = await vi.importActual<typeof import("@/app/api/cron/_auth")>(
      "@/app/api/cron/_auth"
    )

    const previous = {
      BRACKET_CRON_SECRET: process.env.BRACKET_CRON_SECRET,
      LEAGUE_CRON_SECRET: process.env.LEAGUE_CRON_SECRET,
      CRON_SECRET: process.env.CRON_SECRET,
    }

    try {
      process.env.BRACKET_CRON_SECRET = "   "
      process.env.LEAGUE_CRON_SECRET = "league-fallback-secret"
      process.env.CRON_SECRET = ""

      const req = new Request("http://localhost/api/cron/world-cup-sync", {
        headers: { "x-cron-secret": "league-fallback-secret" },
      })

      expect(requireCronAuth(req as any, "BRACKET_CRON_SECRET")).toBe(true)
    } finally {
      process.env.BRACKET_CRON_SECRET = previous.BRACKET_CRON_SECRET
      process.env.LEAGUE_CRON_SECRET = previous.LEAGUE_CRON_SECRET
      process.env.CRON_SECRET = previous.CRON_SECRET
    }
  })

  it("falls back to CRON_SECRET when preferred and league secrets are blank", async () => {
    const { requireCronAuth } = await vi.importActual<typeof import("@/app/api/cron/_auth")>(
      "@/app/api/cron/_auth"
    )

    const previous = {
      BRACKET_CRON_SECRET: process.env.BRACKET_CRON_SECRET,
      LEAGUE_CRON_SECRET: process.env.LEAGUE_CRON_SECRET,
      CRON_SECRET: process.env.CRON_SECRET,
    }

    try {
      process.env.BRACKET_CRON_SECRET = ""
      process.env.LEAGUE_CRON_SECRET = "   "
      process.env.CRON_SECRET = "cron-global-secret"

      const req = new Request("http://localhost/api/cron/world-cup-sync", {
        headers: { authorization: "Bearer cron-global-secret" },
      })

      expect(requireCronAuth(req as any, "BRACKET_CRON_SECRET")).toBe(true)
    } finally {
      process.env.BRACKET_CRON_SECRET = previous.BRACKET_CRON_SECRET
      process.env.LEAGUE_CRON_SECRET = previous.LEAGUE_CRON_SECRET
      process.env.CRON_SECRET = previous.CRON_SECRET
    }
  })

  it("rejects when all cron secrets are blank", async () => {
    const { requireCronAuth } = await vi.importActual<typeof import("@/app/api/cron/_auth")>(
      "@/app/api/cron/_auth"
    )

    const previous = {
      BRACKET_CRON_SECRET: process.env.BRACKET_CRON_SECRET,
      LEAGUE_CRON_SECRET: process.env.LEAGUE_CRON_SECRET,
      CRON_SECRET: process.env.CRON_SECRET,
      BRACKET_ADMIN_SECRET: process.env.BRACKET_ADMIN_SECRET,
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      IMPORT_WORKER_SECRET: process.env.IMPORT_WORKER_SECRET,
    }

    try {
      process.env.BRACKET_CRON_SECRET = "  "
      process.env.LEAGUE_CRON_SECRET = " "
      process.env.CRON_SECRET = ""
      process.env.BRACKET_ADMIN_SECRET = ""
      process.env.ADMIN_PASSWORD = ""
      process.env.IMPORT_WORKER_SECRET = ""

      const req = new Request("http://localhost/api/cron/world-cup-sync", {
        headers: { "x-cron-secret": "anything" },
      })

      expect(requireCronAuth(req as any, "BRACKET_CRON_SECRET")).toBe(false)
    } finally {
      process.env.BRACKET_CRON_SECRET = previous.BRACKET_CRON_SECRET
      process.env.LEAGUE_CRON_SECRET = previous.LEAGUE_CRON_SECRET
      process.env.CRON_SECRET = previous.CRON_SECRET
      process.env.BRACKET_ADMIN_SECRET = previous.BRACKET_ADMIN_SECRET
      process.env.ADMIN_PASSWORD = previous.ADMIN_PASSWORD
      process.env.IMPORT_WORKER_SECRET = previous.IMPORT_WORKER_SECRET
    }
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    requireCronAuthMock.mockReturnValue(true)
    cronSyncAllMock.mockResolvedValue([
      { challengeId: "wc1", teamsSynced: 32, fixturesSynced: 8, leaderboard: [{ participantId: "p1" }] },
    ])

    isAuthorizedRequestMock.mockReturnValue(true)
    getWorldCupApiUserMock.mockResolvedValue({ id: "u1", email: "admin@example.com" })
    getWorldCupAdminStateMock.mockResolvedValue(true)
    syncWorldCupChallengeMock.mockResolvedValue({ teamsSynced: 32, fixturesSynced: 8, leaderboard: [] })
    syncAllChallengesMock.mockResolvedValue([])
    recalculateWorldCupChallengeMock.mockResolvedValue([])
    runWorldCupDiagnosticsMock.mockResolvedValue({
      apiKeyConfigured: true,
      leagueIdConfigured: true,
      leagueId: "1",
      dbConnected: true,
      worldCupTablesAvailable: true,
      teamCount: 32,
      fixtureCount: 64,
      openBracketCount: 1,
      liveBracketCount: 0,
      finalBracketCount: 0,
      participantCount: 3,
      lastSuccessfulSync: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      lastSyncError: null,
      apiFetchSample: "ok",
      apiFetchError: null,
      canNormalizeStatus: true,
      canIdentifyWinner: true,
      errors: [],
    })

    worldCupSyncLogCreateMock.mockResolvedValue({ id: "log1" })
    worldCupChallengeFindManyMock.mockResolvedValue([
      {
        id: "wc1",
        name: "World Cup Challenge",
        ownerUserId: "u1",
        seasonYear: 2026,
        inviteCode: "INVITE123",
        visibility: "private",
        status: "open",
        includeThirdPlace: false,
        lastSyncedAt: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        _count: { participants: 3 },
      },
    ])
    appUserFindManyMock.mockResolvedValue([{ id: "u1", username: "owner", email: "owner@example.com" }])
  })

  it("rejects unauthorized cron requests", async () => {
    requireCronAuthMock.mockReturnValueOnce(false)

    const { POST } = await import("@/app/api/cron/world-cup-sync/route")
    const res = await POST(new Request("http://localhost/api/cron/world-cup-sync", { method: "POST" }) as any)

    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: "Unauthorized" })
  })

  it("returns sync summary for authorized cron requests", async () => {
    const { POST } = await import("@/app/api/cron/world-cup-sync/route")
    const res = await POST(new Request("http://localhost/api/cron/world-cup-sync", { method: "POST" }) as any)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      teamsSynced: 32,
      fixturesSynced: 8,
      bracketsUpdated: 1,
      leaderboardsRecalculated: 1,
    })
    expect(body.errors).toEqual([])
    expect(worldCupSyncLogCreateMock).toHaveBeenCalled()
  })

  it("sanitizes cron errors before returning JSON", async () => {
    // Uses a synthetic key-shaped string (not a real credential) to verify sanitization logic.
    const fakeKey = ["sk", "live", "fakekeyfortestingonly1234567890"].join("_")
    cronSyncAllMock.mockRejectedValueOnce(new Error(`token=supersecretvalue API_FOOTBALL_KEY=${fakeKey}`))

    const { POST } = await import("@/app/api/cron/world-cup-sync/route")
    const res = await POST(new Request("http://localhost/api/cron/world-cup-sync", { method: "POST" }) as any)
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.ok).toBe(false)
    expect(JSON.stringify(body)).not.toContain("supersecretvalue")
    expect(JSON.stringify(body)).not.toContain("sk_live_")
  })

  it("returns safe diagnostics for admin health", async () => {
    const { GET } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await GET(new Request("http://localhost/api/brackets/world-cup/admin/health") as any, { params: { path: ["admin", "health"] } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.diagnostics.apiKeyConfigured).toBe(true)
    expect(JSON.stringify(body.diagnostics)).not.toContain("API_FOOTBALL_KEY")
  })

  it("returns 401 for non-admin health requests", async () => {
    isAuthorizedRequestMock.mockReturnValueOnce(false)
    getWorldCupAdminStateMock.mockResolvedValueOnce(false)

    const { GET } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await GET(new Request("http://localhost/api/brackets/world-cup/admin/health") as any, { params: { path: ["admin", "health"] } })

    expect(res.status).toBe(401)
  })

  it("returns admin challenge rows with participantCount and ownerName", async () => {
    const { GET } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await GET(new Request("http://localhost/api/brackets/world-cup/admin/challenges?limit=10") as any, { params: { path: ["admin", "challenges"] } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.challenges[0]).toMatchObject({
      id: "wc1",
      participantCount: 3,
      ownerName: "owner",
    })
  })
})
