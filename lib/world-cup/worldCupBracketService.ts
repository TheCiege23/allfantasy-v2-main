import "server-only"
import crypto from "crypto"
import type { Prisma } from "@prisma/client"
import type { WorldCupBracketChallenge, WorldCupBracketEntry, WorldCupBracketMatch, WorldCupBracketParticipant, WorldCupBracketPick } from "@prisma/client"
import { isAdminEmailAllowed } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"
import { userHasBracketBrainAi } from "@/lib/bracket-brain/bracketBrainAccess"
import { WORLD_CUP_TOURNAMENT_KEY, type WorldCupChallengeView, type WorldCupMatchView, type WorldCupPickView } from "./types"
import {
  DEFAULT_WORLD_CUP_SCORING,
  generateWorldCupBracketTemplate,
  isWorldCupBracketChallengePicksLocked,
  isWorldCupChallengeLocked,
  isWorldCupMatchLocked,
  resolveWorldCupEffectivePickLockAt,
} from "./worldCupBracketBuilder"
import {
  buildWorldCupLeaderboardRows,
  isWorldCupEntryCompleteFromSelections,
  recalculateWorldCupChallenge,
} from "./worldCupScoringService"
import { ensureWorldCupCommissionerSettings } from "./worldCupBracketEventService"
import {
  getWorldCupJoinPasswordHashFromPayload,
  hashWorldCupJoinPassword,
  parseWorldCupLeagueSettings,
} from "./worldCupBracketSettingsService"
import {
  emitWorldCupChallengeCreated,
  emitWorldCupBracketCompleted,
  emitWorldCupEntryCreated,
  emitWorldCupUserJoined,
} from "./worldCupBracketLifecycleEvents"
import {
  buildWorldCupProjectedMatches,
  findWorldCupPickForMatch,
  getWorldCupPickMatchMethod,
  getWorldCupProjectedMatchTeams,
  hasWorldCupPickSelection,
  isWorldCupMatchPickable,
} from "./worldCupProjectedBracket"

type SessionUser = { id?: string | null; email?: string | null; name?: string | null }

export const WORLD_CUP_BRACKET_LOCKED_MESSAGE = "Bracket is locked."

const iso = (v: Date | string | null | undefined) => (v ? (v instanceof Date ? v.toISOString() : new Date(v).toISOString()) : null)

function toWorldCupMatchView(match: WorldCupBracketMatch): WorldCupMatchView {
  return {
    id: match.id,
    apiFixtureId: match.apiFixtureId,
    round: match.round as WorldCupMatchView["round"],
    roundIndex: match.roundIndex,
    matchNumber: match.matchNumber,
    homeSlotKey: match.homeSlotKey,
    awaySlotKey: match.awaySlotKey,
    homeTeamId: match.homeTeamId,
    awayTeamId: match.awayTeamId,
    homeTeamName: match.homeTeamName,
    awayTeamName: match.awayTeamName,
    homeTeamLogo: match.homeTeamLogo,
    awayTeamLogo: match.awayTeamLogo,
    homeScore: match.homeScore,
    awayScore: match.awayScore,
    homePenaltyScore: match.homePenaltyScore,
    awayPenaltyScore: match.awayPenaltyScore,
    status: match.status as WorldCupMatchView["status"],
    startsAt: iso(match.startsAt),
    winnerTeamId: match.winnerTeamId,
    winnerTeamName: match.winnerTeamName,
    nextMatchId: match.nextMatchId,
    nextMatchSlot: match.nextMatchSlot === "home" || match.nextMatchSlot === "away" ? match.nextMatchSlot : null,
    elapsedMinute: match.elapsedMinute,
    injuryTime: match.injuryTime,
    period: match.period,
    venueName: match.venueName,
    venueCity: match.venueCity,
    apiStatusShort: match.apiStatusShort,
    lastScoreSyncedAt: iso(match.lastScoreSyncedAt),
  }
}

function toWorldCupPickView(pick: WorldCupBracketPick & { match?: WorldCupBracketMatch | null }): WorldCupPickView {
  return {
    id: pick.id,
    matchId: pick.matchId,
    matchNumber: pick.match?.matchNumber ?? null,
    round: pick.round as WorldCupPickView["round"],
    selectedTeamId: pick.selectedTeamId,
    selectedSlotKey: pick.selectedSlotKey,
    selectedTeamName: pick.selectedTeamName,
    pointsAwarded: pick.pointsAwarded,
    isCorrect: pick.isCorrect,
    lockedAt: iso(pick.lockedAt),
  }
}

/**
 * Applies `buildWorldCupProjectedMatches` so knockout rounds show user-projected teams
 * (semis/final) instead of DB placeholder labels.
 */
export function resolveWorldCupMatchViewWithEntryProjections(input: {
  challengeMatches: WorldCupBracketMatch[]
  entryPicks: (WorldCupBracketPick & { match?: WorldCupBracketMatch | null })[]
  matchId: string
}): WorldCupMatchView | null {
  const matchViews = input.challengeMatches.map(toWorldCupMatchView)
  const existingPicks = input.entryPicks.filter(hasWorldCupPickSelection).map(toWorldCupPickView)
  const projected = buildWorldCupProjectedMatches(matchViews, existingPicks)
  return projected.find((m) => m.id === input.matchId) ?? null
}

function readSimulationFlags(sourcePayload: unknown): {
  isTestMode: boolean
  simulationEnabled: boolean
  simulatedAt: string | null
  simulationStatus: string | null
} {
  const payload = sourcePayload as {
    simulation?: {
      isTestMode?: boolean
      simulationEnabled?: boolean
      simulatedAt?: string | null
      simulationStatus?: string | null
    }
  } | null

  const simulation = payload?.simulation
  return {
    isTestMode: Boolean(simulation?.isTestMode),
    simulationEnabled: Boolean(simulation?.simulationEnabled),
    simulatedAt: typeof simulation?.simulatedAt === "string" ? simulation.simulatedAt : null,
    simulationStatus: typeof simulation?.simulationStatus === "string" ? simulation.simulationStatus : null,
  }
}

function serializeWorldCupCreateError(error: unknown) {
  const value = error as {
    name?: string
    message?: string
    code?: string
    meta?: unknown
  }

  return {
    name: value?.name ?? "Error",
    message: value?.message ?? "Unknown error",
    code: typeof value?.code === "string" ? value.code : null,
    meta: value?.meta ?? null,
  }
}

function shouldSeedWorldCupTestFixturesOnCreate(input: {
  isTestMode?: boolean
  simulationEnabled?: boolean
  seedTestFixtures?: boolean
}) {
  return Boolean(
    input.seedTestFixtures ||
      input.isTestMode ||
      input.simulationEnabled ||
      process.env.WORLD_CUP_SEED_TEST_FIXTURES_ON_CREATE === "true"
  )
}

function buildWorldCupCreateSourcePayload(input: {
  isTestMode: boolean
  simulationEnabled: boolean
  seedTestFixtures: boolean
}): Prisma.JsonObject | undefined {
  if (!input.isTestMode && !input.simulationEnabled && !input.seedTestFixtures) {
    return undefined
  }
  return {
    simulation: {
      isTestMode: input.isTestMode || input.seedTestFixtures,
      simulationEnabled: input.simulationEnabled,
      testFixturesOnCreate: input.seedTestFixtures,
      fixtureTemplate: input.seedTestFixtures ? "mock_round_of_32" : "slot_template",
    },
  }
}

