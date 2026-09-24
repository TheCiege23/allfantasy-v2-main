import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  rosterFindUnique: vi.fn(),
  rosterCount: vi.fn(),
  rosterCreate: vi.fn(),
  leagueFindUnique: vi.fn(),
  draftSessionFindUnique: vi.fn(),
  userProfileFindFirst: vi.fn(),
  leagueTeamCount: vi.fn(),
  leagueTeamCreate: vi.fn(),
  growthAttributionUpsert: vi.fn(),
  assertPaidJoinAllowed: vi.fn(),
  linkDuesToRoster: vi.fn(),
  assessLeagueJoinRisk: vi.fn(),
  createDuplicateManagerFlag: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        roster: { findUnique: mocks.rosterFindUnique, count: mocks.rosterCount, create: mocks.rosterCreate },
        league: { findUnique: mocks.leagueFindUnique },
        draftSession: { findUnique: mocks.draftSessionFindUnique, findFirst: mocks.draftSessionFindUnique },
        userProfile: { findFirst: mocks.userProfileFindFirst },
        leagueTeam: { count: mocks.leagueTeamCount, create: mocks.leagueTeamCreate },
        growthAttribution: { upsert: mocks.growthAttributionUpsert },
      }),
  },
}))

vi.mock("@/lib/league-finance/joinGate", () => ({
  assertPaidJoinAllowed: mocks.assertPaidJoinAllowed,
  linkDuesToRoster: mocks.linkDuesToRoster,
}))

vi.mock("@/lib/identity/DuplicateManagerRiskService", () => ({
  assessLeagueJoinRisk: mocks.assessLeagueJoinRisk,
}))

vi.mock("@/lib/identity/DuplicateManagerFlagService", () => ({
  createDuplicateManagerFlag: mocks.createDuplicateManagerFlag,
}))

import { createFantasyLeagueRoster, createFantasyLeagueRosterBypassingRiskCheck } from "@/lib/invite-engine/InviteEngine"

const LEAGUE_ID = "league-1"
const USER_ID = "joiner-1"

describe("createFantasyLeagueRoster — duplicate-manager join guard", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.rosterFindUnique.mockResolvedValue(null) // not already a member
    mocks.leagueFindUnique.mockResolvedValue({ id: LEAGUE_ID, name: "Test League", platform: "manual", leagueSize: 12, leagueVariant: "redraft" })
    mocks.rosterCount.mockResolvedValue(1)
    mocks.draftSessionFindUnique.mockResolvedValue(null)
    mocks.userProfileFindFirst.mockResolvedValue({ displayName: "Joiner", sleeperUsername: null })
    mocks.assertPaidJoinAllowed.mockResolvedValue({ ok: true })
    mocks.linkDuesToRoster.mockResolvedValue(undefined)
    mocks.rosterCreate.mockResolvedValue({ id: "new-roster-1" })
    mocks.leagueTeamCount.mockResolvedValue(1)
    mocks.leagueTeamCreate.mockReturnValue({ catch: () => Promise.resolve(null) })
    mocks.growthAttributionUpsert.mockResolvedValue({})
    mocks.createDuplicateManagerFlag.mockResolvedValue("flag-1")
  })

  it("creates the roster normally when risk is low", async () => {
    mocks.assessLeagueJoinRisk.mockResolvedValue({ riskLevel: "low", topScore: 0, comparisons: [] })

    const result = await createFantasyLeagueRoster(LEAGUE_ID, USER_ID)

    expect(result).toEqual({ ok: true, leagueId: LEAGUE_ID, alreadyMember: false, pendingReview: false })
    expect(mocks.rosterCreate).toHaveBeenCalledTimes(1)
    expect(mocks.createDuplicateManagerFlag).not.toHaveBeenCalled()
  })

  it("creates the roster AND a visible flag when risk is medium (non-blocking)", async () => {
    mocks.assessLeagueJoinRisk.mockResolvedValue({
      riskLevel: "medium",
      topScore: 35,
      comparisons: [{ suspectAppUserId: "s1", suspectRosterId: "r1", suspectLabel: "Existing Manager", score: 35, riskLevel: "medium", reasons: ["Email address closely matches an existing manager's"], householdExempt: false }],
    })

    const result = await createFantasyLeagueRoster(LEAGUE_ID, USER_ID)

    expect(result.ok).toBe(true)
    expect((result as { pendingReview: boolean }).pendingReview).toBe(false)
    expect(mocks.rosterCreate).toHaveBeenCalledTimes(1)
    expect(mocks.createDuplicateManagerFlag).toHaveBeenCalledWith(expect.objectContaining({ status: "flagged" }))
  })

  it("BLOCKS roster creation and holds for review when risk is high", async () => {
    mocks.assessLeagueJoinRisk.mockResolvedValue({
      riskLevel: "high",
      topScore: 80,
      comparisons: [{ suspectAppUserId: "s1", suspectRosterId: "r1", suspectLabel: "Existing Manager", score: 80, riskLevel: "high", reasons: ["Shared network signal with an existing manager"], householdExempt: false }],
    })

    const result = await createFantasyLeagueRoster(LEAGUE_ID, USER_ID)

    expect(result).toEqual({ ok: true, leagueId: LEAGUE_ID, alreadyMember: false, pendingReview: true })
    expect(mocks.rosterCreate).not.toHaveBeenCalled()
    expect(mocks.createDuplicateManagerFlag).toHaveBeenCalledWith(expect.objectContaining({ status: "pending_review" }))
  })

  it("skips the risk check entirely when a prior commissioner decision already resolved it (bypass path)", async () => {
    await createFantasyLeagueRosterBypassingRiskCheck(LEAGUE_ID, USER_ID)

    expect(mocks.assessLeagueJoinRisk).not.toHaveBeenCalled()
    expect(mocks.rosterCreate).toHaveBeenCalledTimes(1)
  })

  it("still returns alreadyMember without ever running the risk check if the user already has a roster in this league", async () => {
    mocks.rosterFindUnique.mockResolvedValue({ id: "existing-roster" })

    const result = await createFantasyLeagueRoster(LEAGUE_ID, USER_ID)

    expect(result).toEqual({ ok: true, leagueId: LEAGUE_ID, alreadyMember: true, pendingReview: false })
    expect(mocks.assessLeagueJoinRisk).not.toHaveBeenCalled()
    expect(mocks.rosterCreate).not.toHaveBeenCalled()
  })
})
