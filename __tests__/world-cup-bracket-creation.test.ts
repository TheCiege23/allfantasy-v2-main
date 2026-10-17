import { beforeEach, describe, expect, it, vi } from "vitest"

const prismaMocks = vi.hoisted(() => ({
  challengeFindUnique: vi.fn(),
  appUserFindUnique: vi.fn(),
  scoringCreate: vi.fn(),
  challengeCreate: vi.fn(),
  slotCreateMany: vi.fn(),
  matchCreateMany: vi.fn(),
  participantCreate: vi.fn(),
  entryCreate: vi.fn(),
  entryFindFirst: vi.fn(),
  inviteCreate: vi.fn(),
  inviteFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

const loadTestFixturesMock = vi.hoisted(() => vi.fn())
const lifecycleMocks = vi.hoisted(() => ({
  challengeCreated: vi.fn(),
  bracketCompleted: vi.fn(),
  entryCreated: vi.fn(),
  userJoined: vi.fn(),
}))

vi.mock("@/lib/adminAuth", () => ({
  isAdminEmailAllowed: vi.fn(() => false),
}))

vi.mock("@/lib/bracket-brain/bracketBrainAccess", () => ({
  userHasBracketBrainAi: vi.fn(async () => false),
}))

vi.mock("@/lib/world-cup/worldCupScoringService", () => ({
  buildWorldCupLeaderboardRows: vi.fn(() => []),
  isWorldCupEntryCompleteFromSelections: vi.fn(() => false),
  recalculateWorldCupChallenge: vi.fn(async () => []),
}))

vi.mock("@/lib/world-cup/worldCupBracketEventService", () => ({
  ensureWorldCupCommissionerSettings: vi.fn(async () => null),
}))

vi.mock("@/lib/world-cup/worldCupBracketLifecycleEvents", () => ({
  emitWorldCupChallengeCreated: lifecycleMocks.challengeCreated,
  emitWorldCupBracketCompleted: lifecycleMocks.bracketCompleted,
  emitWorldCupEntryCreated: lifecycleMocks.entryCreated,
  emitWorldCupUserJoined: lifecycleMocks.userJoined,
}))

vi.mock("@/lib/world-cup/worldCupBracketSettingsService", () => ({
  getWorldCupJoinPasswordHashFromPayload: vi.fn(() => null),
  hashWorldCupJoinPassword: vi.fn(async () => "hash"),
  parseWorldCupLeagueSettings: vi.fn(() => ({ allowLateJoin: false })),
}))

vi.mock("@/lib/world-cup/worldCupSimulationService", () => ({
  loadWorldCupTestFixtures: loadTestFixturesMock,
}))

vi.mock("@/lib/prisma", () => {
  return {
    prisma: {
      $transaction: prismaMocks.transaction,
      worldCupBracketChallenge: {
        findUnique: prismaMocks.challengeFindUnique,
      },
      appUser: {
        findUnique: prismaMocks.appUserFindUnique,
      },
      worldCupBracketEntry: {
        findFirst: prismaMocks.entryFindFirst,
      },
      worldCupBracketInvite: {
        findUnique: prismaMocks.inviteFindUnique,
      },
    },
  }
})

import { createWorldCupBracketChallenge, joinWorldCupChallengeByInvite } from "@/lib/world-cup/worldCupBracketService"

const fixtureSeedResult = {
  success: true,
  teamsCreated: 32,
  teamsUpdated: 0,
  matchesUpdated: 16,
  pickableMatchesAfter: 16,
  totalMatchesAfter: 31,
  unresolvedMatchesAfter: 15,
  warnings: [],
}

describe("World Cup bracket creation fixture readiness", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    prismaMocks.challengeFindUnique.mockResolvedValue(null)
    prismaMocks.scoringCreate.mockResolvedValue({ id: "scoring-1" })
    prismaMocks.challengeCreate.mockResolvedValue({
      id: "challenge-1",
      name: "World Cup",
      ownerUserId: "user-1",
    })
    prismaMocks.participantCreate.mockResolvedValue({ id: "participant-1" })
    prismaMocks.entryCreate.mockResolvedValue({ id: "entry-1", name: "Bracket 1" })
    prismaMocks.entryFindFirst.mockResolvedValue({ id: "entry-1", name: "Bracket 1" })
    prismaMocks.inviteFindUnique.mockResolvedValue(null)
    prismaMocks.transaction.mockImplementation(async (callback) =>
      callback({
        worldCupBracketScoringProfile: { create: prismaMocks.scoringCreate },
        worldCupBracketChallenge: { create: prismaMocks.challengeCreate },
        worldCupBracketSlot: { createMany: prismaMocks.slotCreateMany },
        worldCupBracketMatch: { createMany: prismaMocks.matchCreateMany },
        worldCupBracketParticipant: { create: prismaMocks.participantCreate },
        worldCupBracketEntry: { create: prismaMocks.entryCreate },
        worldCupBracketInvite: { create: prismaMocks.inviteCreate },
      })
    )
    loadTestFixturesMock.mockResolvedValue(fixtureSeedResult)
    delete process.env.WORLD_CUP_ALLOW_PRODUCTION_TEST_FIXTURES_ON_CREATE
  })

  it("creates the unresolved bracket template and seeds mock fixtures in test mode", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const result = await createWorldCupBracketChallenge({
      user: { id: "user-1", name: "Owner" },
      name: "World Cup",
      isTestMode: true,
      seedTestFixtures: true,
    })

    const matchRows = prismaMocks.matchCreateMany.mock.calls[0]?.[0]?.data ?? []
    expect(matchRows).toHaveLength(31)
    expect(matchRows[0]).toMatchObject({
      challengeId: "challenge-1",
      round: "round_of_32",
      matchNumber: 1,
      homeSlotKey: "A1",
      awaySlotKey: "B2",
      homeTeamName: "Group A Winner",
      awayTeamName: "Group B Runner-up",
    })
    expect(loadTestFixturesMock).toHaveBeenCalledWith("challenge-1", {
      dryRun: false,
    })
    expect(prismaMocks.challengeCreate.mock.calls[0]?.[0]?.data.sourcePayload).toMatchObject({
      simulation: {
        isTestMode: true,
        testFixturesOnCreate: true,
        fixtureTemplate: "mock_round_of_32",
      },
    })
    expect(result.fixturesSeeded).toBe(true)
  })

  it("does not seed mock fixtures on production create unless explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production")

    await createWorldCupBracketChallenge({
      user: { id: "user-1", name: "Owner" },
      name: "World Cup",
      isTestMode: true,
      seedTestFixtures: true,
    })

    expect(loadTestFixturesMock).not.toHaveBeenCalled()
    expect(prismaMocks.challengeCreate.mock.calls[0]?.[0]?.data.sourcePayload).toMatchObject({
      simulation: {
        isTestMode: true,
        testFixturesOnCreate: false,
        fixtureTemplate: "slot_template",
      },
    })
  })

  it("creates unresolved slot fixtures without mock teams when test mode is off", async () => {
    await createWorldCupBracketChallenge({
      user: { id: "user-1", name: "Owner" },
      name: "World Cup",
    })

    expect(prismaMocks.matchCreateMany.mock.calls[0]?.[0]?.data).toHaveLength(31)
    expect(loadTestFixturesMock).not.toHaveBeenCalled()
    expect(prismaMocks.challengeCreate.mock.calls[0]?.[0]?.data.sourcePayload).toBeUndefined()
  })

  it("stores knockout-only league settings and disables third-place on create", async () => {
    await createWorldCupBracketChallenge({
      user: { id: "user-1", name: "Owner" },
      name: "Knockout Only",
      knockoutMode: "knockout_only",
      includeThirdPlace: true,
    })

    const challengeData = prismaMocks.challengeCreate.mock.calls[0]?.[0]?.data
    expect(challengeData).toMatchObject({
      includeThirdPlace: false,
      sourcePayload: {
        leagueSettings: {
          knockoutMode: "knockout_only",
        },
      },
    })
    expect(prismaMocks.matchCreateMany.mock.calls[0]?.[0]?.data).toHaveLength(31)
    expect(loadTestFixturesMock).not.toHaveBeenCalled()
  })

  it("blocks direct joins when an invite link is expired", async () => {
    prismaMocks.inviteFindUnique.mockResolvedValueOnce({
      id: "invite-1",
      inviteCode: "INVITE",
      challengeId: "challenge-1",
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      maxUses: null,
      useCount: 0,
      challenge: { id: "challenge-1", sourcePayload: null, matches: [] },
    })

    await expect(joinWorldCupChallengeByInvite({
      inviteCode: "INVITE",
      user: { id: "user-2", name: "Guest" },
    })).rejects.toThrow("expired")
    expect(prismaMocks.transaction).not.toHaveBeenCalled()
  })

  it("blocks direct joins when an invite has reached max uses", async () => {
    prismaMocks.inviteFindUnique.mockResolvedValueOnce({
      id: "invite-1",
      inviteCode: "INVITE",
      challengeId: "challenge-1",
      expiresAt: null,
      maxUses: 2,
      useCount: 2,
      challenge: { id: "challenge-1", sourcePayload: null, matches: [] },
    })

    await expect(joinWorldCupChallengeByInvite({
      inviteCode: "INVITE",
      user: { id: "user-2", name: "Guest" },
    })).rejects.toThrow("maximum number of uses")
    expect(prismaMocks.transaction).not.toHaveBeenCalled()
  })

  /* The participant name is PERSISTED and shown to the whole pool — it must never come from an email. */
  it("never stores an email prefix as the owner's pool name", async () => {
    prismaMocks.appUserFindUnique.mockResolvedValue({
      displayName: null,
      username: null,
      email: "secret.person@example.com",
    })

    await createWorldCupBracketChallenge({
      user: { id: "user-1", email: "secret.person@example.com" },
      name: "World Cup",
    })

    const stored = prismaMocks.participantCreate.mock.calls[0]?.[0]?.data?.displayName
    expect(stored).toBe("Bracket Manager")
    expect(JSON.stringify(prismaMocks.participantCreate.mock.calls)).not.toContain("secret.person")
  })

  it("refuses a session name that is itself an email address", async () => {
    prismaMocks.appUserFindUnique.mockResolvedValue({ displayName: null, username: "goalhanger", email: "secret.person@example.com" })

    await createWorldCupBracketChallenge({
      user: { id: "user-1", name: "secret.person@example.com", email: "secret.person@example.com" },
      name: "World Cup",
    })

    expect(prismaMocks.participantCreate.mock.calls[0]?.[0]?.data?.displayName).toBe("goalhanger")
  })
})