async function createWorldCupBracketTemplateRows(
  tx: Prisma.TransactionClient,
  input: {
    challengeId: string
    includeThirdPlace?: boolean | null
    createSlots?: boolean
  }
) {
  const template = generateWorldCupBracketTemplate({
    includeThirdPlace: Boolean(input.includeThirdPlace),
  })
  if (input.createSlots !== false) {
    await tx.worldCupBracketSlot.createMany({
      data: template.slots.map((s) => ({ challengeId: input.challengeId, ...s })),
    })
  }

  const ids = new Map<number, string>()
  template.matches.forEach((m) => ids.set(m.matchNumber, crypto.randomUUID()))
  const requireMatchId = (matchNumber: number): string => {
    const id = ids.get(matchNumber)
    if (!id) throw new Error(`Missing generated match id for match ${matchNumber}`)
    return id
  }

  await tx.worldCupBracketMatch.createMany({
    data: template.matches.map((m) => ({
      id: requireMatchId(m.matchNumber),
      challengeId: input.challengeId,
      round: m.round,
      roundIndex: m.roundIndex,
      matchNumber: m.matchNumber,
      homeSlotKey: m.homeSlotKey,
      awaySlotKey: m.awaySlotKey,
      homeTeamName: m.homeTeamName,
      awayTeamName: m.awayTeamName,
      nextMatchId: m.nextMatchNumber ? ids.get(m.nextMatchNumber) ?? null : null,
      nextMatchSlot: m.nextMatchSlot ?? null,
    })),
  })

  return {
    slotCount: template.slots.length,
    matchCount: template.matches.length,
  }
}

export async function ensureWorldCupBracketFixtureTemplate(challengeId: string) {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      includeThirdPlace: true,
      _count: { select: { slots: true, matches: true } },
    },
  })
  if (!challenge) throw new Error("Challenge not found")
  if (challenge._count.matches > 0) {
    return {
      created: false,
      slotCount: challenge._count.slots,
      matchCount: challenge._count.matches,
    }
  }

  const created = await prisma.$transaction(async (tx) =>
    createWorldCupBracketTemplateRows(tx, {
      challengeId: challenge.id,
      includeThirdPlace: challenge.includeThirdPlace,
      createSlots: challenge._count.slots === 0,
    })
  )

  return { created: true, ...created }
}

export function getWorldCupAppBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(/\/$/, "")
}

export async function generateWorldCupInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  for (let a = 0; a < 12; a++) {
    let out = "WC"
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)]
    const clash = await prisma.worldCupBracketChallenge.findUnique({ where: { inviteCode: out }, select: { id: true } })
    if (!clash) return out
  }
  return `WC${crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`
}

async function displayName(user: SessionUser) {
  if (user.name?.trim()) return user.name.trim()
  if (user.email) return user.email.split("@")[0]
  if (!user.id) return "Bracket Manager"
  const u = await prisma.appUser.findUnique({
    where: { id: user.id },
    select: { displayName: true, username: true, email: true },
  })
  return u?.displayName || u?.username || u?.email?.split("@")[0] || "Bracket Manager"
}

export function userCanManageWorldCupChallenge(i: { userId?: string | null; userEmail?: string | null; ownerUserId?: string | null; isAdmin?: boolean }) {
  return Boolean(i.isAdmin || (i.userId && i.ownerUserId && i.userId === i.ownerUserId) || isAdminEmailAllowed(i.userEmail))
}

export async function createWorldCupBracketChallenge(input: {
  user: SessionUser
  name: string
  seasonYear?: number
  visibility?: "public" | "private"
  pickLockStrategy?: "per_match" | "tournament_start"
  pickLockAt?: Date | null
  includeThirdPlace?: boolean
  maxParticipants?: number
  maxEntriesPerParticipant?: number
  scoring?: Partial<typeof DEFAULT_WORLD_CUP_SCORING>
  isTestMode?: boolean
  simulationEnabled?: boolean
  seedTestFixtures?: boolean
}) {
  if (!input.user.id) throw new Error("Authenticated user required")
  const userId = input.user.id
  const inviteCode = await generateWorldCupInviteCode()
  const inviteUrl = `${getWorldCupAppBaseUrl()}/join/bracket/${inviteCode}`
  const template = generateWorldCupBracketTemplate({ includeThirdPlace: input.includeThirdPlace })
  const ownerDisplay = await displayName(input.user)
  const maxParticipants = input.maxParticipants ?? 100
  const maxEntriesPerParticipant = input.maxEntriesPerParticipant ?? 5
  const seedTestFixtures = shouldSeedWorldCupTestFixturesOnCreate(input)

  console.info("[world-cup/create] normalized create data", {
    userId,
    seasonYear: input.seasonYear ?? 2026,
    visibility: input.visibility ?? "private",
    pickLockStrategy: input.pickLockStrategy ?? "tournament_start",
    pickLockAt: input.pickLockAt?.toISOString() ?? null,
    includeThirdPlace: Boolean(input.includeThirdPlace),
    maxParticipants,
    maxEntriesPerParticipant,
    isTestMode: Boolean(input.isTestMode),
    simulationEnabled: Boolean(input.simulationEnabled),
    seedTestFixtures,
    slotCount: template.slots.length,
    matchCount: template.matches.length,
  })

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      console.info("[world-cup/create] step before scoring profile create", { userId })
      const scoringProfile = await tx.worldCupBracketScoringProfile.create({
        data: { name: "World Cup Standard", ...DEFAULT_WORLD_CUP_SCORING, ...(input.scoring ?? {}) },
      })

      console.info("[world-cup/create] step before challenge create", { userId, scoringProfileId: scoringProfile.id })
      const challenge = await tx.worldCupBracketChallenge.create({
        data: {
          name: input.name,
          ownerUserId: userId,
          seasonYear: input.seasonYear ?? 2026,
          tournamentKey: WORLD_CUP_TOURNAMENT_KEY,
          inviteCode,
          inviteUrl,
          visibility: input.visibility ?? "private",
          pickLockStrategy: input.pickLockStrategy ?? "tournament_start",
          pickLockAt: input.pickLockAt ?? null,
          maxParticipants,
          maxEntriesPerParticipant,
          scoringProfileId: scoringProfile.id,
          status: "open",
          includeThirdPlace: Boolean(input.includeThirdPlace),
          sourcePayload: buildWorldCupCreateSourcePayload({
            isTestMode: Boolean(input.isTestMode),
            simulationEnabled: Boolean(input.simulationEnabled),
            seedTestFixtures,
          }),
        },
      })

      console.info("[world-cup/create] step before slots/matches create", {
        challengeId: challenge.id,
        slotCount: template.slots.length,
        matchCount: template.matches.length,
      })
      await createWorldCupBracketTemplateRows(tx, {
        challengeId: challenge.id,
        includeThirdPlace: input.includeThirdPlace,
      })

      console.info("[world-cup/create] step before participant create", { challengeId: challenge.id, userId })
      const participant = await tx.worldCupBracketParticipant.create({
        data: { challengeId: challenge.id, userId, displayName: ownerDisplay },
      })

      console.info("[world-cup/create] step before default entry create", {
        challengeId: challenge.id,
        participantId: participant.id,
        userId,
      })
      await tx.worldCupBracketEntry.create({
        data: {
          challengeId: challenge.id,
          participantId: participant.id,
          userId,
          name: "Bracket 1",
        },
      })

      console.info("[world-cup/create] step before invite create", { challengeId: challenge.id, userId })
      await tx.worldCupBracketInvite.create({ data: { challengeId: challenge.id, inviteCode, createdByUserId: userId } })
      return { challenge, participant }
    })

    await ensureWorldCupCommissionerSettings(result.challenge.id)
    let fixtureSeed: { success: boolean; matchesUpdated: number; warnings: string[] } | null = null
    if (seedTestFixtures) {
      const { loadWorldCupTestFixtures } = await import("./worldCupSimulationService")
      fixtureSeed = await loadWorldCupTestFixtures(result.challenge.id, {
        dryRun: false,
      })
      if (!fixtureSeed.success) {
        console.warn("[world-cup/create] test fixture seed failed", {
          challengeId: result.challenge.id,
          warnings: fixtureSeed.warnings,
        })
      }
    }
    emitWorldCupChallengeCreated(result.challenge.id, input.name)
    const firstEntry = await prisma.worldCupBracketEntry.findFirst({
      where: { challengeId: result.challenge.id, userId },
      orderBy: { createdAt: "asc" },
    })
    if (firstEntry) {
      emitWorldCupEntryCreated(
        result.challenge.id,
        firstEntry.id,
        userId,
        firstEntry.name
      )
    }

    return {
      challengeId: result.challenge.id,
      participantId: result.participant.id,
      inviteCode,
      inviteUrl,
      fixturesSeeded: Boolean(fixtureSeed?.success && fixtureSeed.matchesUpdated > 0),
      fixtureSeed,
    }
  } catch (error) {
    console.error("[world-cup/create] service failed", serializeWorldCupCreateError(error))
    throw error
  }
}

