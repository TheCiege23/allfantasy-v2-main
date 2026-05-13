import "server-only"
import { prisma } from "@/lib/prisma"
import { buildPlayoffTemplate, getPlayoffRoundOrder } from "./playoffTemplate"
import type { PlayoffChallengeListItem, PlayoffChallengeView, PlayoffCreateResponse, PlayoffSport } from "./types"

type SessionUser = {
  id?: string | null
  name?: string | null
  displayName?: string | null
  username?: string | null
  email?: string | null
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return new Date(value).toISOString()
}

function defaultEntryName(user: SessionUser): string {
  if (user.name?.trim()) return user.name.trim()
  if (user.displayName?.trim()) return user.displayName.trim()
  if (user.username?.trim()) return user.username.trim()
  if (user.email?.trim()) return user.email.split("@")[0]
  return "My"
}

export function getPlayoffSportTitle(sport: PlayoffSport | "fifa"): string {
  if (sport === "nba") return "NBA Playoff Pool"
  if (sport === "nhl") return "NHL Playoff Pool"
  return "FIFA World Cup Pool"
}

function defaultChallengeName(sport: PlayoffSport): string {
  return getPlayoffSportTitle(sport)
}

function sanitizeChallengeName(name: string | null | undefined, sport: PlayoffSport): string {
  const trimmed = name?.trim() ?? ""
  if (trimmed.length >= 2) return trimmed
  return defaultChallengeName(sport)
}

function toInviteCode(challengeId: string): string {
  return challengeId.slice(0, 8).toUpperCase()
}

function toChallengeDashboardHref(challengeId: string): string {
  return `/brackets/leagues/${challengeId}`
}

function toChallengeEntryHref(challengeId: string, entryId: string): string {
  return `/brackets/leagues/${challengeId}/entries/${entryId}`
}

export async function createPlayoffBracketChallenge(input: {
  user: SessionUser
  name?: string
  sport: PlayoffSport
  seasonYear?: number
  isTestMode?: boolean
}): Promise<PlayoffCreateResponse> {
  if (!input.user.id) {
    throw new Error("Authenticated user required")
  }

  const challengeName = sanitizeChallengeName(input.name, input.sport)

  const template = buildPlayoffTemplate({
    sport: input.sport,
    seasonYear: input.seasonYear ?? new Date().getUTCFullYear(),
    isTestMode: input.isTestMode,
  })

  const result = await prisma.$transaction(async (tx) => {
    const challenge = await (tx as any).playoffBracketChallenge.create({
      data: {
        ownerUserId: input.user.id,
        name: challengeName,
        sport: input.sport,
        seasonYear: input.seasonYear ?? new Date().getUTCFullYear(),
        status: "open",
        isTestMode: Boolean(input.isTestMode),
      },
    })

    await (tx as any).playoffBracketSeries.createMany({
      data: template.map((series) => ({
        challengeId: challenge.id,
        round: series.round,
        roundIndex: series.roundIndex,
        seriesNumber: series.seriesNumber,
        conference: series.conference,
        homeSeed: series.homeSeed,
        awaySeed: series.awaySeed,
        homeTeamName: series.homeTeamName,
        awayTeamName: series.awayTeamName,
        winnerTeamName: series.winnerTeamName,
        bestOf: series.bestOf,
        status: series.status,
        startsAt: series.startsAt ? new Date(series.startsAt) : null,
        nextSeriesNumber: series.nextSeriesNumber,
        nextSeriesSlot: series.nextSeriesSlot,
        sourceSeriesHome: series.sourceSeriesHome,
        sourceSeriesAway: series.sourceSeriesAway,
      })),
    })

    return {
      challengeId: challenge.id as string,
      entryId: null,
      sport: input.sport,
      name: challenge.name as string,
      redirectUrl: toChallengeDashboardHref(challenge.id as string),
    }
  })

  return result
}

