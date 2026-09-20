import { beforeEach, describe, expect, it, vi } from "vitest"

const getServerSessionMock = vi.hoisted(() => vi.fn())
const getTokenMock = vi.hoisted(() => vi.fn())
const createChallengeMock = vi.hoisted(() => vi.fn())
const getChallengeViewMock = vi.hoisted(() => vi.fn())
const savePicksMock = vi.hoisted(() => vi.fn())
const syncChallengeMock = vi.hoisted(() => vi.fn())
const syncAllMock = vi.hoisted(() => vi.fn())
const userCanManageMock = vi.hoisted(() => vi.fn())
const recalcMock = vi.hoisted(() => vi.fn())
const getInviteMock = vi.hoisted(() => vi.fn(async () => null))
const joinInviteMock = vi.hoisted(() => vi.fn(async () => ({ challengeId: "wc1", participantId: "p1" })))
const challengeFindUniqueMock = vi.hoisted(() => vi.fn())
const isAdminEmailAllowedMock = vi.hoisted(() => vi.fn())
const isAuthorizedRequestMock = vi.hoisted(() => vi.fn())
const syncGroupStandingsMock = vi.hoisted(() => vi.fn())
const userHasWorldCupCommissionerAccessMock = vi.hoisted(() => vi.fn())

vi.mock("next-auth", () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock("next-auth/jwt", () => ({
  getToken: getTokenMock,
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
  getWorldCupChallengeByInvite: getInviteMock,
  joinWorldCupChallengeByInvite: joinInviteMock,
  createAdditionalWorldCupInvite: vi.fn(async () => ({ inviteCode: "INVITE", inviteUrl: "http://localhost:3000/join/bracket/INVITE" })),
  updateWorldCupChallengeSettings: vi.fn(async () => ({})),
}))

vi.mock("@/lib/world-cup/worldCupDiagnosticsService", () => ({
  runWorldCupDiagnostics: vi.fn(async () => ({ ok: true })),
}))

vi.mock("@/lib/world-cup/worldCupGroupStageResultService", () => ({
  syncWorldCupProviderGroupStandings: syncGroupStandingsMock,
}))

vi.mock("@/lib/world-cup/worldCupCommissionerAccess", () => ({
  userHasWorldCupCommissionerAccess: userHasWorldCupCommissionerAccessMock,
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
    getTokenMock.mockResolvedValue(null)
    createChallengeMock.mockResolvedValue({ challengeId: "wc1", inviteCode: "INVITE", inviteUrl: "http://localhost:3000/join/bracket/INVITE" })
    getChallengeViewMock.mockResolvedValue({ challenge: { id: "wc1" }, picks: [], leaderboard: [], scoring: {} })
    savePicksMock.mockResolvedValue({ challenge: { id: "wc1" }, picks: [{ matchId: "m1" }] })
    syncChallengeMock.mockResolvedValue({ teamsSynced: 0, fixturesSynced: 0 })
    syncAllMock.mockResolvedValue([])
    userCanManageMock.mockReturnValue(true)
    recalcMock.mockResolvedValue([])
    syncGroupStandingsMock.mockResolvedValue({
      challengeId: "wc1",
      standingsReceived: 48,
      groupsUpdated: 12,
      groupTeamsUpdated: 48,
      thirdPlaceTeamsUpdated: 8,
      warnings: [],
    })
    getInviteMock.mockResolvedValue(null)
    joinInviteMock.mockResolvedValue({ challengeId: "wc1", participantId: "p1", entryId: "e1" })
    challengeFindUniqueMock.mockResolvedValue({ id: "wc1", ownerUserId: "u1", inviteCode: "INVITE", visibility: "public" })
    isAdminEmailAllowedMock.mockReturnValue(true)
    isAuthorizedRequestMock.mockReturnValue(true)
    userHasWorldCupCommissionerAccessMock.mockResolvedValue(true)
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

  it("blocks non-admin users from creating test or simulation pools through the catch-all route", async () => {
    isAuthorizedRequestMock.mockReturnValue(false)
    isAdminEmailAllowedMock.mockReturnValue(false)
    createChallengeMock.mockClear()

    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "World Cup",
          seasonYear: 2026,
          isTestMode: true,
          simulationEnabled: true,
          seedTestFixtures: true,
        }),
      }),
      makeContext(["create"])
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: "World Cup test, demo, and simulation pools can only be created by admins.",
    })
    expect(createChallengeMock).not.toHaveBeenCalled()
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

  it("normalizes create payload aliases in the dedicated create route", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/create/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "World Cup",
          seasonYear: 2026,
          privacy: "public",
          lockRule: "per_match",
          includeThirdPlaceMatch: true,
          maxUsers: 64,
          bracketsPerUser: 3,
          isTestMode: true,
          seedTestFixtures: true,
        }),
      })
    )

    expect(res.status).toBe(200)
    expect(createChallengeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "World Cup",
        seasonYear: 2026,
        visibility: "public",
        pickLockStrategy: "per_match",
        includeThirdPlace: true,
        maxParticipants: 64,
        maxEntriesPerParticipant: 3,
        isTestMode: true,
        seedTestFixtures: true,
      })
    )
  })

  /*
   * The 2026 tournament is over. These pin the season gate, which sits LAST in the route — after
   * every authorization check — so the only answers it changes belong to requests that would
   * otherwise have created a pool.
   *
   * ⚠ This suite's `beforeEach` makes the default user an ADMIN, and admins bypass the gate. A
   * closed-path test MUST clear that first; without it the request takes the bypass and the test
   * proves nothing while looking like coverage.
   */
  it("refuses a new pool for a finished tournament, for a non-admin", async () => {
    isAuthorizedRequestMock.mockReturnValue(false)
    isAdminEmailAllowedMock.mockReturnValue(false)
    // This suite does not reset mocks between tests, so "was never called" would otherwise be
    // measuring calls from earlier cases in the file rather than this request.
    createChallengeMock.mockClear()

    const { POST } = await import("@/app/api/brackets/world-cup/create/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Too Late", seasonYear: 2026 }),
      })
    )

    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe("world_cup_entries_closed")
    expect(body.closedAt).toBe("2026-07-20T06:00:00.000Z")
    // The decisive assertion: nothing was written.
    expect(createChallengeMock).not.toHaveBeenCalled()
  })

  it("still lets an admin create out of season, so the stack stays testable", async () => {
    // beforeEach already grants admin; restated so the contrast with the test above is visible
    // rather than inherited.
    isAdminEmailAllowedMock.mockReturnValue(true)
    isAuthorizedRequestMock.mockReturnValue(true)
    createChallengeMock.mockClear()

    const { POST } = await import("@/app/api/brackets/world-cup/create/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Admin Test Pool", seasonYear: 2026 }),
      })
    )

    expect(res.status).toBe(200)
    expect(createChallengeMock).toHaveBeenCalledTimes(1)
  })

  it("normalizes knockout-only create mode and disables third-place picks", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/create/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Knockout Only",
          seasonYear: 2026,
          knockoutMode: "knockout_only",
          includeThirdPlaceMatch: true,
        }),
      })
    )

    expect(res.status).toBe(200)
    expect(createChallengeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Knockout Only",
        knockoutMode: "knockout_only",
        includeThirdPlace: false,
      })
    )
  })

  it("blocks regular users from creating knockout-only pools without AF Commissioner", async () => {
    isAuthorizedRequestMock.mockReturnValue(false)
    isAdminEmailAllowedMock.mockReturnValue(false)
    userHasWorldCupCommissionerAccessMock.mockResolvedValueOnce(false)
    createChallengeMock.mockClear()

    const { POST } = await import("@/app/api/brackets/world-cup/create/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Knockout Only",
          seasonYear: 2026,
          knockoutMode: "knockout_only",
        }),
      })
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      upgrade: true,
    })
    expect(createChallengeMock).not.toHaveBeenCalled()
  })

  it("blocks non-admin users from creating test or simulation pools through the dedicated create route", async () => {
    isAuthorizedRequestMock.mockReturnValue(false)
    isAdminEmailAllowedMock.mockReturnValue(false)
    createChallengeMock.mockClear()

    const { POST } = await import("@/app/api/brackets/world-cup/create/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "World Cup",
          seasonYear: 2026,
          testMode: true,
          demoMode: true,
          useTestFixtures: true,
        }),
      })
    )

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toMatchObject({
      error: "World Cup test, demo, and simulation pools can only be created by admins.",
    })
    expect(createChallengeMock).not.toHaveBeenCalled()
  })

  it("falls back to the auth token when getServerSession throws in the dedicated create route", async () => {
    getServerSessionMock.mockRejectedValueOnce(new Error("session exploded"))
    getTokenMock.mockResolvedValueOnce({
      sub: "u1",
      email: "owner@example.com",
      name: "Owner",
    })

    const { POST } = await import("@/app/api/brackets/world-cup/create/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/create", {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "next-auth.session-token=abc" },
        body: JSON.stringify({ name: "World Cup", seasonYear: 2026 }),
      })
    )

    expect(res.status).toBe(200)
    expect(createChallengeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ id: "u1", email: "owner@example.com", name: "Owner" }),
      })
    )
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

  it("syncs group standings through the consolidated catch-all route", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/wc1/admin/sync-group-standings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "apifootball", seasonYear: 2026 }),
      }),
      makeContext(["wc1", "admin", "sync-group-standings"])
    )

    expect(res.status).toBe(200)
    expect(syncGroupStandingsMock).toHaveBeenCalledWith({
      challengeId: "wc1",
      provider: "apifootball",
      seasonYear: 2026,
    })
    const body = await res.json()
    expect(body).toMatchObject({
      ok: true,
      provider: "apifootball",
      result: {
        standingsReceived: 48,
        groupTeamsUpdated: 48,
      },
    })
  })

  it("returns sanitized provider errors for group standings sync failures", async () => {
    syncGroupStandingsMock.mockRejectedValueOnce(
      new Error("API-Football standings failed: x-apisports-key=secret-value&key=another-secret")
    )

    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")
    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/wc1/admin/sync-group-standings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "apifootball", seasonYear: 2026 }),
      }),
      makeContext(["wc1", "admin", "sync-group-standings"])
    )

    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body).toMatchObject({
      ok: false,
      error: "provider_fetch_failed",
      message: "World Cup data provider request failed. Check provider status, credentials, and rate limits.",
      provider: "apifootball",
      seasonYear: 2026,
    })
    expect(JSON.stringify(body)).not.toContain("secret-value")
    expect(JSON.stringify(body)).not.toContain("another-secret")
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

  it("previews a World Cup invite without exposing private participant details", async () => {
    getInviteMock.mockResolvedValueOnce({
      inviteCode: "INVITE",
      challengeId: "wc1",
      name: "Office Pool",
      ownerName: "Owner",
      seasonYear: 2026,
      participantCount: 3,
      status: "open",
      visibility: "private",
      joinPreview: { joinBlockedReason: null, requiresJoinPassword: false },
    })
    const { GET } = await import("@/app/api/brackets/world-cup/[[...path]]/route")

    const res = await GET(
      new Request("http://localhost/api/brackets/world-cup/invite/INVITE"),
      makeContext(["invite", "INVITE"])
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.invite).toMatchObject({
      inviteCode: "INVITE",
      challengeId: "wc1",
      name: "Office Pool",
      visibility: "private",
    })
    expect(JSON.stringify(body)).not.toMatch(/email|participants|ownerUserId/i)
  })

  it("joins a World Cup invite through the consolidated catch-all join action", async () => {
    const { POST } = await import("@/app/api/brackets/world-cup/[[...path]]/route")

    const res = await POST(
      new Request("http://localhost/api/brackets/world-cup/invite/INVITE/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinPassword: "secret" }),
      }),
      makeContext(["invite", "INVITE", "join"])
    )

    expect(res.status).toBe(200)
    expect(joinInviteMock).toHaveBeenCalledWith({
      inviteCode: "INVITE",
      user: expect.objectContaining({ id: "u1" }),
      joinPassword: "secret",
    })
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, challengeId: "wc1", participantId: "p1" })
  })
})