function serialize(input: {
  challenge: WorldCupBracketChallenge & {
    scoringProfile: {
      roundOf32Points: number
      roundOf16Points: number
      quarterFinalPoints: number
      semiFinalPoints: number
      finalPoints: number
      championBonusPoints: number
      thirdPlacePoints: number | null
    } | null
    slots: Array<Record<string, unknown>>
    matches: WorldCupBracketMatch[]
    participants: WorldCupBracketParticipant[]
    entries: Array<
      WorldCupBracketEntry & {
        picks?: WorldCupBracketPick[]
        participant?: { displayName: string; user?: { username: string; avatarUrl: string | null; displayName: string | null } | null }
      }
    >
  }
  participant: WorldCupBracketParticipant | null
  activeEntry: WorldCupBracketEntry | null
  picks: WorldCupBracketPick[]
  leaderboard: ReturnType<typeof buildWorldCupLeaderboardRows>
  userId?: string | null
  isAdmin?: boolean
}): WorldCupChallengeView {
  const c = input.challenge
  const matchById = new Map(c.matches.map((match) => [match.id, match] as const))
  const simulation = readSimulationFlags(c.sourcePayload)
  const hasSimulatedResults = c.matches.some(
    (m) => (m as Record<string, unknown>).apiStatusShort === "SIM"
  )
  const effLock = resolveWorldCupEffectivePickLockAt({
    pickLockStrategy: c.pickLockStrategy,
    pickLockAt: c.pickLockAt,
    matches: c.matches,
  })
  return {
    challenge: {
      id: c.id,
      name: c.name,
      ownerUserId: c.ownerUserId,
      seasonYear: c.seasonYear,
      inviteCode: c.inviteCode,
      inviteUrl: c.inviteUrl,
      visibility: c.visibility as WorldCupChallengeView["challenge"]["visibility"],
      pickLockStrategy: c.pickLockStrategy as WorldCupChallengeView["challenge"]["pickLockStrategy"],
      pickLockAt: iso(c.pickLockAt),
      maxParticipants: c.maxParticipants,
      maxEntriesPerParticipant: c.maxEntriesPerParticipant,
      effectivePickLockAt: iso(effLock),
      status: c.status,
      includeThirdPlace: Boolean(c.includeThirdPlace),
      isTestMode: simulation.isTestMode,
      simulationEnabled: simulation.simulationEnabled,
      simulatedAt: simulation.simulatedAt,
      simulationStatus: simulation.simulationStatus,
      hasSimulatedResults,
      lastSyncedAt: iso(c.lastSyncedAt),
      createdAt: iso(c.createdAt) ?? new Date().toISOString(),
      updatedAt: iso(c.updatedAt) ?? new Date().toISOString(),
    },
    scoring: {
      roundOf32Points: c.scoringProfile?.roundOf32Points ?? DEFAULT_WORLD_CUP_SCORING.roundOf32Points,
      roundOf16Points: c.scoringProfile?.roundOf16Points ?? DEFAULT_WORLD_CUP_SCORING.roundOf16Points,
      quarterFinalPoints: c.scoringProfile?.quarterFinalPoints ?? DEFAULT_WORLD_CUP_SCORING.quarterFinalPoints,
      semiFinalPoints: c.scoringProfile?.semiFinalPoints ?? DEFAULT_WORLD_CUP_SCORING.semiFinalPoints,
      finalPoints: c.scoringProfile?.finalPoints ?? DEFAULT_WORLD_CUP_SCORING.finalPoints,
      championBonusPoints: c.scoringProfile?.championBonusPoints ?? DEFAULT_WORLD_CUP_SCORING.championBonusPoints,
      thirdPlacePoints: c.scoringProfile?.thirdPlacePoints ?? DEFAULT_WORLD_CUP_SCORING.thirdPlacePoints ?? null,
    },
    slots: c.slots.map((s) => {
      const slot = s as Record<string, unknown>
      return {
        id: slot.id as string,
        slotKey: slot.slotKey as string,
        round: slot.round as WorldCupChallengeView["slots"][number]["round"],
        region: (slot.region as string | null) ?? null,
        sourceGroup: (slot.sourceGroup as string | null) ?? null,
        sourceRank: (slot.sourceRank as string | null) ?? null,
        teamId: (slot.teamId as string | null) ?? null,
        displayName: slot.displayName as string,
        isPlaceholder: Boolean(slot.isPlaceholder),
        lockedAt: iso(slot.lockedAt as Date | null),
      }
    }),
    matches: c.matches.map((m) => ({
      id: m.id,
      apiFixtureId: m.apiFixtureId,
      round: m.round as WorldCupChallengeView["matches"][number]["round"],
      roundIndex: m.roundIndex,
      matchNumber: m.matchNumber,
      homeSlotKey: m.homeSlotKey,
      awaySlotKey: m.awaySlotKey,
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      homeTeamName: m.homeTeamName,
      awayTeamName: m.awayTeamName,
      homeTeamLogo: m.homeTeamLogo,
      awayTeamLogo: m.awayTeamLogo,
      homeScore: m.homeScore,
      awayScore: m.awayScore,
      homePenaltyScore: m.homePenaltyScore,
      awayPenaltyScore: m.awayPenaltyScore,
      status: m.status as WorldCupChallengeView["matches"][number]["status"],
      startsAt: iso(m.startsAt),
      winnerTeamId: m.winnerTeamId,
      winnerTeamName: m.winnerTeamName,
      nextMatchId: m.nextMatchId,
      nextMatchSlot: m.nextMatchSlot as "home" | "away" | null,
      elapsedMinute: (m as Record<string, unknown>).elapsedMinute as number | null ?? null,
      injuryTime: (m as Record<string, unknown>).injuryTime as number | null ?? null,
      period: (m as Record<string, unknown>).period as string | null ?? null,
      venueName: (m as Record<string, unknown>).venueName as string | null ?? null,
      venueCity: (m as Record<string, unknown>).venueCity as string | null ?? null,
      apiStatusShort: (m as Record<string, unknown>).apiStatusShort as string | null ?? null,
      lastScoreSyncedAt: iso((m as Record<string, unknown>).lastScoreSyncedAt as Date | null | undefined),
    })),
    participant: input.participant
      ? {
          id: input.participant.id,
          userId: input.participant.userId,
          displayName: input.participant.displayName,
          joinedAt: iso(input.participant.joinedAt) ?? new Date().toISOString(),
          totalScore: input.participant.totalScore,
          maxPossibleScore: input.participant.maxPossibleScore,
          championPickTeamId: input.participant.championPickTeamId,
          championPickName: input.participant.championPickName,
          correctPicks: input.participant.correctPicks,
          rank: input.participant.rank,
        }
      : null,
    activeEntry: input.activeEntry ? { id: input.activeEntry.id, name: input.activeEntry.name } : null,
    entries: input.challenge.entries
      .filter((e) => !input.userId || e.userId === input.userId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((e) => {
        const isComplete = isWorldCupEntryCompleteFromSelections({
          matches: c.matches as Parameters<typeof isWorldCupEntryCompleteFromSelections>[0]["matches"],
          picks: e.picks ?? [],
          includeThirdPlace: c.includeThirdPlace,
        })

        return {
          id: e.id,
          name: e.name,
          createdAt: iso(e.createdAt) ?? new Date().toISOString(),
          totalScore: e.totalScore,
          rank: e.rank,
          isComplete,
        }
      }),
    picks: input.picks.map((p) => ({
      id: p.id,
      matchId: p.matchId,
      matchNumber: (p as WorldCupBracketPick & { match?: WorldCupBracketMatch | null }).match?.matchNumber ?? matchById.get(p.matchId)?.matchNumber ?? null,
      round: p.round as WorldCupChallengeView["picks"][number]["round"],
      selectedTeamId: p.selectedTeamId,
      selectedSlotKey: p.selectedSlotKey,
      selectedTeamName: p.selectedTeamName,
      pointsAwarded: p.pointsAwarded,
      isCorrect: p.isCorrect,
      lockedAt: iso(p.lockedAt),
    })),
    leaderboard: input.leaderboard,
    isOwner: Boolean(input.userId && input.userId === c.ownerUserId),
    isAdmin: Boolean(input.isAdmin),
    hasBracketBrainAi: false,
  }
}

export async function getWorldCupChallengeView(input: { challengeId: string; user?: SessionUser | null; isAdmin?: boolean }) {
  const c = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: input.challengeId },
    include: {
      scoringProfile: true,
      slots: { orderBy: { slotKey: "asc" } },
      matches: { orderBy: { matchNumber: "asc" } },
      participants: { orderBy: [{ rank: "asc" }, { joinedAt: "asc" }] },
      entries: {
        include: {
          picks: {
            // Guard against legacy bad rows (for example empty selected_team_name)
            // so one malformed pick does not 500 the entire bracket page.
            where: {
              selectedTeamName: { not: "" },
              OR: [
                { selectedTeamId: { not: null } },
                { selectedSlotKey: { not: null } },
              ],
            },
            include: { match: true },
          },
          participant: {
            include: {
              user: { select: { username: true, avatarUrl: true, displayName: true } },
            },
          },
        },
      },
    },
  })
  if (!c) return null
  const userId = input.user?.id ?? null
  const isPart = Boolean(userId && c.participants.some((p: WorldCupBracketParticipant) => p.userId === userId))
  const can = userCanManageWorldCupChallenge({
    userId,
    userEmail: input.user?.email,
    ownerUserId: c.ownerUserId,
    isAdmin: input.isAdmin,
  })
  if (c.visibility === "private" && !isPart && !can) return null

  const participant = userId ? c.participants.find((p: WorldCupBracketParticipant) => p.userId === userId) ?? null : null
  const userEntries = userId ? c.entries.filter((e: WorldCupBracketEntry) => e.userId === userId).sort((a: WorldCupBracketEntry, b: WorldCupBracketEntry) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) : []
  const activeEntry = userEntries[0] ?? null
  const picks =
    activeEntry ?
      await prisma.worldCupBracketPick.findMany({
        // Keep page/API resilient if legacy rows contain empty team names.
        where: {
          entryId: activeEntry.id,
          selectedTeamName: { not: "" },
          OR: [
            { selectedTeamId: { not: null } },
            { selectedSlotKey: { not: null } },
          ],
        },
        orderBy: { createdAt: "asc" },
      })
    : []

  const _srcPayload = c.sourcePayload as { simulation?: { isTestMode?: boolean } } | null
  const allowSimulated = Boolean(_srcPayload?.simulation?.isTestMode)

  const leaderboard = buildWorldCupLeaderboardRows({
    entries: c.entries as Parameters<typeof buildWorldCupLeaderboardRows>[0]["entries"],
    matches: c.matches as Parameters<typeof buildWorldCupLeaderboardRows>[0]["matches"],
    scoring: c.scoringProfile,
    allowSimulated,
  })

  const baseView = serialize({
    challenge: { ...c, entries: c.entries },
    participant,
    activeEntry,
    picks,
    leaderboard,
    userId,
    isAdmin: Boolean(input.isAdmin || isAdminEmailAllowed(input.user?.email)),
  })

  const hasBracketBrainAi = userId
    ? await userHasBracketBrainAi(userId, input.user?.email ?? null)
    : false

  return { ...baseView, hasBracketBrainAi }
}