export async function listUserPlayoffChallenges(userId: string): Promise<PlayoffChallengeListItem[]> {
  const challenges = await (prisma as any).playoffBracketChallenge.findMany({
    where: {
      OR: [
        { ownerUserId: userId },
        {
          entries: {
            some: { userId },
          },
        },
      ],
    },
    include: {
      entries: {
        select: { userId: true },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  return challenges.map((challenge: any) => {
    const participantUserIds = new Set<string>(challenge.entries.map((entry: any) => entry.userId))
    participantUserIds.add(challenge.ownerUserId)

    return {
      challengeId: challenge.id,
      sport: challenge.sport,
      name: challenge.name,
      redirectUrl: toChallengeDashboardHref(challenge.id),
      seasonYear: challenge.seasonYear,
      participantCount: participantUserIds.size,
      entryCount: challenge.entries.length,
      inviteCode: toInviteCode(challenge.id),
    }
  })
}

export async function getPlayoffBracketView(input: {
  challengeId: string
  user: SessionUser | null
  requestedEntryId?: string | null
}): Promise<PlayoffChallengeView | null> {
  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: input.challengeId },
    include: {
      owner: {
        select: {
          id: true,
          displayName: true,
          username: true,
          email: true,
        },
      },
      entries: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              username: true,
              email: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      series: {
        orderBy: [{ roundIndex: "asc" }, { seriesNumber: "asc" }],
      },
    },
  })

  if (!challenge) return null

  const userId = input.user?.id ?? null
  const requestedEntry = input.requestedEntryId
    ? challenge.entries.find((entry: { id: string; userId: string }) => {
        if (entry.id !== input.requestedEntryId) return false
        if (!userId) return true
        return entry.userId === userId
      })
    : null

  const activeEntry =
    requestedEntry ??
    (userId
      ? challenge.entries.find((entry: { userId: string }) => entry.userId === userId)
      : challenge.entries[0]) ??
    null

  const picks = activeEntry
    ? await (prisma as any).playoffBracketPick.findMany({
        where: { entryId: activeEntry.id },
        orderBy: [{ createdAt: "asc" }],
      })
    : []

  const allEntryPicks = await (prisma as any).playoffBracketPick.findMany({
    where: { challengeId: challenge.id },
    select: { entryId: true },
  })

  const pickCountByEntryId = new Map<string, number>()
  for (const pick of allEntryPicks) {
    pickCountByEntryId.set(pick.entryId, (pickCountByEntryId.get(pick.entryId) ?? 0) + 1)
  }

  const challengeEntries = Array.isArray(challenge.entries) ? challenge.entries : []
  const challengeSeries = Array.isArray(challenge.series) ? challenge.series : []
  const totalSeries = challengeSeries.length
  const participantMap = new Map<string, { userId: string; displayName: string; entryCount: number }>()
  for (const entry of challengeEntries) {
    const existing = participantMap.get(entry.userId)
    const displayName =
      entry.user?.displayName?.trim() ||
      entry.user?.username?.trim() ||
      entry.user?.email?.trim() ||
      "Participant"
    if (!existing) {
      participantMap.set(entry.userId, { userId: entry.userId, displayName, entryCount: 1 })
      continue
    }
    existing.entryCount += 1
  }

  if (!participantMap.has(challenge.ownerUserId)) {
    const ownerDisplayName =
      challenge.owner?.displayName?.trim() ||
      challenge.owner?.username?.trim() ||
      challenge.owner?.email?.trim() ||
      "Commissioner"
    participantMap.set(challenge.ownerUserId, {
      userId: challenge.ownerUserId,
      displayName: ownerDisplayName,
      entryCount: 0,
    })
  }

  return {
    viewerUserId: userId,
    challenge: {
      id: challenge.id,
      name: challenge.name,
      ownerUserId: challenge.ownerUserId,
      sport: challenge.sport,
      seasonYear: challenge.seasonYear,
      status: challenge.status,
      isTestMode: challenge.isTestMode,
      visibility: "private",
      maxParticipants: 100,
      maxEntriesPerParticipant: 5,
      scoringStyle: "series_winner",
      lockRule: "first_tipoff",
      inviteCode: toInviteCode(challenge.id),
      inviteUrl: toChallengeDashboardHref(challenge.id),
      createdAt: toIso(challenge.createdAt) ?? new Date().toISOString(),
      updatedAt: toIso(challenge.updatedAt) ?? new Date().toISOString(),
    },
    participants: Array.from(participantMap.values()),
    activeEntry: activeEntry
      ? {
          id: activeEntry.id,
          name: activeEntry.name,
          userId: activeEntry.userId,
          pickCount: pickCountByEntryId.get(activeEntry.id) ?? 0,
          isComplete: (pickCountByEntryId.get(activeEntry.id) ?? 0) >= totalSeries,
          totalScore: activeEntry.totalScore ?? 0,
          correctPicks: activeEntry.correctPicks ?? 0,
          rank: activeEntry.rank ?? null,
          submittedAt: toIso(activeEntry.submittedAt),
          isLocked: activeEntry.isLocked ?? false,
          createdAt: toIso(activeEntry.createdAt) ?? new Date().toISOString(),
        }
      : null,
    entries: challengeEntries
      .map((entry: any) => ({
        id: entry.id,
        name: entry.name,
        userId: entry.userId,
        pickCount: pickCountByEntryId.get(entry.id) ?? 0,
        isComplete: (pickCountByEntryId.get(entry.id) ?? 0) >= totalSeries,
        totalScore: entry.totalScore ?? 0,
        correctPicks: entry.correctPicks ?? 0,
        rank: entry.rank ?? null,
        submittedAt: toIso(entry.submittedAt),
        isLocked: entry.isLocked ?? false,
        createdAt: toIso(entry.createdAt) ?? new Date().toISOString(),
      }))
      .sort((a: any, b: any) => b.totalScore - a.totalScore || b.correctPicks - a.correctPicks),
    series: challengeSeries.map((series: any) => ({
      id: series.id,
      round: series.round,
      roundIndex: series.roundIndex,
      seriesNumber: series.seriesNumber,
      conference: series.conference,
      homeSeed: series.homeSeed,
      awaySeed: series.awaySeed,
      homeTeamName: series.homeTeamName,
      awayTeamName: series.awayTeamName,
      winnerTeamName: series.winnerTeamName,
      homeWins: series.homeWins ?? 0,
      awayWins: series.awayWins ?? 0,
      bestOf: series.bestOf,
      status: series.status,
      startsAt: toIso(series.startsAt),
      nextSeriesNumber: series.nextSeriesNumber,
      nextSeriesSlot: series.nextSeriesSlot,
    })),
    picks: picks.map((pick: any) => ({
      id: pick.id,
      entryId: pick.entryId,
      seriesId: pick.seriesId,
      pickTeamName: pick.pickTeamName,
      pointsAwarded: pick.pointsAwarded ?? 0,
      isCorrect: pick.isCorrect ?? null,
      createdAt: toIso(pick.createdAt) ?? new Date().toISOString(),
      updatedAt: toIso(pick.updatedAt) ?? new Date().toISOString(),
    })),
    rounds: getPlayoffRoundOrder(),
  }
}

export async function createPlayoffBracketEntry(input: {
  challengeId: string
  user: SessionUser
  name?: string
}) {
  if (!input.user.id) {
    throw new Error("Authenticated user required")
  }

  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: input.challengeId },
    select: { id: true },
  })
  if (!challenge) {
    throw new Error("Challenge not found")
  }

  const existingEntries = await (prisma as any).playoffBracketEntry.findMany({
    where: {
      challengeId: input.challengeId,
      userId: input.user.id,
    },
    orderBy: { createdAt: "asc" },
  })

  if (existingEntries.length >= 5) {
    throw new Error("Entry limit reached (max 5 per user)")
  }

  const ownerLabel = defaultEntryName(input.user)
  const fallbackName = `${ownerLabel}'s Bracket ${existingEntries.length + 1}`
  const name = input.name?.trim() ? input.name.trim() : fallbackName

  const createdEntry = await (prisma as any).playoffBracketEntry.create({
    data: {
      challengeId: input.challengeId,
      userId: input.user.id,
      name,
    },
    select: {
      id: true,
    },
  })

  return {
    challengeId: input.challengeId,
    entryId: createdEntry.id as string,
    redirectUrl: toChallengeEntryHref(input.challengeId, createdEntry.id as string),
  }
}

