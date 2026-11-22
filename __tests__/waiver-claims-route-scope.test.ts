import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  leagueFindFirst: vi.fn(),
  rosterFindFirst: vi.fn(),
  createClaim: vi.fn(),
  getClaimsByRoster: vi.fn(),
  getPendingClaims: vi.fn(),
  getProcessedClaimsAndTransactions: vi.fn(),
  getLeagueRole: vi.fn(),
}))

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}))

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    league: { findFirst: mocks.leagueFindFirst },
    roster: { findFirst: mocks.rosterFindFirst },
  },
}))

vi.mock("@/lib/waiver-wire", () => ({
  createClaim: mocks.createClaim,
  getClaimsByRoster: mocks.getClaimsByRoster,
  getEffectiveLeagueWaiverSettings: vi.fn(),
  getPendingClaims: mocks.getPendingClaims,
  getProcessedClaimsAndTransactions: mocks.getProcessedClaimsAndTransactions,
}))

vi.mock("@/lib/league/permissions", () => ({
  getLeagueRole: mocks.getLeagueRole,
}))

vi.mock("@/lib/ai/action-validation", () => ({
  validateAiActionExecution: vi.fn(() => ({ ok: true })),
}))

vi.mock("@/server/services/leagueActionGate", () => ({
  assertLeagueActionGate: vi.fn(() => ({ ok: true })),
}))

vi.mock("@/server/services/auditService", () => ({
  logAction: vi.fn(),
}))

vi.mock("@/lib/roster-legality/rosterTransactionGates", () => ({
  assertRosterTransactionsAllowed: vi.fn(() => ({ ok: true })),
}))

vi.mock("@/lib/waiver-wire/commissioner-claim-override", () => ({
  mergeCommissionerOverrides: vi.fn((metadata) => metadata ?? {}),
}))
// Routes ask lib/league/commissionerAccess.ts (2026-11-16); this defers to the old check this test mocks.
vi.mock('@/lib/league/commissionerAccess', async () => (await import('./helpers/commissionerAccessMock')).accessFromLegacyMocks())

function req(url: string) {
  return { nextUrl: new URL(url) } as any
}

function postReq(body: unknown) {
  return {
    json: async () => body,
  } as any
}

describe("waiver claim route scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getServerSession.mockResolvedValue({ user: { id: "user-1" } })
    mocks.leagueFindFirst.mockResolvedValue(null)
    mocks.rosterFindFirst.mockResolvedValue({ id: "roster-1" })
    mocks.getClaimsByRoster.mockResolvedValue([{ id: "claim-mine" }])
    mocks.getPendingClaims.mockResolvedValue([{ id: "claim-league" }])
    mocks.getProcessedClaimsAndTransactions.mockResolvedValue({ claims: [], transactions: [] })
    mocks.getLeagueRole.mockResolvedValue("member")
  })

  it("returns my pending claims by default", async () => {
    const { GET } = await import("@/app/api/waiver-wire/leagues/[leagueId]/claims/route")

    const res = await GET(req("http://localhost/api/waiver-wire/leagues/league-1/claims"), {
      params: { leagueId: "league-1" },
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ claims: [{ id: "claim-mine" }], scope: "mine" })
    expect(mocks.getClaimsByRoster).toHaveBeenCalledWith("roster-1", "pending")
    expect(mocks.getPendingClaims).not.toHaveBeenCalled()
  })

  it("allows commissioners to request league pending claims", async () => {
    mocks.getLeagueRole.mockResolvedValueOnce("commissioner")
    const { GET } = await import("@/app/api/waiver-wire/leagues/[leagueId]/claims/route")

    const res = await GET(req("http://localhost/api/waiver-wire/leagues/league-1/claims?scope=league"), {
      params: { leagueId: "league-1" },
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ claims: [{ id: "claim-league" }], scope: "league" })
    expect(mocks.getPendingClaims).toHaveBeenCalledWith("league-1")
  })

  it("rejects league pending claim scope for regular members", async () => {
    const { GET } = await import("@/app/api/waiver-wire/leagues/[leagueId]/claims/route")

    const res = await GET(req("http://localhost/api/waiver-wire/leagues/league-1/claims?scope=league"), {
      params: { leagueId: "league-1" },
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toEqual({ error: "Forbidden" })
    expect(mocks.getPendingClaims).not.toHaveBeenCalled()
  })

  it("returns structured code for duplicate pending claim creation", async () => {
    mocks.getClaimsByRoster.mockResolvedValueOnce([{ id: "claim-1", addPlayerId: "player-1" }])
    const { POST } = await import("@/app/api/waiver-wire/leagues/[leagueId]/claims/route")

    const res = await POST(postReq({ addPlayerId: "player-1" }), {
      params: { leagueId: "league-1" },
    })
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body).toEqual({
      error: "You already have a pending claim for this player.",
      code: "CLAIM_EXISTS",
    })
    expect(mocks.createClaim).not.toHaveBeenCalled()
  })
})