export async function getWorldCupChallengeByInvite(inviteCode: string) {
  try {
    const i = await prisma.worldCupBracketInvite.findUnique({
      where: { inviteCode },
      include: {
        challenge: {
          include: {
            participants: true,
            matches: { select: { startsAt: true, status: true } },
          },
        },
      },
    })
    if (!i || (i.expiresAt && new Date(i.expiresAt) <= new Date()) || (i.maxUses != null && i.useCount >= i.maxUses)) return null

    const o = await prisma.appUser.findUnique({
      where: { id: i.challenge.ownerUserId },
      select: { displayName: true, username: true, email: true },
    })

    const { evaluateWorldCupNewParticipantJoinGate } = await import("./worldCupJoinGate")
    const gate = evaluateWorldCupNewParticipantJoinGate({
      challenge: i.challenge,
      matches: i.challenge.matches,
      sourcePayload: i.challenge.sourcePayload,
      participantCount: i.challenge.participants.length,
    })

    return {
      inviteCode,
      challengeId: i.challenge.id,
      name: i.challenge.name,
      ownerName: o?.displayName || o?.username || o?.email?.split("@")[0] || "AllFantasy Manager",
      seasonYear: i.challenge.seasonYear,
      participantCount: i.challenge.participants.length,
      status: i.challenge.status,
      visibility: i.challenge.visibility,
      joinPreview: {
        requiresJoinPassword: gate.requiresJoinPassword,
        joinBlockedReason: gate.joinBlockedReason,
        poolLocked: gate.poolLocked,
        allowLateJoin: gate.allowLateJoin,
        isFull: gate.isFull,
        maxParticipants: gate.maxParticipants,
      },
    }
  } catch {
    return null
  }
}

