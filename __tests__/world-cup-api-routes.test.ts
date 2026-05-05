import { beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const createChallengeMock = vi.hoisted(() => vi.fn())
const getChallengeViewMock = vi.hoisted(() => vi.fn())
const savePicksMock = vi.hoisted(() => vi.fn())
const syncChallengeMock = vi.hoisted(() => vi.fn())
const syncAllMock = vi.hoisted(() => vi.fn())
const userCanManageMock = vi.hoisted(() => vi.fn())
const recalcMock = vi.hoisted(() => vi.fn())
const challengeFindUniqueMock = vi.hoisted(() => vi.fn())
const isAdminEmailAllowedMock = vi.hoisted(() => vi.fn())
const isAuthorizedRequestMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("@/lib/auth", () => ({ authOptions: {} }))

vi.mock("@/lib/world-cup", () => ({
  createWorldCupBracketChallenge: createChallengeMock,
  getWorldCupChallengeView: getChallengeViewMock,
  saveWorldCupPicks: savePicksMock,
  syncWorldCupChallenge: syncChallengeMock,
  syncAllOpenWorldCupChallenges: syncAllMock,
  userCanManageWorldCupChallenge: userCanManageMock,
  recalculateWorldCupChallenge: recalcMock,
  getWorldCupChallengeByInvite: vi.fn(async () => null),
  joinWorldCupChallengeByInvite: vi.fn(async () => ({ challengeId: "wc1", participantId: "p1" })),
  createAdditionalWorldCupInvite: vi.fn(async () => ({ inviteCode: "INVITE", inviteUrl: "http://localhost:3000/join/bracket/INVITE" })),
  updateWorldCupChallengeSettings: vi.fn(async () => ({})),
}))

vi.mock("@/lib/world-cup/worldCupDiagnosticsService", () => ({
  runWorldCupDiagnostics: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    worldCupBracketChallenge: {
      findUnique: challengeFindUniqueMock,
      findMany: vi.fn(async () => []),
    },
    appUser: {
      findMany: vi.fn(async () => []),
    },
  },
}))

vi.mock("@/lib/adminAuth", () => ({
  isAdminEmailAllowed: isAdminEmailAllowedMock,
  isAuthorizedRequest: isAuthorizedRequestMock,
}))

function makeContext(path: string[]) {
  return { params: { path } }
}

describe("World Cup API catch-all route", () => {
  beforeEach(() => {
    vi.resetModules()
    getServerSessionMock.mockResolvedValue({ user: { id: "u1", email: "owner@example.com", name: "Owner" } })
    createChallengeMock.mockResolvedValue({ challengeId: "wc1", inviteCode: "INVITE", inviteUrl: "http://localhost:3000/join/bracket/INVITE" })
    getChallengeViewMock.mockResolvedValue({ challenge: { id: "wc1" }, picks: [], leaderboard: [], scoring: {} })
    savePicksMock.mockResolvedValue({ challenge: { id: "wc1" }, picks: [{ matchId: "m1" }] })
    syncChallengeMock.mockResolvedValue({ teamsSynced: 0, fixturesSynced: 0 })
    syncAllMock.mockResolvedValue([])
    userCanManageMock.mockReturnValue(true)
    recalcMock.mockResolvedValue([])
    challengeFindUniqueMock.mockResolvedValue({ id: "wc1", ownerUserId: "u1", inviteCode: "INVITE", visibility: "public" })
    isAdminEmailAllowedMock.mockReturnValue(true)
    isAuthorizedRequestMock.mockReturnValue(true)
  })

  // ── Create ──────────────────────────────────────────────────────────────────

  it("creates a bracket challenge and returns top-level challengeId", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "World Cup", seasonYear: 2026 }),
      }),
      makeContext(["create"])
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.challengeId).toBe("wc1")
    expect(body.id).toBe("wc1")
    expect(body.challenge?.id).toBe("wc1")
    expect(body.inviteCode).toBe("INVITE")
    expect(body.inviteUrl).toContain("INVITE")
  })

  it("returns 401 when unauthenticated user tries to create", async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "World Cup", seasonYear: 2026 }),
      }),
      makeContext(["create"])
    )
    expect(res.status).toBe(401)
  })

  it("returns 500 and error message when service returns no id", async () => {
    createChallengeMock.mockResolvedValueOnce({ inviteCode: "X" }) // no challengeId or id
    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "World Cup", seasonYear: 2026 }),
      }),
      makeContext(["create"])
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  // ── Picks ────────────────────────────────────────────────────────────────────

  it("saves picks through the catch-all route", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/wc1/picks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ picks: [{ matchId: "m1", selectedSlotKey: "GAW" }] }),
      }),
      makeContext(["wc1", "picks"])
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  // ── Sync ─────────────────────────────────────────────────────────────────────

  it("syncs challenges for authorized requests", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/sync", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-secret": "secret" },
        body: JSON.stringify({ challengeId: "wc1" }),
      }),
      makeContext(["sync"])
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  it("rejects sync for unauthorized requests", async () => {
    isAuthorizedRequestMock.mockReturnValue(false)
    isAdminEmailAllowedMock.mockReturnValue(false)
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: "wc1" }),
      }),
      makeContext(["sync"])
    )
    expect(res.status).toBe(401)
  })

  // ── GET challenge ─────────────────────────────────────────────────────────────

  it("fetches a challenge view", async () => {
    const { GET } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await GET(
      new Request("http://localhost/api/brackets/world-cup/wc1"),
      makeContext(["wc1"])
    )
    expect(res.status).toBe(200)
  })

  it("returns 404 for unknown challenge", async () => {
    getChallengeViewMock.mockResolvedValueOnce(null)
    const { GET } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await GET(
      new Request("http://localhost/api/brackets/world-cup/nonexistent"),
      makeContext(["nonexistent"])
    )
    expect(res.status).toBe(404)
  })
})