export async function submitPlayoffBracketEntry(input: {
  challengeId: string
  entryId: string
  userId: string
}) {
  const entry = await (prisma as any).playoffBracketEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      userId: true,
      challengeId: true,
    },
  })

  if (!entry || entry.challengeId !== input.challengeId || entry.userId !== input.userId) {
    throw new Error("Entry not found")
  }

  const [seriesCount, pickCount] = await Promise.all([
    (prisma as any).playoffBracketSeries.count({
      where: { challengeId: input.challengeId },
    }),
    (prisma as any).playoffBracketPick.count({
      where: {
        challengeId: input.challengeId,
        entryId: input.entryId,
      },
    }),
  ])

  if (seriesCount < 1) {
    throw new Error("Bracket is not ready yet")
  }

  if (pickCount < seriesCount) {
    throw new Error("Complete every series before submitting")
  }

  // Persist submission timestamp (idempotent — updates on re-submit)
  await (prisma as any).playoffBracketEntry.update({
    where: { id: input.entryId },
    data: { submittedAt: new Date() },
  })

  return {
    challengeId: input.challengeId,
    entryId: input.entryId,
    redirectUrl: toChallengeDashboardHref(input.challengeId),
  }
}

export async function savePlayoffBracketPick(input: {
  challengeId: string
  entryId: string
  userId: string
  seriesId: string
  pickTeamName: string
}) {
  const entry = await (prisma as any).playoffBracketEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      userId: true,
      challengeId: true,
      isLocked: true,
    },
  })

  if (!entry || entry.challengeId !== input.challengeId || entry.userId !== input.userId) {
    throw new Error("Entry not found")
  }

  if (entry.isLocked) {
    throw new Error("LOCKED: This bracket is locked — the first game has already started")
  }

  const series = await (prisma as any).playoffBracketSeries.findUnique({
    where: { id: input.seriesId },
    select: {
      id: true,
      challengeId: true,
      homeTeamName: true,
      awayTeamName: true,
    },
  })

  if (!series || series.challengeId !== input.challengeId) {
    throw new Error("Series not found")
  }

  if (![series.homeTeamName, series.awayTeamName].includes(input.pickTeamName)) {
    throw new Error("Pick team must be one of the teams in this series")
  }

  const pick = await (prisma as any).playoffBracketPick.upsert({
    where: {
      entryId_seriesId: {
        entryId: input.entryId,
        seriesId: input.seriesId,
      },
    },
    create: {
      challengeId: input.challengeId,
      entryId: input.entryId,
      seriesId: input.seriesId,
      pickTeamName: input.pickTeamName,
    },
    update: {
      pickTeamName: input.pickTeamName,
    },
  })

  return pick
}