export async function joinWorldCupChallengeByInvite(input: {
  inviteCode: string
  user: SessionUser
  joinPassword?: string | null
}) {
  if (!input.user.id) throw new Error("Authenticated user required")
  const userId = input.user.id
  const i = await prisma.worldCupBracketInvite.findUnique({
    where: { inviteCode: input.inviteCode },
    include: {
      challenge: {
        include: { matches: true },
      },
    },
  })
  if (!i) throw new Error("Invite not found")

  const name = await displayName(input.user)
  let createdJoinEntryId: string | null = null
  const p = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.worldCupBracketParticipant.findUnique({
      where: { challengeId_userId: { challengeId: i.challengeId, userId } },
    })
    if (existing) {
      const ec = await tx.worldCupBracketEntry.count({ where: { participantId: existing.id } })
      if (ec === 0) {
        const e = await tx.worldCupBracketEntry.create({
          data: { challengeId: i.challengeId, participantId: existing.id, userId, name: "Bracket 1" },
        })
        createdJoinEntryId = e.id
      }
      return { participant: existing, joinedNew: false }
    }

    const passwordHash = getWorldCupJoinPasswordHashFromPayload(i.challenge.sourcePayload)
    if (passwordHash) {
      const provided = input.joinPassword?.trim()
      if (!provided || hashWorldCupJoinPassword(provided) !== passwordHash) {
        throw new Error("Invalid join password.")
      }
    }

    const leagueSettings = parseWorldCupLeagueSettings(i.challenge.sourcePayload)
    const poolLocked = isWorldCupBracketChallengePicksLocked({
      challenge: i.challenge,
      matches: i.challenge.matches,
    })
    if (poolLocked && !leagueSettings.allowLateJoin) {
      throw new Error("This bracket pool is locked and is not accepting new players.")
    }

    const participantCount = await tx.worldCupBracketParticipant.count({ where: { challengeId: i.challengeId } })
    if (participantCount >= i.challenge.maxParticipants) throw new Error("This bracket challenge is full")
    const created = await tx.worldCupBracketParticipant.create({
      data: { challengeId: i.challengeId, userId, displayName: name },
    })
    const e = await tx.worldCupBracketEntry.create({
      data: { challengeId: i.challengeId, participantId: created.id, userId, name: "Bracket 1" },
    })
    createdJoinEntryId = e.id
    await tx.worldCupBracketInvite.update({ where: { id: i.id }, data: { useCount: { increment: 1 } } })
    return { participant: created, joinedNew: true }
  })
  if (p.joinedNew) {
    emitWorldCupUserJoined(i.challengeId, userId, name)
  }
  if (createdJoinEntryId) {
    emitWorldCupEntryCreated(i.challengeId, createdJoinEntryId, userId, "Bracket 1")
  }

  let entryId: string | null = createdJoinEntryId
  if (!entryId) {
    const first = await prisma.worldCupBracketEntry.findFirst({
      where: { participantId: p.participant.id, challengeId: i.challengeId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    })
    entryId = first?.id ?? null
  }

  return { challengeId: i.challengeId, participantId: p.participant.id, entryId }
}

function side(match: WorldCupBracketMatch, pick: { selectedTeamId?: string | null; selectedSlotKey?: string | null }) {
  if (pick.selectedTeamId && pick.selectedTeamId === match.homeTeamId) return "home"
  if (pick.selectedTeamId && pick.selectedTeamId === match.awayTeamId) return "away"
  if (pick.selectedSlotKey && pick.selectedSlotKey === match.homeSlotKey) return "home"
  if (pick.selectedSlotKey && pick.selectedSlotKey === match.awaySlotKey) return "away"
  if (pick.selectedSlotKey && match.homeTeamId && pick.selectedSlotKey === `team:${match.homeTeamId}`) return "home"
  if (pick.selectedSlotKey && match.awayTeamId && pick.selectedSlotKey === `team:${match.awayTeamId}`) return "away"
  return null
}

/** @internal */
async function savePicksForEntryTx(
  tx: Prisma.TransactionClient,
  input: {
    challenge: WorldCupBracketChallenge & { matches: WorldCupBracketMatch[] }
    entry: WorldCupBracketEntry & { participantId: string; userId: string; isLocked?: boolean | null }
    picks: Array<{
      matchId: string
      matchNumber?: number | null
      round?: string | null
      selectedTeamId?: string | null
      selectedSlotKey?: string | null
      selectedTeamName?: string | null
    }>
  }
) {
  const { challenge: c, entry, picks: pickInputs } = input
  const lock = isWorldCupChallengeLocked({ challenge: c, matches: c.matches, entry })
  if (lock.locked) throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)
  const byId = new Map(c.matches.map((m) => [m.id, m] as const))
  for (const pick of pickInputs) {
    const m = byId.get(pick.matchId)
    if (!m) throw new Error("Match not found")
    const isStableRoundTarget =
      (pick.matchNumber != null && pick.round && m.round === pick.round && m.matchNumber === pick.matchNumber) ||
      m.matchNumber === 29 ||
      m.matchNumber === 30 ||
      m.matchNumber === 31

    // Clean up legacy placeholder/projected rows that target the same knockout
    // match by round+matchNumber but point at a different match id.
    if (isStableRoundTarget) {
      const conflictingRows = await tx.worldCupBracketPick.findMany({
        where: {
          entryId: entry.id,
          round: m.round,
          NOT: { matchId: m.id },
        },
        include: { match: { select: { matchNumber: true, id: true } } },
      })
      const conflictingIds = conflictingRows
        .filter((row) => row.match?.matchNumber === m.matchNumber)
        .map((row) => row.id)
      if (conflictingIds.length > 0) {
        await tx.worldCupBracketPick.deleteMany({ where: { id: { in: conflictingIds } } })
      }
      if (process.env.NODE_ENV === "development" && (m.matchNumber === 29 || m.matchNumber === 30 || m.matchNumber === 31)) {
        console.debug("[world-cup:picks:cleanup-conflicts]", {
          entryId: entry.id,
          round: m.round,
          matchNumber: m.matchNumber,
          targetMatchId: m.id,
          removedConflictingPickIds: conflictingIds,
        })
      }
    }

    if (isWorldCupMatchLocked({ challenge: c, match: m, matches: c.matches })) throw new Error("This matchup is locked")
    const s = side(m, pick)
    if (!s && !pick.selectedTeamName) throw new Error("Selected team is not in this matchup")
    const selectedTeamId = pick.selectedTeamId ?? (s === "home" ? m.homeTeamId : s === "away" ? m.awayTeamId : null)
    const selectedSlotKey = pick.selectedSlotKey ?? (s === "home" ? m.homeSlotKey : s === "away" ? m.awaySlotKey : null)
    const selectedTeamName = pick.selectedTeamName ?? (s === "home" ? m.homeTeamName : s === "away" ? m.awayTeamName : "")
    if (!selectedTeamName || (!selectedTeamId && !selectedSlotKey)) {
      throw new Error("Selected team is not in this matchup")
    }
    await tx.worldCupBracketPick.upsert({
      where: { entryId_matchId: { entryId: entry.id, matchId: m.id } },
      create: {
        challengeId: c.id,
        participantId: entry.participantId,
        entryId: entry.id,
        matchId: m.id,
        round: m.round,
        selectedTeamId,
        selectedSlotKey,
        selectedTeamName,
      },
      update: {
        selectedTeamId,
        selectedSlotKey,
        selectedTeamName,
        round: m.round,
        isCorrect: null,
        pointsAwarded: 0,
      },
    })
    if (process.env.NODE_ENV === "development" && (m.matchNumber === 29 || m.matchNumber === 30 || m.matchNumber === 31)) {
      const saved = await tx.worldCupBracketPick.findUnique({
        where: { entryId_matchId: { entryId: entry.id, matchId: m.id } },
        select: {
          id: true,
          matchId: true,
          round: true,
          selectedTeamId: true,
          selectedSlotKey: true,
          selectedTeamName: true,
        },
      })
      console.debug("[world-cup:picks:saved-row]", {
        entryId: entry.id,
        matchNumber: m.matchNumber,
        matchId: m.id,
        savedPick: saved,
      })
    }
    if (m.round === "final") {
      await tx.worldCupBracketEntry.update({
        where: { id: entry.id },
        data: { championTeamId: selectedTeamId, championTeamName: selectedTeamName },
      })
    }
  }
  const savedPicks = await tx.worldCupBracketPick.findMany({
    where: { entryId: entry.id },
    select: { matchId: true, round: true, selectedTeamId: true, selectedSlotKey: true },
  })
  const complete = isWorldCupEntryCompleteFromSelections({
    matches: c.matches as Parameters<typeof isWorldCupEntryCompleteFromSelections>[0]["matches"],
    picks: savedPicks,
    includeThirdPlace: c.includeThirdPlace,
  })
  await tx.worldCupBracketEntry.update({
    where: { id: entry.id },
    data: { isComplete: complete, submittedAt: complete ? new Date() : null },
  })
}

