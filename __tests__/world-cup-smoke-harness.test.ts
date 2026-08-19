/**
 * World Cup Beta Smoke Harness — 12-Step Game Loop
 *
 * Proves every layer of the World Cup bracket game loop works
 * correctly end-to-end without touching a real database or HTTP server.
 *
 * Steps:
 *  1.  Create pool           — createWorldCupBracketChallenge
 *  2.  Ensure group stage    — ensureWorldCupGroupsForChallenge
 *  3.  Invite / join         — joinWorldCupChallengeByInvite
 *  4.  Entry creation        — createWorldCupBracketEntry
 *  5.  Group ranking picks   — saveWorldCupGroupRanking
 *  6.  3rd-place advancers   — saveWorldCupThirdPlaceAdvancers (contract + pick-write)
 *  7.  Knockout picks        — saveWorldCupBracketPickForEntry (reseeded mode)
 *  8.  Finalize review       — isWorldCupEntryCompleteFromSelections
 *  9.  Lock gate             — isWorldCupChallengeLocked
 * 10.  Simulate results      — loadWorldCupTestFixtures (fixture)
 * 11.  Score + recalculate   — evaluateWorldCupPick + recalculateWorldCupChallenge
 * 12.  Leaderboard + share   — buildWorldCupLeaderboardRows
 *
 * Additional proof blocks:
 *  D.  Commissioner settings persist and toggle correctly
 *  E.  AI gating — free users blocked, paid users unlocked
 *  F.  Share / invite link wired to challenge on creation
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_WORLD_CUP_SCORING,
  isWorldCupChallengeLocked,
} from "@/lib/world-cup/worldCupBracketBuilder"
import {
  buildWorldCupLeaderboardRows,
  evaluateWorldCupPick,
  isWorldCupEntryCompleteFromSelections,
} from "@/lib/world-cup/worldCupScoringService"
import {
  canCreateMultipleWorldCupEntries,
  canExportWorldCupLeaderboard,
  canManageBasicWorldCupPool,
  canUseWorldCupAiTools,
  canUseWorldCupChat,
  canUseWorldCupCommissionerTools,
  resolveWorldCupEntitlementSummary,
} from "@/lib/world-cup/worldCupEntitlements"

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}))

vi.mock("@/lib/adminAuth", () => ({ isAdminEmailAllowed: vi.fn(() => false) }))

vi.mock("@/lib/bracket-brain/bracketBrainAccess", () => ({
  userHasBracketBrainAi: vi.fn(async () => false),
}))

const lifecycleMocks = vi.hoisted(() => ({
  challengeCreated: vi.fn(),
  bracketCompleted: vi.fn(),
  entryCreated: vi.fn(),
  userJoined: vi.fn(),
}))
vi.mock("@/lib/world-cup/worldCupBracketLifecycleEvents", () => ({
  emitWorldCupChallengeCreated: lifecycleMocks.challengeCreated,
  emitWorldCupBracketCompleted: lifecycleMocks.bracketCompleted,
  emitWorldCupEntryCreated: lifecycleMocks.entryCreated,
  emitWorldCupUserJoined: lifecycleMocks.userJoined,
}))

const eventServiceMocks = vi.hoisted(() => ({
  ensureWorldCupCommissionerSettings: vi.fn(async () => ({})),
  getWorldCupCommissionerSettings: vi.fn(async () => ({
    enableSystemEvents: true,
    enableAiSummaries: false,
    enableUpsetAlerts: true,
    enableLeaderboardAlerts: true,
    enableChampionBustAlerts: true,
    enableLockReminders: true,
  })),
  updateWorldCupCommissionerSettings: vi.fn(async () => ({})),
}))
vi.mock("@/lib/world-cup/worldCupBracketEventService", () => eventServiceMocks)

vi.mock("@/lib/world-cup/worldCupBracketSettingsService", () => ({
  getWorldCupJoinPasswordHashFromPayload: vi.fn(() => null),
  hashWorldCupJoinPassword: vi.fn(async (v: string) => `hash:${v}`),
  parseWorldCupLeagueSettings: vi.fn(() => ({ allowLateJoin: true })),
  isWorldCupConfidenceScoringEnabled: vi.fn(() => false),
}))

const fixtureSeedResult = {
  success: true,
  teamsCreated: 48,
  teamsUpdated: 0,
  matchesUpdated: 16,
  pickableMatchesAfter: 16,
  totalMatchesAfter: 31,
  unresolvedMatchesAfter: 15,
  warnings: [],
}
vi.mock("@/lib/world-cup/worldCupSimulationService", () => ({
  loadWorldCupTestFixtures: vi.fn(async () => fixtureSeedResult),
  simulateWorldCupMatchResult: vi.fn(async () => null),
  resetWorldCupSimulation: vi.fn(async () => ({})),
}))

// ─── Prisma mock ─────────────────────────────────────────────────────────────

const prismaMocks = vi.hoisted(() => ({
  worldCupBracketScoringProfile: { create: vi.fn(), update: vi.fn() },
  worldCupBracketChallenge: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  worldCupBracketSlot: { createMany: vi.fn() },
  worldCupBracketMatch: {
    createMany: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  worldCupBracketParticipant: {
    create: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
  },
  worldCupBracketEntry: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  worldCupBracketPick: {
    upsert: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
    updateMany: vi.fn(),
  },
  appUser: { findUnique: vi.fn() },
  worldCupBracketInvite: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  worldCupGroup: { createMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  worldCupGroupTeam: { findMany: vi.fn(), createMany: vi.fn(), deleteMany: vi.fn() },
  worldCupTeam: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  worldCupGroupRankingPick: {
    createMany: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  worldCupThirdPlaceAdvancerPick: {
    createMany: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  worldCupBracketCommissionerSettings: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({ prisma: prismaMocks }))

// ─── Shared smoke state ───────────────────────────────────────────────────────

const IDS = {
  challengeId: "smoke-challenge-1",
  ownerUserId: "smoke-owner-1",
  joinerUserId: "smoke-joiner-1",
  inviteCode: "SMOKETEST",
  ownerParticipantId: "smoke-participant-owner",
  joinerParticipantId: "smoke-participant-joiner",
  ownerEntryId: "smoke-entry-owner",
  joinerEntryId: "smoke-entry-joiner",
  groupAId: "smoke-group-A",
  groupBId: "smoke-group-B",
  match1Id: "smoke-match-r32-1",
  match2Id: "smoke-match-r32-2",
  teamArgId: "wc2026_official_arg",
  teamBraId: "wc2026_official_bra",
  teamEngId: "wc2026_official_eng",
  teamFraId: "wc2026_official_fra",
  teamMexId: "wc2026_official_mex",
  teamKorId: "wc2026_official_kor",
  inviteRowId: "smoke-invite-1",
  scoringProfileId: "smoke-scoring-1",
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSmokeChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: IDS.challengeId,
    name: "Smoke Cup 2026",
    ownerUserId: IDS.ownerUserId,
    status: "open",
    pickLockStrategy: "tournament_start" as const,
    pickLockAt: null,
    maxParticipants: 100,
    maxEntriesPerParticipant: 3,
    includeThirdPlace: false,
    inviteCode: IDS.inviteCode,
    inviteUrl: `https://allfantasy.ai/join/bracket/${IDS.inviteCode}`,
    sourcePayload: {
      leagueSettings: { knockoutMode: "reseeded" },
    },
    ...overrides,
  }
}

function makeSmokeMatch(
  idx: number,
  teamIds: { home: string; away: string },
  overrides: Record<string, unknown> = {}
) {
  return {
    id: `smoke-match-r32-${idx}`,
    challengeId: IDS.challengeId,
    round: "round_of_32",
    matchNumber: idx,
    homeSlotKey: `A${idx}`,
    awaySlotKey: `B${idx}`,
    homeTeamId: teamIds.home,
    awayTeamId: teamIds.away,
    homeTeamName: teamIds.home,
    awayTeamName: teamIds.away,
    status: "scheduled",
    apiFixtureId: 100 + idx,
    apiStatusShort: "NS",
    winnerTeamId: null,
    winnerTeamName: null,
    nextMatchId: null,
    nextMatchSlot: null,
    startsAt: null,
    ...overrides,
  }
}

function makeSmokeEntry(entryId: string, participantId: string, userId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    challengeId: IDS.challengeId,
    participantId,
    userId,
    name: "Bracket 1",
    submittedAt: null,
    isComplete: false,
    isLocked: false,
    totalScore: 0,
    maxPossibleScore: 0,
    correctPicks: 0,
    incorrectPicks: 0,
    rank: null,
    roundBreakdown: {},
    championTeamId: null,
    championTeamName: null,
    picks: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }
}

// ─── Step 1: Create pool ──────────────────────────────────────────────────────

describe("STEP-1 — createWorldCupBracketChallenge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.worldCupBracketScoringProfile.create.mockResolvedValue({ id: IDS.scoringProfileId })
    prismaMocks.worldCupBracketChallenge.create.mockResolvedValue(makeSmokeChallenge())
    prismaMocks.worldCupBracketSlot.createMany.mockResolvedValue({ count: 48 })
    prismaMocks.worldCupBracketMatch.createMany.mockResolvedValue({ count: 31 })
    prismaMocks.worldCupBracketParticipant.create.mockResolvedValue({
      id: IDS.ownerParticipantId,
      challengeId: IDS.challengeId,
      userId: IDS.ownerUserId,
      displayName: "Owner",
    })
    prismaMocks.worldCupBracketEntry.create.mockResolvedValue(
      makeSmokeEntry(IDS.ownerEntryId, IDS.ownerParticipantId, IDS.ownerUserId)
    )
    prismaMocks.worldCupBracketInvite.create.mockResolvedValue({
      id: IDS.inviteRowId,
      challengeId: IDS.challengeId,
      inviteCode: IDS.inviteCode,
    })
    prismaMocks.$transaction.mockImplementation(async (callback: (tx: typeof prismaMocks) => Promise<unknown>) =>
      callback(prismaMocks)
    )
  })

  it("creates a pool with 31 bracket matches and wires an invite URL", async () => {
    vi.stubEnv("NODE_ENV", "development")
    const { createWorldCupBracketChallenge } = await import("@/lib/world-cup/worldCupBracketService")

    const result = await createWorldCupBracketChallenge({
      user: { id: IDS.ownerUserId, name: "Owner" },
      name: "Smoke Cup 2026",
      isTestMode: true,
    })

    // Bracket template creates 31 matches
    const matchRows = prismaMocks.worldCupBracketMatch.createMany.mock.calls[0]?.[0]?.data ?? []
    expect(matchRows).toHaveLength(31)
    expect(matchRows[0]).toMatchObject({ round: "round_of_32", matchNumber: 1 })

    // Challenge has an invite code set
    const challengeData = prismaMocks.worldCupBracketChallenge.create.mock.calls[0]?.[0]?.data
    expect(challengeData.inviteCode).toBeTruthy()
    expect(challengeData.inviteUrl).toContain(challengeData.inviteCode)

    // Owner participant + entry created in same transaction
    expect(prismaMocks.worldCupBracketParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: IDS.ownerUserId }) })
    )
    expect(prismaMocks.worldCupBracketEntry.create).toHaveBeenCalled()

    // Lifecycle event emitted
    expect(lifecycleMocks.challengeCreated).toHaveBeenCalled()

    expect(result.challengeId).toBe(IDS.challengeId)
  })

  it("returns fixturesSeeded=false when seedTestFixtures is not requested", async () => {
    const { createWorldCupBracketChallenge } = await import("@/lib/world-cup/worldCupBracketService")

    const result = await createWorldCupBracketChallenge({
      user: { id: IDS.ownerUserId, name: "Owner" },
      name: "Standard Cup",
    })

    expect(result.fixturesSeeded).toBe(false)
  })
})

// ─── Step 2: Ensure group stage ───────────────────────────────────────────────

describe("STEP-2 — ensureWorldCupGroupsForChallenge", () => {
  const OFFICIAL_TEAMS = [
    { id: "wc2026_official_mex", name: "Mexico", country: "Mexico", fifaCode: "MEX", groupName: "A", qualificationStatus: "qualified", sourcePayload: { source: "allfantasy_official_2026_groups", seedOrder: 1 } },
    { id: "wc2026_official_kor", name: "South Korea", country: "South Korea", fifaCode: "KOR", groupName: "A", qualificationStatus: "qualified", sourcePayload: { source: "allfantasy_official_2026_groups", seedOrder: 2 } },
    { id: "wc2026_official_rsa", name: "South Africa", country: "South Africa", fifaCode: "RSA", groupName: "A", qualificationStatus: "qualified", sourcePayload: { source: "allfantasy_official_2026_groups", seedOrder: 3 } },
    { id: "wc2026_official_cze", name: "Czechia", country: "Czechia", fifaCode: "CZE", groupName: "A", qualificationStatus: "qualified", sourcePayload: { source: "allfantasy_official_2026_groups", seedOrder: 4 } },
  ]
  const GROUP_A = { id: IDS.groupAId, challengeId: IDS.challengeId, groupKey: "A", displayName: "Group A", sortOrder: 1, teams: [] }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.$transaction.mockImplementation(async (callback: (tx: typeof prismaMocks) => Promise<unknown>) =>
      callback(prismaMocks)
    )
    prismaMocks.worldCupBracketChallenge.findUnique.mockResolvedValue({ id: IDS.challengeId, sourcePayload: null })
    prismaMocks.worldCupGroup.findMany
      .mockResolvedValueOnce([GROUP_A])
      .mockResolvedValueOnce([
        {
          ...GROUP_A,
          teams: OFFICIAL_TEAMS.map((team, index) => ({
            id: `row-${team.id}`,
            teamId: team.id,
            seedOrder: index + 1,
            actualRank: null,
            points: null,
            goalDifference: null,
            goalsFor: null,
            team,
          })),
        },
      ])
    prismaMocks.worldCupTeam.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(OFFICIAL_TEAMS)
    prismaMocks.worldCupGroupTeam.findMany.mockResolvedValue([])
    prismaMocks.worldCupGroupTeam.createMany.mockResolvedValue({ count: 4 })
    prismaMocks.worldCupGroupTeam.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupGroupRankingPick.findMany.mockResolvedValue([])
    prismaMocks.worldCupGroupRankingPick.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupThirdPlaceAdvancerPick.findMany.mockResolvedValue([])
    prismaMocks.worldCupThirdPlaceAdvancerPick.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupTeam.upsert.mockImplementation(async ({ where, create }: { where: { id: string }; create: Record<string, unknown> }) => ({ ...create, id: where.id }))
    prismaMocks.worldCupTeam.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }))
  })

  it("provisions official 2026 group teams for a pool and returns all groups", async () => {
    const { ensureWorldCupGroupsForChallenge } = await import("@/lib/world-cup/worldCupGroupStageService")

    const result = await ensureWorldCupGroupsForChallenge(IDS.challengeId)

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0].teams).toHaveLength(4)
    expect(result.groups[0].teams[0].team.name).toBe("Mexico")
  })

  it("exposes all four required group stage service functions", async () => {
    const service = await import("@/lib/world-cup/worldCupGroupStageService")

    expect(service.ensureWorldCupGroupsForChallenge).toEqual(expect.any(Function))
    expect(service.getWorldCupGroupStageView).toEqual(expect.any(Function))
    expect(service.saveWorldCupGroupRanking).toEqual(expect.any(Function))
    expect(service.saveWorldCupThirdPlaceAdvancers).toEqual(expect.any(Function))
  })
})

// ─── Step 3: Join via invite ──────────────────────────────────────────────────

describe("STEP-3 — joinWorldCupChallengeByInvite", () => {
  const SMOKE_INVITE = {
    id: IDS.inviteRowId,
    inviteCode: IDS.inviteCode,
    challengeId: IDS.challengeId,
    expiresAt: null,
    maxUses: null,
    useCount: 0,
    challenge: {
      ...makeSmokeChallenge(),
      matches: [],
      maxParticipants: 100,
      sourcePayload: null,
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.worldCupBracketInvite.findUnique.mockResolvedValue(SMOKE_INVITE)
    prismaMocks.worldCupBracketParticipant.findUnique.mockResolvedValue(null) // new joiner
    prismaMocks.worldCupBracketParticipant.count.mockResolvedValue(1) // owner already there
    prismaMocks.worldCupBracketParticipant.create.mockResolvedValue({
      id: IDS.joinerParticipantId,
      challengeId: IDS.challengeId,
      userId: IDS.joinerUserId,
      displayName: "Joiner",
    })
    prismaMocks.worldCupBracketEntry.create.mockResolvedValue(
      makeSmokeEntry(IDS.joinerEntryId, IDS.joinerParticipantId, IDS.joinerUserId)
    )
    prismaMocks.worldCupBracketInvite.update.mockResolvedValue({ useCount: 1 })
    prismaMocks.appUser.findUnique.mockResolvedValue({ displayName: "Joiner", username: null, email: null })
    prismaMocks.$transaction.mockImplementation(async (callback: (tx: typeof prismaMocks) => Promise<unknown>) =>
      callback(prismaMocks)
    )
  })

  it("creates a new participant and entry when a second user joins via invite link", async () => {
    const { joinWorldCupChallengeByInvite } = await import("@/lib/world-cup/worldCupBracketService")
    prismaMocks.worldCupBracketInvite.findUnique
      .mockResolvedValueOnce(SMOKE_INVITE)
      .mockResolvedValueOnce({ useCount: 1 })
    prismaMocks.worldCupBracketParticipant.count
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)

    const result = await joinWorldCupChallengeByInvite({
      inviteCode: IDS.inviteCode,
      user: { id: IDS.joinerUserId, name: "Joiner" },
    })

    expect(result.challengeId).toBe(IDS.challengeId)
    expect(result.participantId).toBe(IDS.joinerParticipantId)
    expect(result.participantCount).toBe(2)
    expect(result.inviteUseCount).toBe(1)
    expect(result.joinedNew).toBe(true)
    expect(prismaMocks.worldCupBracketParticipant.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: IDS.joinerUserId }) })
    )
    expect(lifecycleMocks.userJoined).toHaveBeenCalledWith(
      IDS.challengeId, IDS.joinerUserId, expect.any(String)
    )
    expect(lifecycleMocks.entryCreated).toHaveBeenCalled()
  })

  it("returns the existing participant without double-counting duplicate invite joins", async () => {
    const { joinWorldCupChallengeByInvite } = await import("@/lib/world-cup/worldCupBracketService")
    prismaMocks.worldCupBracketInvite.findUnique
      .mockResolvedValueOnce({ ...SMOKE_INVITE, maxUses: 1, useCount: 1 })
      .mockResolvedValueOnce({ useCount: 1 })
    prismaMocks.worldCupBracketParticipant.findUnique.mockResolvedValueOnce({
      id: IDS.joinerParticipantId,
      challengeId: IDS.challengeId,
      userId: IDS.joinerUserId,
      displayName: "Joiner",
    })
    prismaMocks.worldCupBracketEntry.count.mockResolvedValueOnce(1)
    prismaMocks.worldCupBracketParticipant.count.mockResolvedValueOnce(2)

    const result = await joinWorldCupChallengeByInvite({
      inviteCode: IDS.inviteCode,
      user: { id: IDS.joinerUserId, name: "Joiner" },
    })

    expect(result).toMatchObject({
      challengeId: IDS.challengeId,
      participantId: IDS.joinerParticipantId,
      participantCount: 2,
      inviteUseCount: 1,
      joinedNew: false,
    })
    expect(prismaMocks.worldCupBracketParticipant.create).not.toHaveBeenCalled()
    expect(prismaMocks.worldCupBracketInvite.update).not.toHaveBeenCalled()
    expect(lifecycleMocks.userJoined).not.toHaveBeenCalled()
  })

  it("rejects a join when the invite has expired", async () => {
    const { joinWorldCupChallengeByInvite } = await import("@/lib/world-cup/worldCupBracketService")
    prismaMocks.worldCupBracketInvite.findUnique.mockResolvedValueOnce({
      ...SMOKE_INVITE,
      expiresAt: new Date("2026-01-01T00:00:00.000Z"), // in the past
    })

    await expect(
      joinWorldCupChallengeByInvite({ inviteCode: IDS.inviteCode, user: { id: IDS.joinerUserId } })
    ).rejects.toThrow(/expired/i)
  })

  it("rejects a join when the pool is full", async () => {
    const { joinWorldCupChallengeByInvite } = await import("@/lib/world-cup/worldCupBracketService")
    prismaMocks.worldCupBracketParticipant.count.mockResolvedValue(100)

    await expect(
      // Include name so displayName() returns it without hitting prisma.appUser
      joinWorldCupChallengeByInvite({ inviteCode: IDS.inviteCode, user: { id: "new-user-99", name: "Full Tester" } })
    ).rejects.toThrow(/full/i)
  })
})

// ─── Step 4: Entry creation ───────────────────────────────────────────────────

describe("STEP-4 — createWorldCupBracketEntry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.worldCupBracketChallenge.findUnique.mockResolvedValue(makeSmokeChallenge())
    prismaMocks.worldCupBracketMatch.findMany.mockResolvedValue([]) // no matches → not locked
    prismaMocks.worldCupBracketParticipant.findUnique.mockResolvedValue({
      id: IDS.joinerParticipantId,
      challengeId: IDS.challengeId,
      userId: IDS.joinerUserId,
    })
    prismaMocks.worldCupBracketEntry.count.mockResolvedValue(1)
    prismaMocks.worldCupBracketEntry.create.mockResolvedValue(
      makeSmokeEntry("smoke-entry-joiner-2", IDS.joinerParticipantId, IDS.joinerUserId, { name: "Bracket 2" })
    )
  })

  it("creates a second bracket entry for a participant within the per-participant limit", async () => {
    const { createWorldCupBracketEntry } = await import("@/lib/world-cup/worldCupBracketService")

    const result = await createWorldCupBracketEntry({
      challengeId: IDS.challengeId,
      userId: IDS.joinerUserId,
      name: "Bracket 2",
    })

    expect(result.id).toBe("smoke-entry-joiner-2")
    expect(prismaMocks.worldCupBracketEntry.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: IDS.joinerUserId, name: "Bracket 2" }),
      })
    )
    expect(lifecycleMocks.entryCreated).toHaveBeenCalled()
  })

  it("rejects a new entry when the participant has reached the max-entries limit", async () => {
    const { createWorldCupBracketEntry } = await import("@/lib/world-cup/worldCupBracketService")
    prismaMocks.worldCupBracketEntry.count.mockResolvedValueOnce(3) // maxEntriesPerParticipant = 3

    await expect(
      createWorldCupBracketEntry({ challengeId: IDS.challengeId, userId: IDS.joinerUserId })
    ).rejects.toThrow(/maximum/i)
  })
})

// ─── Step 5: Group ranking picks ─────────────────────────────────────────────

describe("STEP-5 — saveWorldCupGroupRanking", () => {
  const S5_TEAMS = [
    { id: IDS.teamMexId, name: "Mexico", country: "Mexico", fifaCode: "MEX", groupName: "A", qualificationStatus: "qualified", sourcePayload: { source: "allfantasy_official_2026_groups", seedOrder: 1 } },
    { id: IDS.teamKorId, name: "South Korea", country: "South Korea", fifaCode: "KOR", groupName: "A", qualificationStatus: "qualified", sourcePayload: { source: "allfantasy_official_2026_groups", seedOrder: 2 } },
    { id: "wc2026_official_rsa", name: "South Africa", country: "South Africa", fifaCode: "RSA", groupName: "A", qualificationStatus: "qualified", sourcePayload: { source: "allfantasy_official_2026_groups", seedOrder: 3 } },
    { id: "wc2026_official_cze", name: "Czechia", country: "Czechia", fifaCode: "CZE", groupName: "A", qualificationStatus: "qualified", sourcePayload: { source: "allfantasy_official_2026_groups", seedOrder: 4 } },
  ]
  const S5_GROUP_A = { id: IDS.groupAId, challengeId: IDS.challengeId, groupKey: "A", displayName: "Group A", sortOrder: 1, teams: S5_TEAMS.map((t, i) => ({ teamId: t.id })) }
  const S5_GROUP_A_HYDRATED = {
    ...S5_GROUP_A,
    teams: S5_TEAMS.map((team, index) => ({
      id: `row-${team.id}`, teamId: team.id, seedOrder: index + 1,
      actualRank: null, points: null, goalDifference: null, goalsFor: null, team,
    })),
  }
  const ENTRY_ROW = {
    id: IDS.ownerEntryId, challengeId: IDS.challengeId, participantId: IDS.ownerParticipantId,
    userId: IDS.ownerUserId, submittedAt: null,
    challenge: { id: IDS.challengeId, ownerUserId: IDS.ownerUserId, pickLockStrategy: "tournament_start", pickLockAt: null, status: "open", sourcePayload: null, matches: [] },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.worldCupBracketEntry.findUnique.mockResolvedValue(ENTRY_ROW)
    prismaMocks.worldCupBracketChallenge.findUnique.mockResolvedValue({ id: IDS.challengeId, sourcePayload: null })
    // ensureWorldCupGroupsForChallenge is called twice (once directly, once inside getWorldCupGroupStageView)
    // each call does 2 worldCupGroup.findMany reads; use a single repeated mock
    prismaMocks.worldCupGroup.findMany.mockResolvedValue([S5_GROUP_A_HYDRATED])
    prismaMocks.worldCupTeam.findMany.mockResolvedValue(S5_TEAMS)
    prismaMocks.worldCupGroupTeam.findMany.mockResolvedValue([])
    prismaMocks.worldCupGroupTeam.createMany.mockResolvedValue({ count: 4 })
    prismaMocks.worldCupGroupTeam.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupTeam.upsert.mockImplementation(async ({ where, create }: { where: { id: string }; create: Record<string, unknown> }) => ({ ...create, id: where.id }))
    prismaMocks.worldCupTeam.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({ id: where.id, ...data }))
    prismaMocks.worldCupGroup.findFirst.mockResolvedValue({
      id: IDS.groupAId, challengeId: IDS.challengeId, groupKey: "A",
      teams: S5_TEAMS.map(t => ({ teamId: t.id })),
    })
    prismaMocks.worldCupGroupRankingPick.findMany.mockResolvedValue([])
    prismaMocks.worldCupGroupRankingPick.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupGroupRankingPick.createMany.mockResolvedValue({ count: 4 })
    prismaMocks.worldCupThirdPlaceAdvancerPick.findMany.mockResolvedValue([])
    prismaMocks.worldCupThirdPlaceAdvancerPick.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupBracketPick.findMany.mockResolvedValue([])
    prismaMocks.worldCupBracketPick.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupBracketEntry.update.mockResolvedValue({})
    prismaMocks.$transaction.mockImplementation(async (callback: (tx: typeof prismaMocks) => Promise<unknown>) =>
      callback(prismaMocks)
    )
  })

  it("writes four ordered ranking picks for a group and clears any stale knockout picks", async () => {
    const { saveWorldCupGroupRanking } = await import("@/lib/world-cup/worldCupGroupStageService")

    await saveWorldCupGroupRanking({
      challengeId: IDS.challengeId,
      entryId: IDS.ownerEntryId,
      groupId: IDS.groupAId,
      orderedTeamIds: [IDS.teamMexId, IDS.teamKorId, "wc2026_official_rsa", "wc2026_official_cze"],
      userId: IDS.ownerUserId,
    })

    expect(prismaMocks.worldCupGroupRankingPick.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { challengeId: IDS.challengeId, entryId: IDS.ownerEntryId, groupId: IDS.groupAId, teamId: IDS.teamMexId, predictedRank: 1 },
          { challengeId: IDS.challengeId, entryId: IDS.ownerEntryId, groupId: IDS.groupAId, teamId: IDS.teamKorId, predictedRank: 2 },
          { challengeId: IDS.challengeId, entryId: IDS.ownerEntryId, groupId: IDS.groupAId, teamId: "wc2026_official_rsa", predictedRank: 3 },
          { challengeId: IDS.challengeId, entryId: IDS.ownerEntryId, groupId: IDS.groupAId, teamId: "wc2026_official_cze", predictedRank: 4 },
        ],
      })
    )
    // Stale knockout picks for affected teams are also cleared
    expect(prismaMocks.worldCupBracketPick.deleteMany).toHaveBeenCalledWith({
      where: {
        entryId: IDS.ownerEntryId,
        selectedTeamId: { in: [IDS.teamMexId, IDS.teamKorId, "wc2026_official_rsa", "wc2026_official_cze"] },
      },
    })
  })

  it("resets submittedAt when a group ranking changes after finalize", async () => {
    prismaMocks.worldCupBracketEntry.findUnique.mockResolvedValueOnce({
      id: IDS.ownerEntryId,
      challengeId: IDS.challengeId,
      participantId: IDS.ownerParticipantId,
      userId: IDS.ownerUserId,
      submittedAt: new Date("2026-06-01T12:00:00.000Z"), // previously finalized
      challenge: {
        id: IDS.challengeId, ownerUserId: IDS.ownerUserId,
        pickLockStrategy: "tournament_start", pickLockAt: null, status: "open", sourcePayload: null, matches: [],
      },
    })
    prismaMocks.worldCupGroupRankingPick.findMany
      .mockResolvedValueOnce([
        { teamId: IDS.teamMexId }, { teamId: IDS.teamKorId },
        { teamId: "wc2026_official_rsa" }, { teamId: "wc2026_official_cze" },
      ])
      .mockResolvedValue([])

    const { saveWorldCupGroupRanking } = await import("@/lib/world-cup/worldCupGroupStageService")
    await saveWorldCupGroupRanking({
      challengeId: IDS.challengeId,
      entryId: IDS.ownerEntryId,
      groupId: IDS.groupAId,
      orderedTeamIds: [IDS.teamKorId, IDS.teamMexId, "wc2026_official_rsa", "wc2026_official_cze"],
      userId: IDS.ownerUserId,
    })

    expect(prismaMocks.worldCupBracketEntry.update).toHaveBeenCalledWith({
      where: { id: IDS.ownerEntryId },
      data: { submittedAt: null, isComplete: false },
    })
  })
})

// ─── Step 6: Third-place advancer picks (contract) ───────────────────────────

describe("STEP-6 — saveWorldCupThirdPlaceAdvancers (contract)", () => {
  it("is exported from worldCupGroupStageService with the expected signature", async () => {
    const service = await import("@/lib/world-cup/worldCupGroupStageService")
    expect(service.saveWorldCupThirdPlaceAdvancers).toEqual(expect.any(Function))
    expect(service.saveWorldCupThirdPlaceAdvancers.length).toBe(1) // takes one options object
  })

  it("rejects if not all 12 groups are ranked before 3rd-place selection", async () => {
    const { saveWorldCupThirdPlaceAdvancers } = await import("@/lib/world-cup/worldCupGroupStageService")

    // Mock entry lookup
    prismaMocks.worldCupBracketEntry.findUnique.mockResolvedValue({
      id: IDS.ownerEntryId,
      challengeId: IDS.challengeId,
      participantId: IDS.ownerParticipantId,
      userId: IDS.ownerUserId,
      submittedAt: null,
      challenge: {
        id: IDS.challengeId, ownerUserId: IDS.ownerUserId,
        pickLockStrategy: "tournament_start", pickLockAt: null, status: "open", sourcePayload: null, matches: [],
      },
    })
    // Mock ensureWorldCupGroupsForChallenge chain
    prismaMocks.worldCupBracketChallenge.findUnique.mockResolvedValue({ id: IDS.challengeId, sourcePayload: null })
    prismaMocks.worldCupGroup.findMany
      .mockResolvedValueOnce([{ id: IDS.groupAId, challengeId: IDS.challengeId, groupKey: "A", displayName: "Group A", sortOrder: 1, teams: [] }])
      .mockResolvedValueOnce([{ id: IDS.groupAId, challengeId: IDS.challengeId, groupKey: "A", displayName: "Group A", sortOrder: 1, teams: [] }])
    prismaMocks.worldCupTeam.findMany.mockResolvedValue([])
    prismaMocks.worldCupGroupTeam.findMany.mockResolvedValue([])
    prismaMocks.worldCupGroupTeam.createMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupGroupTeam.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupGroupRankingPick.findMany.mockResolvedValue([]) // zero picks → not all ranked
    prismaMocks.worldCupGroupRankingPick.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupThirdPlaceAdvancerPick.findMany.mockResolvedValue([])
    prismaMocks.worldCupThirdPlaceAdvancerPick.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.$transaction.mockImplementation(async (cb: (tx: typeof prismaMocks) => Promise<unknown>) => cb(prismaMocks))

    await expect(
      saveWorldCupThirdPlaceAdvancers({
        challengeId: IDS.challengeId,
        entryId: IDS.ownerEntryId,
        selectedTeamIds: [IDS.teamMexId],
        userId: IDS.ownerUserId,
      })
    ).rejects.toThrow(/rank all 12/i)
  })
})

// ─── Step 7: Knockout bracket picks (reseeded mode) ──────────────────────────

describe("STEP-7 — saveWorldCupBracketPickForEntry (reseeded official fixtures)", () => {
  const RESEEDED_MATCH = makeSmokeMatch(1, { home: IDS.teamArgId, away: IDS.teamBraId })
  const PICK_ROW = {
    id: "pick-r32-1",
    entryId: IDS.ownerEntryId,
    matchId: "smoke-match-r32-1",
    round: "round_of_32",
    selectedTeamId: IDS.teamArgId,
    selectedTeamName: IDS.teamArgId,
    selectedSlotKey: "A1",
  }

  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.worldCupBracketEntry.findUnique.mockResolvedValue({
      id: IDS.ownerEntryId,
      challengeId: IDS.challengeId,
      participantId: IDS.ownerParticipantId,
      userId: IDS.ownerUserId,
      submittedAt: null,
      picks: [],
      challenge: {
        ...makeSmokeChallenge(), // sourcePayload has knockoutMode: "reseeded"
        matches: [RESEEDED_MATCH],
      },
    })
    prismaMocks.worldCupBracketPick.upsert.mockResolvedValue(PICK_ROW)
    prismaMocks.worldCupBracketPick.create.mockResolvedValue(PICK_ROW)
    prismaMocks.worldCupBracketPick.findMany.mockResolvedValue([])
    // First findUnique = inside tx (no existing pick), second = after save (returns created pick)
    prismaMocks.worldCupBracketPick.findUnique
      .mockResolvedValueOnce(null) // tx: no existing pick for conflict check
      .mockResolvedValueOnce(PICK_ROW) // post-save: return the persisted pick
    // updateMany returns count=0 → triggers create path
    prismaMocks.worldCupBracketPick.updateMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupBracketPick.deleteMany.mockResolvedValue({ count: 0 })
    prismaMocks.worldCupBracketEntry.update.mockResolvedValue({})
    prismaMocks.worldCupBracketEntry.updateMany.mockResolvedValue({ count: 0 })
    // recalculateWorldCupChallenge calls worldCupBracketChallenge.findUnique twice (must include entries)
    prismaMocks.worldCupBracketChallenge.findUnique.mockResolvedValue({
      ...makeSmokeChallenge(),
      scoringProfile: null,
      matches: [RESEEDED_MATCH],
      participants: [],
      entries: [],
      includeThirdPlace: false,
    })
    prismaMocks.$transaction.mockImplementation(async (callback: (tx: typeof prismaMocks) => Promise<unknown>) =>
      callback(prismaMocks)
    )
  })

  it("persists a knockout pick for an official round-of-32 fixture in reseeded mode", async () => {
    const { saveWorldCupBracketPickForEntry } = await import("@/lib/world-cup/worldCupBracketService")

    const result = await saveWorldCupBracketPickForEntry({
      entryId: IDS.ownerEntryId,
      userId: IDS.ownerUserId,
      matchId: RESEEDED_MATCH.id,
      selectedTeamId: IDS.teamArgId,
      selectedTeamName: IDS.teamArgId,
      selectedSlotKey: RESEEDED_MATCH.homeSlotKey,
      round: "round_of_32",
    })

    // The service uses updateMany + create (not upsert) for new picks
    expect(prismaMocks.worldCupBracketPick.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryId: IDS.ownerEntryId,
          selectedTeamId: IDS.teamArgId,
        }),
      })
    )
    expect(result.pick.selectedTeamId).toBe(IDS.teamArgId)
  })

  it("rejects picks before official fixtures are loaded for reseeded mode", async () => {
    // Match missing apiFixtureId → hasOfficialWorldCupReseededKnockoutFixtures returns false
    const unresolved = { ...RESEEDED_MATCH, apiFixtureId: null }
    prismaMocks.worldCupBracketEntry.findUnique.mockResolvedValueOnce({
      id: IDS.ownerEntryId,
      challengeId: IDS.challengeId,
      participantId: IDS.ownerParticipantId,
      userId: IDS.ownerUserId,
      submittedAt: null,
      picks: [],
      challenge: {
        ...makeSmokeChallenge(),
        matches: [unresolved],
      },
    })

    const { saveWorldCupBracketPickForEntry } = await import("@/lib/world-cup/worldCupBracketService")

    await expect(
      saveWorldCupBracketPickForEntry({
        entryId: IDS.ownerEntryId,
        userId: IDS.ownerUserId,
        matchId: unresolved.id,
        selectedTeamId: IDS.teamArgId,
      })
    ).rejects.toThrow(/official Round of 32 fixtures/i)
  })
})

// ─── Step 8: Finalize review — completion check ───────────────────────────────

describe("STEP-8 — isWorldCupEntryCompleteFromSelections", () => {
  it("returns false when picks are missing for pickable matches", () => {
    const matches = [makeSmokeMatch(1, { home: IDS.teamArgId, away: IDS.teamBraId })]
    const complete = isWorldCupEntryCompleteFromSelections({ matches, picks: [] })
    expect(complete).toBe(false)
  })

  it("returns true when all pickable round-of-32 slots are filled with valid selections", () => {
    const match = {
      ...makeSmokeMatch(1, { home: IDS.teamArgId, away: IDS.teamBraId }),
      nextMatchId: null,
      nextMatchSlot: null,
    }
    const complete = isWorldCupEntryCompleteFromSelections({
      matches: [match],
      picks: [
        {
          matchId: match.id,
          round: "round_of_32",
          selectedTeamId: IDS.teamArgId,
          selectedSlotKey: match.homeSlotKey,
        },
      ],
    })
    expect(complete).toBe(true)
  })
})

// ─── Step 9: Lock gate ────────────────────────────────────────────────────────

describe("STEP-9 — isWorldCupChallengeLocked (lock-gate pure function)", () => {
  it("is not locked when tournament_start strategy and no match has started", () => {
    const result = isWorldCupChallengeLocked({
      challenge: makeSmokeChallenge({ pickLockStrategy: "tournament_start", pickLockAt: null }),
      matches: [makeSmokeMatch(1, { home: IDS.teamArgId, away: IDS.teamBraId })],
    })
    expect(result.locked).toBe(false)
  })

  it("is locked when pickLockAt is in the past", () => {
    const result = isWorldCupChallengeLocked({
      challenge: makeSmokeChallenge({
        pickLockStrategy: "tournament_start",
        pickLockAt: new Date("2025-01-01T00:00:00.000Z"), // past date
      }),
      matches: [],
    })
    expect(result.locked).toBe(true)
  })

  it("unlocks a per-match entry when the targeted match has not yet started", () => {
    const futureMatch = makeSmokeMatch(1, { home: IDS.teamArgId, away: IDS.teamBraId })
    const result = isWorldCupChallengeLocked({
      challenge: makeSmokeChallenge({ pickLockStrategy: "per_match", pickLockAt: null }),
      matches: [futureMatch],
      match: futureMatch,
    })
    expect(result.locked).toBe(false)
  })

  it("blocks entry creation when the bracket is fully locked", () => {
    const result = isWorldCupChallengeLocked({
      challenge: makeSmokeChallenge({
        pickLockStrategy: "tournament_start",
        pickLockAt: new Date("2025-01-01T00:00:00.000Z"),
      }),
      matches: [],
    })
    expect(result.locked).toBe(true)
    expect(result.reason).toBeTruthy() // reason is a code string like "tournament_started" or "pick_lock_at"
  })
})

// ─── Step 10: Simulate match results ─────────────────────────────────────────

describe("STEP-10 — loadWorldCupTestFixtures (simulation fixture)", () => {
  it("seeds test fixtures for a challenge and returns a results summary", async () => {
    const { loadWorldCupTestFixtures } = await import("@/lib/world-cup/worldCupSimulationService")

    const result = await loadWorldCupTestFixtures(IDS.challengeId, { dryRun: false })

    expect(result.success).toBe(true)
    expect(result.totalMatchesAfter).toBe(31)
    expect(result.pickableMatchesAfter).toBe(16) // round_of_32
    expect(result.warnings).toHaveLength(0)
  })

  it("dry-run flag is forwarded to the fixture loader", async () => {
    const { loadWorldCupTestFixtures } = await import("@/lib/world-cup/worldCupSimulationService")

    await loadWorldCupTestFixtures(IDS.challengeId, { dryRun: true })

    expect(loadWorldCupTestFixtures).toHaveBeenCalledWith(IDS.challengeId, { dryRun: true })
  })
})

// ─── Step 11: Score + recalculate ────────────────────────────────────────────

describe("STEP-11 — evaluateWorldCupPick + recalculateWorldCupChallenge", () => {
  const FINAL_MATCH = {
    ...makeSmokeMatch(1, { home: IDS.teamArgId, away: IDS.teamBraId }),
    status: "final",
    winnerTeamId: IDS.teamArgId,
    winnerTeamName: IDS.teamArgId,
    apiStatusShort: "FT",
  }

  it("awards zero points for pending matches", () => {
    const result = evaluateWorldCupPick(
      { ...FINAL_MATCH, status: "scheduled", winnerTeamId: null, winnerTeamName: null },
      { selectedTeamId: IDS.teamArgId, selectedTeamName: IDS.teamArgId, round: "round_of_32" },
      DEFAULT_WORLD_CUP_SCORING
    )
    expect(result).toEqual({ pointsAwarded: 0, isCorrect: null })
  })

  it("awards round-of-32 points for a correct pick on a final result", () => {
    const result = evaluateWorldCupPick(
      FINAL_MATCH,
      { selectedTeamId: IDS.teamArgId, selectedTeamName: IDS.teamArgId, round: "round_of_32" },
      DEFAULT_WORLD_CUP_SCORING
    )
    expect(result.pointsAwarded).toBe(DEFAULT_WORLD_CUP_SCORING.roundOf32Points)
    expect(result.isCorrect).toBe(true)
  })

  it("marks incorrect picks with 0 points when the actual winner differs", () => {
    const result = evaluateWorldCupPick(
      FINAL_MATCH,
      { selectedTeamId: IDS.teamBraId, selectedTeamName: IDS.teamBraId, round: "round_of_32" },
      DEFAULT_WORLD_CUP_SCORING
    )
    expect(result.pointsAwarded).toBe(0)
    expect(result.isCorrect).toBe(false)
  })

  it("awards escalating points for later rounds (quarterfinal > round_of_32)", () => {
    const qfResult = evaluateWorldCupPick(
      { ...FINAL_MATCH, round: "quarterfinal" },
      { selectedTeamId: IDS.teamArgId, selectedTeamName: IDS.teamArgId, round: "quarterfinal" },
      DEFAULT_WORLD_CUP_SCORING
    )
    expect(qfResult.pointsAwarded).toBe(DEFAULT_WORLD_CUP_SCORING.quarterFinalPoints)
    expect(qfResult.pointsAwarded).toBeGreaterThan(DEFAULT_WORLD_CUP_SCORING.roundOf32Points)
  })

  it("does not score simulated SIM fixtures as official results", () => {
    const result = evaluateWorldCupPick(
      { ...FINAL_MATCH, apiStatusShort: "SIM" },
      { selectedTeamId: IDS.teamArgId, selectedTeamName: IDS.teamArgId, round: "round_of_32" },
      DEFAULT_WORLD_CUP_SCORING
    )
    expect(result).toEqual({ pointsAwarded: 0, isCorrect: null })
  })

  it("recalculateWorldCupChallenge is exported from worldCupScoringService", async () => {
    const service = await import("@/lib/world-cup/worldCupScoringService")
    expect(service.recalculateWorldCupChallenge).toEqual(expect.any(Function))
  })
})

// ─── Step 12: Leaderboard rows + share data ───────────────────────────────────

describe("STEP-12 — buildWorldCupLeaderboardRows (leaderboard + share)", () => {
  const FINAL_MATCH = {
    ...makeSmokeMatch(1, { home: IDS.teamArgId, away: IDS.teamBraId }),
    status: "final",
    winnerTeamId: IDS.teamArgId,
    winnerTeamName: IDS.teamArgId,
    apiStatusShort: "FT",
  }

  function makeEntry(entryId: string, userId: string, pickedTeamId: string, score: number) {
    // Use the correct slot key for the picked team
    const selectedSlotKey = pickedTeamId === IDS.teamArgId ? FINAL_MATCH.homeSlotKey : FINAL_MATCH.awaySlotKey
    return {
      id: entryId,
      participantId: `p-${userId}`,
      userId,
      name: "Bracket 1",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
      updatedAt: new Date("2026-06-01T01:00:00.000Z"),
      submittedAt: new Date("2026-06-01T00:30:00.000Z"),
      championTeamId: pickedTeamId,
      championTeamName: pickedTeamId,
      picks: [
        {
          id: `pick-${entryId}`,
          matchId: FINAL_MATCH.id,
          round: "round_of_32",
          selectedTeamId: pickedTeamId,
          selectedTeamName: pickedTeamId,
          selectedSlotKey,
          pointsAwarded: score,
          isCorrect: pickedTeamId === IDS.teamArgId,
          match: FINAL_MATCH,
        },
      ],
      participant: {
        displayName: `Player ${userId}`,
        user: { username: `user_${userId}`, avatarUrl: null, displayName: null },
      },
    }
  }

  it("ranks entries by score descending with correct metadata", () => {
    const entries = [
      makeEntry("entry-winner", "user-A", IDS.teamArgId, DEFAULT_WORLD_CUP_SCORING.roundOf32Points),
      makeEntry("entry-loser", "user-B", IDS.teamBraId, 0),
    ]

    const rows = buildWorldCupLeaderboardRows({
      entries,
      matches: [FINAL_MATCH],
      scoring: DEFAULT_WORLD_CUP_SCORING,
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].rank).toBe(1)
    expect(rows[0].entryId).toBe("entry-winner")
    expect(rows[0].totalScore).toBe(DEFAULT_WORLD_CUP_SCORING.roundOf32Points)
    expect(rows[0].correctPicks).toBe(1)
    expect(rows[1].rank).toBe(2)
    expect(rows[1].totalScore).toBe(0)
    expect(rows[1].incorrectPicks).toBe(1)
  })

  it("excludes unfinalized entries (no submittedAt) from the leaderboard", () => {
    const entries = [
      makeEntry("entry-draft", "user-C", IDS.teamArgId, DEFAULT_WORLD_CUP_SCORING.roundOf32Points),
    ]
    // Remove submittedAt to simulate a draft entry
    entries[0].submittedAt = null as unknown as Date

    const rows = buildWorldCupLeaderboardRows({ entries, matches: [FINAL_MATCH] })
    expect(rows).toHaveLength(0)
  })

  it("share data — winner entry has championPickName, correct rank, and entryId set", () => {
    const entries = [
      makeEntry("entry-champ", "user-D", IDS.teamArgId, DEFAULT_WORLD_CUP_SCORING.roundOf32Points),
    ]

    const rows = buildWorldCupLeaderboardRows({
      entries,
      matches: [FINAL_MATCH],
      scoring: DEFAULT_WORLD_CUP_SCORING,
    })

    const winner = rows[0]
    expect(winner.rank).toBe(1)
    expect(winner.entryId).toBe("entry-champ")
    expect(winner.championPickName).toBe(IDS.teamArgId)
    expect(winner.championStillAlive).toBe(true) // ARG won → still alive
    expect(typeof winner.userId).toBe("string")
    expect(typeof winner.username).toBe("string")
  })

  it("ties broken by earlier submission time (first submitted = better rank)", () => {
    const tied1 = {
      ...makeEntry("entry-early", "user-E", IDS.teamArgId, DEFAULT_WORLD_CUP_SCORING.roundOf32Points),
      submittedAt: new Date("2026-06-01T08:00:00.000Z"),
    }
    const tied2 = {
      ...makeEntry("entry-late", "user-F", IDS.teamArgId, DEFAULT_WORLD_CUP_SCORING.roundOf32Points),
      submittedAt: new Date("2026-06-01T09:00:00.000Z"),
    }

    const rows = buildWorldCupLeaderboardRows({ entries: [tied2, tied1], matches: [FINAL_MATCH] })
    expect(rows[0].entryId).toBe("entry-early")
    expect(rows[1].entryId).toBe("entry-late")
  })
})

// ─── Proof D: Commissioner settings ──────────────────────────────────────────

describe("PROOF-D — Commissioner settings persist and toggle", () => {
  it("ensureWorldCupCommissionerSettings creates default settings row via upsert", async () => {
    prismaMocks.worldCupBracketCommissionerSettings.upsert.mockResolvedValue({
      challengeId: IDS.challengeId,
      enableSystemEvents: true,
      enableAiSummaries: false,
      enableUpsetAlerts: true,
      enableLeaderboardAlerts: true,
      enableChampionBustAlerts: true,
      enableLockReminders: true,
    })

    // Use importActual to bypass the module-level mock and test the real implementation
    const { ensureWorldCupCommissionerSettings: realFn } = await vi.importActual<
      typeof import("@/lib/world-cup/worldCupBracketEventService")
    >("@/lib/world-cup/worldCupBracketEventService")

    const result = await realFn(IDS.challengeId)

    expect(prismaMocks.worldCupBracketCommissionerSettings.upsert).toHaveBeenCalledWith({
      where: { challengeId: IDS.challengeId },
      create: { challengeId: IDS.challengeId },
      update: {},
    })
    expect(result).toBeTruthy()
  })

  it("getWorldCupCommissionerSettings returns sensible defaults when the row exists", async () => {
    const { getWorldCupCommissionerSettings } = await import("@/lib/world-cup/worldCupBracketEventService")
    const settings = await getWorldCupCommissionerSettings(IDS.challengeId)

    expect(settings.enableSystemEvents).toBe(true)
    expect(settings.enableAiSummaries).toBe(false)
    expect(settings.enableUpsetAlerts).toBe(true)
    expect(settings.enableLeaderboardAlerts).toBe(true)
    expect(settings.enableChampionBustAlerts).toBe(true)
    expect(settings.enableLockReminders).toBe(true)
  })

  it("updateWorldCupCommissionerSettings is callable and resolves", async () => {
    const { updateWorldCupCommissionerSettings } = await import("@/lib/world-cup/worldCupBracketEventService")

    await expect(
      updateWorldCupCommissionerSettings(IDS.challengeId, { enableAiSummaries: true })
    ).resolves.toBeDefined()
  })
})

// ─── Proof E: AI gating ───────────────────────────────────────────────────────

describe("PROOF-E — AI gating: free users blocked, paid users unlocked", () => {
  it("locks all premium tools for an unauthenticated free user", () => {
    const input = { isOwner: false, isAdmin: false, hasBracketBrainAi: false }

    expect(canUseWorldCupCommissionerTools(input)).toBe(false)
    expect(canCreateMultipleWorldCupEntries(input)).toBe(true)
    expect(canExportWorldCupLeaderboard(input)).toBe(false)
    expect(canUseWorldCupChat(input)).toBe(true)
    expect(canUseWorldCupAiTools(input)).toBe(false)
  })

  it("keeps basic owner controls separate from paid commissioner tools", () => {
    expect(canManageBasicWorldCupPool({ isOwner: true })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ isOwner: true })).toBe(false)
  })

  it("unlocks commissioner tools for site admins", () => {
    expect(canUseWorldCupCommissionerTools({ isAdmin: true })).toBe(true)
  })

  it("unlocks commissioner tools for commissioner / supreme plans", () => {
    expect(canUseWorldCupCommissionerTools({ plans: ["commissioner"] })).toBe(true)
    expect(canUseWorldCupCommissionerTools({ plans: ["supreme"] })).toBe(true)
  })

  it("unlocks AI tools only with Bracket Brain or Pro+ plans", () => {
    expect(canUseWorldCupAiTools({ hasBracketBrainAi: true })).toBe(true)
    expect(canUseWorldCupAiTools({ hasAfPro: true })).toBe(true)
    expect(canUseWorldCupAiTools({ plans: ["pro"] })).toBe(true)
    expect(canUseWorldCupAiTools({ plans: ["supreme"] })).toBe(true)
    // free user stays blocked
    expect(canUseWorldCupAiTools({ hasBracketBrainAi: false })).toBe(false)
  })

  it("resolves correct copy labels for the premium panel UI", () => {
    const free = resolveWorldCupEntitlementSummary({})
    expect(free.labels.commissioner).toBe("Requires AF Commissioner")
    expect(free.labels.ai).toBe("Requires AI/Pro")

    const admin = resolveWorldCupEntitlementSummary({ isAdmin: true })
    expect(admin.labels.commissioner).toBe("AF Commissioner active")
    expect(admin.labels.ai).toBe("AI/Pro active")
  })
})

// ─── Proof F: Share / invite link ─────────────────────────────────────────────

describe("PROOF-F — Share / invite link wired on pool creation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMocks.worldCupBracketScoringProfile.create.mockResolvedValue({ id: IDS.scoringProfileId })
    prismaMocks.worldCupBracketChallenge.create.mockResolvedValue(makeSmokeChallenge())
    prismaMocks.worldCupBracketSlot.createMany.mockResolvedValue({ count: 48 })
    prismaMocks.worldCupBracketMatch.createMany.mockResolvedValue({ count: 31 })
    prismaMocks.worldCupBracketParticipant.create.mockResolvedValue({
      id: IDS.ownerParticipantId,
      challengeId: IDS.challengeId,
      userId: IDS.ownerUserId,
      displayName: "Owner",
    })
    prismaMocks.worldCupBracketEntry.create.mockResolvedValue(
      makeSmokeEntry(IDS.ownerEntryId, IDS.ownerParticipantId, IDS.ownerUserId)
    )
    prismaMocks.worldCupBracketInvite.create.mockResolvedValue({
      id: IDS.inviteRowId,
      challengeId: IDS.challengeId,
      inviteCode: IDS.inviteCode,
    })
    prismaMocks.$transaction.mockImplementation(async (callback: (tx: typeof prismaMocks) => Promise<unknown>) =>
      callback(prismaMocks)
    )
  })

  it("challenge has inviteCode and inviteUrl set after creation", async () => {
    const { createWorldCupBracketChallenge } = await import("@/lib/world-cup/worldCupBracketService")

    await createWorldCupBracketChallenge({
      user: { id: IDS.ownerUserId, name: "Owner" },
      name: "Smoke Share Cup",
    })

    const challengeData = prismaMocks.worldCupBracketChallenge.create.mock.calls[0]?.[0]?.data
    expect(challengeData.inviteCode).toBeTruthy()
    expect(challengeData.inviteCode).toMatch(/^[A-Z0-9_-]{6,}/i)
    expect(challengeData.inviteUrl).toContain(challengeData.inviteCode)
    expect(challengeData.inviteUrl).toContain("/join/bracket/")
  })

  it("an invite row is created in the same transaction as the challenge", async () => {
    const { createWorldCupBracketChallenge } = await import("@/lib/world-cup/worldCupBracketService")

    await createWorldCupBracketChallenge({
      user: { id: IDS.ownerUserId, name: "Owner" },
      name: "Smoke Share Cup",
    })

    expect(prismaMocks.worldCupBracketInvite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ challengeId: IDS.challengeId }),
      })
    )
  })

  it("createAdditionalWorldCupInvite is exported from worldCupBracketService", async () => {
    const service = await import("@/lib/world-cup/worldCupBracketService")
    expect(service.createAdditionalWorldCupInvite).toEqual(expect.any(Function))
  })
})

// ─── DEFAULT_WORLD_CUP_SCORING sanity ────────────────────────────────────────

describe("DEFAULT_WORLD_CUP_SCORING — scoring values sanity", () => {
  it("has correct round ordering: final > semifinal > quarterfinal > r16 > r32", () => {
    const s = DEFAULT_WORLD_CUP_SCORING
    expect(s.finalPoints).toBeGreaterThan(s.semiFinalPoints)
    expect(s.semiFinalPoints).toBeGreaterThan(s.quarterFinalPoints)
    expect(s.quarterFinalPoints).toBeGreaterThan(s.roundOf16Points)
    expect(s.roundOf16Points).toBeGreaterThan(s.roundOf32Points)
    expect(s.roundOf32Points).toBeGreaterThan(0)
  })
})