export async function saveWorldCupPicks(input: {
  challengeId: string
  userId: string
  picks: Array<{ matchId: string; selectedTeamId?: string | null; selectedSlotKey?: string | null }>
}) {
  const c = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: input.challengeId },
    include: { matches: true, participants: { where: { userId: input.userId } } },
  })
  if (!c) throw new Error("Challenge not found")
  const participant = c.participants[0]
  if (!participant) throw new Error("Join the bracket before making picks")
  const entry =
    (await prisma.worldCupBracketEntry.findFirst({
      where: { challengeId: c.id, userId: input.userId },
      orderBy: { createdAt: "asc" },
    })) ?? null
  if (!entry) throw new Error("No bracket entry found — create a bracket first")

  if (isWorldCupChallengeLocked({ challenge: c, matches: c.matches, entry }).locked) throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)

  const wasComplete = Boolean(entry.isComplete)

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await savePicksForEntryTx(tx, { challenge: c, entry: { ...entry, participantId: participant.id, userId: input.userId }, picks: input.picks })
  })

  await recalculateWorldCupChallenge(c.id)

  const entryAfter = await prisma.worldCupBracketEntry.findUnique({
    where: { id: entry.id },
    select: { isComplete: true, name: true },
  })
  if (!wasComplete && entryAfter?.isComplete) {
    emitWorldCupBracketCompleted(c.id, entry.id, input.userId, entryAfter.name)
  }
  return getWorldCupChallengeView({ challengeId: c.id, user: { id: input.userId } })
}

export async function listWorldCupBracketEntries(input: { challengeId: string; userId: string }) {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: input.challengeId },
    include: {
      matches: true,
      entries: {
        where: { userId: input.userId },
        include: {
          picks: {
            where: {
              selectedTeamName: { not: "" },
              OR: [
                { selectedTeamId: { not: null } },
                { selectedSlotKey: { not: null } },
              ],
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  })
  if (!challenge) return []

  return challenge.entries.map((entry: (typeof challenge.entries)[number]) => {
    const { picks, ...entryData } = entry
    return {
      ...entryData,
      isComplete: isWorldCupEntryCompleteFromSelections({
        matches: challenge.matches as Parameters<typeof isWorldCupEntryCompleteFromSelections>[0]["matches"],
        picks,
        includeThirdPlace: challenge.includeThirdPlace,
      }),
    }
  })
}

export async function createWorldCupBracketEntry(input: { challengeId: string; userId: string; name?: string | null }) {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({ where: { id: input.challengeId } })
  if (!challenge) throw new Error("Challenge not found")
  const challengeMatches = await prisma.worldCupBracketMatch.findMany({
    where: { challengeId: input.challengeId },
    select: { startsAt: true, status: true },
  })
  if (isWorldCupChallengeLocked({ challenge, matches: challengeMatches }).locked) {
    throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)
  }
  const participant = await prisma.worldCupBracketParticipant.findUnique({
    where: { challengeId_userId: { challengeId: input.challengeId, userId: input.userId } },
  })
  if (!participant) throw new Error("Join the bracket before creating entries")
  const count = await prisma.worldCupBracketEntry.count({ where: { participantId: participant.id } })
  if (count >= challenge.maxEntriesPerParticipant) throw new Error("Maximum bracket entries reached")
  const label = input.name?.trim() || `Bracket ${count + 1}`
  const row = await prisma.worldCupBracketEntry.create({
    data: {
      challengeId: input.challengeId,
      participantId: participant.id,
      userId: input.userId,
      name: label,
    },
  })
  emitWorldCupEntryCreated(input.challengeId, row.id, input.userId, row.name)
  return row
}

export async function renameWorldCupBracketEntry(input: { entryId: string; userId: string; name: string }) {
  const trimmed = input.name.trim()
  if (!trimmed) throw new Error("Name required")
  if (trimmed.length > 40) throw new Error("Name must be 40 characters or fewer")
  const entry = await prisma.worldCupBracketEntry.findUnique({
    where: { id: input.entryId },
    include: { challenge: { include: { matches: true } } },
  })
  if (!entry || entry.userId !== input.userId) throw new Error("Entry not found")
  if (isWorldCupChallengeLocked({ challenge: entry.challenge, matches: entry.challenge.matches, entry }).locked) {
    throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)
  }
  return prisma.worldCupBracketEntry.update({ where: { id: input.entryId }, data: { name: trimmed } })
}

export async function deleteWorldCupBracketEntry(input: { entryId: string; userId: string }) {
  const entry = await prisma.worldCupBracketEntry.findUnique({
    where: { id: input.entryId },
    include: { challenge: { include: { matches: true } } },
  })
  if (!entry || entry.userId !== input.userId) throw new Error("Entry not found")
  const total = await prisma.worldCupBracketEntry.count({ where: { participantId: entry.participantId } })
  if (total <= 1) throw new Error("Cannot delete your only bracket entry")
  if (isWorldCupChallengeLocked({ challenge: entry.challenge, matches: entry.challenge.matches, entry }).locked) {
    throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)
  }
  await prisma.worldCupBracketEntry.delete({ where: { id: input.entryId } })
}

export async function getWorldCupBracketEntryDetail(input: { entryId: string; userId?: string | null; isAdmin?: boolean }) {
  const entry = await prisma.worldCupBracketEntry.findUnique({
    where: { id: input.entryId },
    include: {
      challenge: {
        select: {
          id: true,
          ownerUserId: true,
          includeThirdPlace: true,
          matches: true,
        },
      },
      picks: {
        where: {
          selectedTeamName: { not: "" },
          OR: [
            { selectedTeamId: { not: null } },
            { selectedSlotKey: { not: null } },
          ],
        },
        include: { match: true },
        orderBy: { createdAt: "asc" },
      },
      participant: true,
    },
  })
  if (!entry) return null
  const allowed =
    Boolean(input.isAdmin) ||
    (input.userId && entry.userId === input.userId) ||
    (input.userId && entry.challenge.ownerUserId === input.userId)
  if (!allowed) return null
  const { challenge, picks, ...entryData } = entry
  const realPicks = picks.filter(hasWorldCupPickSelection)
  return {
    ...entryData,
    challenge: {
      id: challenge.id,
      ownerUserId: challenge.ownerUserId,
      includeThirdPlace: challenge.includeThirdPlace,
    },
    picks: realPicks.map(toWorldCupPickView),
    isComplete: isWorldCupEntryCompleteFromSelections({
      matches: challenge.matches as Parameters<typeof isWorldCupEntryCompleteFromSelections>[0]["matches"],
      picks: realPicks,
      includeThirdPlace: challenge.includeThirdPlace,
    }),
  }
}

export async function saveWorldCupBracketPickForEntry(input: {
  entryId: string
  userId: string
  matchId: string
  selectedTeamId?: string | null
  selectedTeamName?: string | null
  selectedSlotKey?: string | null
  selectedSide?: "home" | "away"
  round?: string | null
  matchNumber?: number | null
  nextMatchId?: string | null
  nextMatchSlot?: "home" | "away" | null
}) {
  const entry = await prisma.worldCupBracketEntry.findUnique({
    where: { id: input.entryId },
    include: {
      picks: {
        where: {
          selectedTeamName: { not: "" },
          OR: [
            { selectedTeamId: { not: null } },
            { selectedSlotKey: { not: null } },
          ],
        },
        include: { match: true },
        orderBy: { createdAt: "asc" },
      },
      challenge: { include: { matches: true } },
    },
  })
  if (!entry || entry.userId !== input.userId) throw new Error("Entry not found")
  const c = entry.challenge
  const m =
    c.matches.find((x: WorldCupBracketMatch) => x.id === input.matchId) ??
    (input.matchNumber && input.round
      ? c.matches.find((x: WorldCupBracketMatch) => x.matchNumber === input.matchNumber && x.round === input.round)
      : null)
  if (!m) throw new Error("Match not found")
  if (isWorldCupChallengeLocked({ challenge: c, matches: c.matches, entry }).locked) throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)

  const existingPicks = entry.picks.filter(hasWorldCupPickSelection).map(toWorldCupPickView)
  const projectedMatches = buildWorldCupProjectedMatches(
    c.matches.map(toWorldCupMatchView),
    existingPicks
  )
  const projectedMatch =
    projectedMatches.find((match) => match.id === m.id) ??
    projectedMatches.find((match) => match.round === m.round && match.matchNumber === m.matchNumber)
  if (!projectedMatch) throw new Error("Match not found")
  if (isWorldCupMatchLocked({ challenge: c, match: projectedMatch, matches: c.matches })) {
    throw new Error("This matchup is locked")
  }
  if (!isWorldCupMatchPickable(projectedMatch)) {
    throw new Error("This matchup is not ready for picks yet.")
  }

  const effMatch = getWorldCupProjectedMatchTeams(projectedMatch)

  const sideFromSelection =
    input.selectedTeamId && input.selectedTeamId === effMatch.home.teamId
      ? "home"
      : input.selectedTeamId && input.selectedTeamId === effMatch.away.teamId
        ? "away"
        : input.selectedSlotKey && input.selectedSlotKey === projectedMatch.homeSlotKey
          ? "home"
          : input.selectedSlotKey && input.selectedSlotKey === projectedMatch.awaySlotKey
            ? "away"
            : input.selectedSlotKey && effMatch.home.teamId && input.selectedSlotKey === `team:${effMatch.home.teamId}`
              ? "home"
              : input.selectedSlotKey && effMatch.away.teamId && input.selectedSlotKey === `team:${effMatch.away.teamId}`
                ? "away"
                : input.selectedTeamName &&
                    effMatch.home.teamName &&
                    input.selectedTeamName.trim() === effMatch.home.teamName.trim()
                  ? "home"
                  : input.selectedTeamName &&
                      effMatch.away.teamName &&
                      input.selectedTeamName.trim() === effMatch.away.teamName.trim()
                    ? "away"
                    : null
  if (input.selectedSide && sideFromSelection && input.selectedSide !== sideFromSelection) {
    throw new Error("Selected team is not in this matchup")
  }
  const selectedSide = sideFromSelection ?? input.selectedSide ?? null
  if (!selectedSide) throw new Error("Selected team is not in this matchup")

  const selectedTeamId = selectedSide === "home" ? effMatch.home.teamId : effMatch.away.teamId
  let selectedSlotKey = selectedSide === "home" ? effMatch.home.slotKey : effMatch.away.slotKey
  if (!String(selectedSlotKey ?? "").trim() && selectedTeamId) {
    selectedSlotKey = `team:${selectedTeamId}`
  }
  const selectedTeamName = selectedSide === "home" ? effMatch.home.teamName : effMatch.away.teamName
  const existingPick = findWorldCupPickForMatch(existingPicks, projectedMatch)
  const existingPickMatchedBy = existingPick ? getWorldCupPickMatchMethod(existingPick, projectedMatch) : null
  const nextMatchNumber = projectedMatches.find((match) => match.id === (input.nextMatchId ?? m.nextMatchId))?.matchNumber ?? null

  if (process.env.NODE_ENV === "development") {
    console.debug("[world-cup:picks:save-resolved]", {
      entryId: entry.id,
      requestedMatchId: input.matchId,
      savingPickMatchId: m.id,
      round: m.round,
      matchNumber: m.matchNumber,
      selectedTeamId,
      selectedSlotKey,
      selectedTeamName,
      nextMatchNumber,
      existingPickMatchedBy,
      nextMatchId: input.nextMatchId ?? m.nextMatchId,
      nextMatchSlot: input.nextMatchSlot ?? m.nextMatchSlot,
    })
  }

  const pickPayload = {
    matchId: m.id,
    matchNumber: m.matchNumber,
    round: m.round,
    selectedTeamId,
    selectedSlotKey,
    selectedTeamName,
  }
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await savePicksForEntryTx(tx, {
      challenge: c,
      entry: { ...entry, participantId: entry.participantId, userId: entry.userId },
      picks: [pickPayload],
    })
  })
  await recalculateWorldCupChallenge(c.id)

  const updatedEntry = await prisma.worldCupBracketEntry.findUnique({
    where: { id: entry.id },
    include: { picks: { include: { match: true }, orderBy: { createdAt: "asc" } } },
  })
  const savedPick = await prisma.worldCupBracketPick.findUnique({
    where: { entryId_matchId: { entryId: entry.id, matchId: m.id } },
  })
  const isComplete = updatedEntry
    ? isWorldCupEntryCompleteFromSelections({
        matches: c.matches as Parameters<typeof isWorldCupEntryCompleteFromSelections>[0]["matches"],
        picks: updatedEntry.picks.filter(hasWorldCupPickSelection),
        includeThirdPlace: c.includeThirdPlace,
      })
    : false
  const returnedPicks = updatedEntry?.picks.filter(hasWorldCupPickSelection).map(toWorldCupPickView) ?? []
  if (process.env.NODE_ENV === "development" && (m.matchNumber === 29 || m.matchNumber === 30 || m.matchNumber === 31)) {
    console.debug("[world-cup:picks:save-return]", {
      entryId: entry.id,
      round: m.round,
      matchNumber: m.matchNumber,
      requestedMatchId: input.matchId,
      resolvedMatchId: m.id,
      matchedBy: m.id === input.matchId ? "matchId" : "round_matchNumber",
      returnedPickCount: returnedPicks.length,
    })
  }
  return {
    entry: updatedEntry,
    pick: savedPick,
    picks: returnedPicks,
    isComplete,
  }
}

/** Batch save multiple picks for one entry (used by legacy route). */
export async function saveWorldCupPicksForEntry(input: {
  challengeId: string
  entryId: string
  userId: string
  picks: Array<{ matchId: string; selectedTeamId?: string | null; selectedSlotKey?: string | null }>
}) {
  const c = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: input.challengeId },
    include: { matches: true },
  })
  if (!c) throw new Error("Challenge not found")
  const entry = await prisma.worldCupBracketEntry.findFirst({
    where: { id: input.entryId, challengeId: input.challengeId, userId: input.userId },
  })
  if (!entry) throw new Error("Entry not found")
  if (isWorldCupChallengeLocked({ challenge: c, matches: c.matches, entry }).locked) throw new Error(WORLD_CUP_BRACKET_LOCKED_MESSAGE)

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await savePicksForEntryTx(tx, {
      challenge: c,
      entry: { ...entry, participantId: entry.participantId, userId: input.userId },
      picks: input.picks,
    })
  })
  await recalculateWorldCupChallenge(c.id)
  const updatedEntry = await prisma.worldCupBracketEntry.findUnique({
    where: { id: entry.id },
    include: { picks: { orderBy: { createdAt: "asc" } } },
  })
  const isComplete = updatedEntry
    ? isWorldCupEntryCompleteFromSelections({
        matches: c.matches as Parameters<typeof isWorldCupEntryCompleteFromSelections>[0]["matches"],
        picks: updatedEntry.picks.filter(hasWorldCupPickSelection),
        includeThirdPlace: c.includeThirdPlace,
      })
    : false
  return {
    success: true as const,
    entry: updatedEntry,
    picks: updatedEntry?.picks.filter(hasWorldCupPickSelection) ?? [],
    isComplete,
  }
}

export async function createAdditionalWorldCupInvite(input: {
  challengeId: string
  createdByUserId: string
  maxUses?: number | null
  expiresAt?: Date | null
}) {
  const inviteCode = await generateWorldCupInviteCode()
  const inviteUrl = `${getWorldCupAppBaseUrl()}/join/bracket/${inviteCode}`
  const invite = await prisma.worldCupBracketInvite.create({
    data: {
      challengeId: input.challengeId,
      inviteCode,
      createdByUserId: input.createdByUserId,
      maxUses: input.maxUses ?? null,
      expiresAt: input.expiresAt ?? null,
    },
  })
  return { inviteCode: invite.inviteCode, inviteUrl }
}

export async function updateWorldCupChallengeSettings(input: {
  challengeId: string
  name?: string
  visibility?: "public" | "private"
  pickLockStrategy?: "per_match" | "tournament_start"
  pickLockAt?: Date | null
  status?: string
  isTestMode?: boolean
  simulationEnabled?: boolean
  simulationStatus?: string | null
  simulatedAt?: Date | null
  /** Optional Bracket League pool to mirror World Cup chat events into pool chat */
  bracketLeagueId?: string | null
}) {
  let nextSourcePayload: Prisma.JsonObject | undefined
  if (
    input.isTestMode !== undefined ||
    input.simulationEnabled !== undefined ||
    input.simulationStatus !== undefined ||
    input.simulatedAt !== undefined
  ) {
    const challenge = await prisma.worldCupBracketChallenge.findUnique({
      where: { id: input.challengeId },
      select: { sourcePayload: true },
    })

    const base =
      challenge?.sourcePayload && typeof challenge.sourcePayload === "object" && !Array.isArray(challenge.sourcePayload)
        ? ({ ...(challenge.sourcePayload as Prisma.JsonObject) } as Prisma.JsonObject)
        : ({} as Prisma.JsonObject)

    const simulationSource =
      base.simulation && typeof base.simulation === "object" && !Array.isArray(base.simulation)
        ? ({ ...(base.simulation as Prisma.JsonObject) } as Prisma.JsonObject)
        : ({} as Prisma.JsonObject)

    if (input.isTestMode !== undefined) {
      simulationSource.isTestMode = input.isTestMode
    }
    if (input.simulationEnabled !== undefined) {
      simulationSource.simulationEnabled = input.simulationEnabled
    }
    if (input.simulationStatus !== undefined) {
      simulationSource.simulationStatus = input.simulationStatus
    }
    if (input.simulatedAt !== undefined) {
      simulationSource.simulatedAt = input.simulatedAt ? input.simulatedAt.toISOString() : null
    }

    base.simulation = simulationSource
    nextSourcePayload = base
  }

  return prisma.worldCupBracketChallenge.update({
    where: { id: input.challengeId },
    data: {
      name: input.name,
      visibility: input.visibility,
      pickLockStrategy: input.pickLockStrategy,
      pickLockAt: input.pickLockAt,
      status: input.status,
      sourcePayload: nextSourcePayload,
      ...(Object.prototype.hasOwnProperty.call(input, "bracketLeagueId") && {
        bracketLeagueId: input.bracketLeagueId,
      }),
    },
  })
}

export async function listUserWorldCupChallenges(userId: string) {
  const rows = await prisma.worldCupBracketParticipant.findMany({
    where: { userId },
    include: { challenge: { include: { _count: { select: { participants: true } } } } },
    orderBy: { joinedAt: "desc" },
  })
  return rows.map((r: (typeof rows)[0]) => ({
    id: r.challenge.id,
    name: r.challenge.name,
    seasonYear: r.challenge.seasonYear,
    inviteCode: r.challenge.inviteCode,
    status: r.challenge.status,
    participantCount: r.challenge._count.participants,
    totalScore: r.totalScore,
    rank: r.rank,
    joinedAt: iso(r.joinedAt),
  }))
}
