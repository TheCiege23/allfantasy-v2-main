import "server-only"
import { prisma } from "@/lib/prisma"
import { hasPoolAdminAccess } from "@/lib/auth/admin"
import { buildPlayoffTemplate, getPlayoffRoundOrder } from "./playoffTemplate"
import type { PlayoffChallengeConfig, PlayoffChallengeListItem, PlayoffChallengeView, PlayoffCreateResponse, PlayoffSport } from "./types"
import { getDependentPlayoffSeriesIds, isOfficialTeamName } from "./playoffBracketProjection"
import { allowsPlayoffLatePicks, canUsePlayoffLatePicks, getPlayoffSeriesLockedReason } from "./playoffLocking"
import { scorePlayoffEntryPicks } from "./playoffScoring"
import { defaultPlayoffChallengeConfig, isAfCommissionerSubscriber, sanitizePlayoffChallengeConfig } from "./playoffChallengeConfig"
import { getPlayoffCompletionSummary } from "./playoffCompletion"

type SessionUser = {
  id?: string | null
  name?: string | null
  displayName?: string | null
  username?: string | null
  email?: string | null
}

type CreatePlayoffChallengeOptions = {
  includeConfig?: boolean
  includeSeriesProviderMetadata?: boolean
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
  config?: Partial<PlayoffChallengeConfig> | null
  options?: CreatePlayoffChallengeOptions
}): Promise<PlayoffCreateResponse> {
  if (!input.user.id) {
    throw new Error("Authenticated user required")
  }

  const challengeName = sanitizeChallengeName(input.name, input.sport)
  const config = sanitizePlayoffChallengeConfig(input.config, {
    afCommissionerEnabled: isAfCommissionerSubscriber(input.user),
  })

  const template = buildPlayoffTemplate({
    sport: input.sport,
    seasonYear: input.seasonYear ?? new Date().getUTCFullYear(),
    isTestMode: input.isTestMode,
  })

  const result = await prisma.$transaction(async (tx) => {
    const challengeData: Record<string, unknown> = {
      ownerUserId: input.user.id,
      name: challengeName,
      sport: input.sport,
      seasonYear: input.seasonYear ?? new Date().getUTCFullYear(),
      status: "open",
      isTestMode: Boolean(input.isTestMode),
    }
    if (input.options?.includeConfig !== false) {
      challengeData.config = config
    }
    const challenge = await (tx as any).playoffBracketChallenge.create({
      data: challengeData,
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
        ...(input.options?.includeSeriesProviderMetadata === false
          ? {}
          : {
              homeTeamWins: 0,
              awayTeamWins: 0,
              seriesSummary: null,
              nextGameAt: null,
              venue: null,
              broadcastNetwork: null,
              liveHomeScore: null,
              liveAwayScore: null,
              liveStatus: null,
              providerGamesJson: null,
              lastSyncedAt: null,
            }),
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
      config: challenge.config ?? defaultPlayoffChallengeConfig(),
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
      /*
       * 🛑 `email` IS DELIBERATELY NOT SELECTED. This view feeds an unauthenticated page, and the
       * address was previously the third rung of the public display-name fallback. Not loading it
       * means a future rung cannot reintroduce the leak by reflex — there is nothing to fall back
       * to. Add it back only with a reader that is gated, and a test that proves the gate.
       */
      owner: {
        select: {
          id: true,
          displayName: true,
          username: true,
        },
      },
      entries: {
        include: {
          user: {
            select: {
              id: true,
              displayName: true,
              username: true,
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
  const config = sanitizePlayoffChallengeConfig(challenge.config ?? null, {
    afCommissionerEnabled: isAfCommissionerSubscriber(input.user),
  })
  const lockRule = config.lockRule
  const isPoolOwner = Boolean(userId && challenge.ownerUserId === userId)
  const viewerHasPoolAdminAccess = hasPoolAdminAccess(input.user)
  const viewerCanLatePick = canUsePlayoffLatePicks({
    lockRule,
    isPoolOwner,
    isTestMode: challenge.isTestMode === true,
    hasPoolAdminAccess: viewerHasPoolAdminAccess,
  })
  /*
   * 🛑 AN ENTRY IS ONLY EVER RESOLVED FOR ITS OWN OWNER.
   *
   * `/brackets/leagues/[id]` renders server-side with `session?.user ?? null` and has no auth
   * gate, so whatever this returns for a null user is readable by anyone holding a pool id.
   * This used to honour ANY `requestedEntryId` when there was no user (`if (!userId) return true`)
   * and to fall back to `challenge.entries[0]`, which handed an anonymous visitor the first
   * entrant's bracket and loaded their picks.
   *
   * `activeEntry: null` is not a new state — a signed-in NON-MEMBER already lands there, so every
   * caller handles it. Anonymous now lands in the same place. The pool, its series, the
   * leaderboard and the participant list are still public; one person's picks are not.
   */
  const requestedEntry =
    input.requestedEntryId && userId
      ? challenge.entries.find(
          (entry: { id: string; userId: string }) =>
            entry.id === input.requestedEntryId && entry.userId === userId,
        )
      : null

  const activeEntry =
    requestedEntry ??
    (userId
      ? challenge.entries.find((entry: { userId: string }) => entry.userId === userId)
      : null) ??
    null

  const challengeEntries = Array.isArray(challenge.entries) ? challenge.entries : []
  const challengeSeries = Array.isArray(challenge.series) ? challenge.series : []
  const totalSeries = challengeSeries.length
  const completionEntryId = activeEntry?.id ?? null
  const picks = activeEntry
    ? await (prisma as any).playoffBracketPick.findMany({
        where: { entryId: activeEntry.id },
        orderBy: [{ createdAt: "asc" }],
      })
    : []
  const completion = getPlayoffCompletionSummary(challengeSeries, picks, {
    lockRule,
    isPoolOwner,
    isTestMode: challenge.isTestMode === true,
    hasPoolAdminAccess: viewerHasPoolAdminAccess,
  })

  const allEntryPicks = await (prisma as any).playoffBracketPick.findMany({
    where: { challengeId: challenge.id },
    select: { entryId: true, seriesId: true, pickTeamName: true },
  })

  const pickCountByEntryId = new Map<string, number>()
  for (const pick of allEntryPicks) {
    pickCountByEntryId.set(pick.entryId, (pickCountByEntryId.get(pick.entryId) ?? 0) + 1)
  }

  const scoreByEntryId = new Map<string, ReturnType<typeof scorePlayoffEntryPicks>>()
  for (const entry of challengeEntries) {
    scoreByEntryId.set(
      entry.id,
      /*
       * `round` and the sport are both required for weighted scoring. Passing
       * the sport is what makes an MLB World Series pick worth 30 rather than
       * 1; NBA and NHL are absent from the weight table on purpose, so they
       * keep flat scoring and their 26 live pools are not restated.
       */
      scorePlayoffEntryPicks(
        challengeSeries.map((series: any) => ({
          id: series.id,
          winnerTeamName: series.winnerTeamName,
          round: series.round,
        })),
        allEntryPicks.filter((pick: any) => pick.entryId === entry.id),
        challenge.sport
      )
    )
  }
  const participantMap = new Map<string, { userId: string; displayName: string; entryCount: number }>()
  for (const entry of challengeEntries) {
    const existing = participantMap.get(entry.userId)
    /*
     * 🛑 NO EMAIL RUNG. `participants` is public on an unauthenticated page, so falling back to
     * the address published every entrant who had set neither a display name nor a username.
     * The neutral label below was always there — the email simply sat above it.
     */
    const displayName =
      entry.user?.displayName?.trim() || entry.user?.username?.trim() || "Participant"
    if (!existing) {
      participantMap.set(entry.userId, { userId: entry.userId, displayName, entryCount: 1 })
      continue
    }
    existing.entryCount += 1
  }

  if (!participantMap.has(challenge.ownerUserId)) {
    const ownerDisplayName =
      challenge.owner?.displayName?.trim() || challenge.owner?.username?.trim() || "Commissioner"
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
      visibility: config.visibility,
      maxParticipants: config.maxParticipants,
      maxEntriesPerParticipant: config.maxEntriesPerParticipant,
      scoringStyle: config.scoringStyle,
      lockRule,
      config,
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
          isComplete: activeEntry.id === completionEntryId ? completion.isSubmittable : (pickCountByEntryId.get(activeEntry.id) ?? 0) >= totalSeries,
          totalScore: scoreByEntryId.get(activeEntry.id)?.totalScore ?? 0,
          correctPicks: scoreByEntryId.get(activeEntry.id)?.correctPicks ?? 0,
          resolvedPicks: scoreByEntryId.get(activeEntry.id)?.resolvedPicks ?? 0,
          createdAt: toIso(activeEntry.createdAt) ?? new Date().toISOString(),
        }
      : null,
    entries: challengeEntries.map((entry: any) => ({
      id: entry.id,
      name: entry.name,
      userId: entry.userId,
      pickCount: pickCountByEntryId.get(entry.id) ?? 0,
      isComplete: entry.id === completionEntryId ? completion.isSubmittable : (pickCountByEntryId.get(entry.id) ?? 0) >= totalSeries,
      totalScore: scoreByEntryId.get(entry.id)?.totalScore ?? 0,
      correctPicks: scoreByEntryId.get(entry.id)?.correctPicks ?? 0,
      resolvedPicks: scoreByEntryId.get(entry.id)?.resolvedPicks ?? 0,
      createdAt: toIso(entry.createdAt) ?? new Date().toISOString(),
    })),
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
      bestOf: series.bestOf,
      status: series.status,
      startsAt: toIso(series.startsAt),
      homeTeamWins: series.homeTeamWins ?? 0,
      awayTeamWins: series.awayTeamWins ?? 0,
      seriesSummary: series.seriesSummary ?? null,
      nextGameAt: toIso(series.nextGameAt),
      venue: series.venue ?? null,
      broadcastNetwork: series.broadcastNetwork ?? null,
      liveHomeScore: series.liveHomeScore ?? null,
      liveAwayScore: series.liveAwayScore ?? null,
      liveStatus: series.liveStatus ?? null,
      providerGamesJson: series.providerGamesJson ?? null,
      lastSyncedAt: toIso(series.lastSyncedAt),
      nextGameDateLabel: null,
      nextSeriesNumber: series.nextSeriesNumber,
      nextSeriesSlot: series.nextSeriesSlot,
      sourceSeriesHome: series.sourceSeriesHome,
      sourceSeriesAway: series.sourceSeriesAway,
    })),
    picks: picks.map((pick: any) => ({
      id: pick.id,
      entryId: pick.entryId,
      seriesId: pick.seriesId,
      pickTeamName: pick.pickTeamName,
      createdAt: toIso(pick.createdAt) ?? new Date().toISOString(),
      updatedAt: toIso(pick.updatedAt) ?? new Date().toISOString(),
    })),
    // Sport-scoped: the board renders one column per round key, so a baseball
    // pool handed the conference order would render four empty columns and
    // hide every series it holds.
    rounds: getPlayoffRoundOrder(challenge.sport as PlayoffSport),
    lockDiagnostics: {
      lockRule,
      allowTestLatePicks: allowsPlayoffLatePicks(lockRule),
      viewerCanLatePick,
      isPoolOwner,
      isTestMode: challenge.isTestMode === true,
      hasPoolAdminAccess: viewerHasPoolAdminAccess,
    },
    completion: {
      mode: completion.mode,
      isSubmittable: completion.isSubmittable,
      requiredPickCount: completion.requiredPickCount,
      savedRequiredPickCount: completion.savedRequiredPickCount,
      totalSeriesCount: completion.totalSeriesCount,
      unavailableSeriesCount: completion.unavailableSeriesCount,
      missingRequiredSeriesIds: completion.missingRequiredSeriesIds,
      message: completion.message,
    },
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
  user?: SessionUser | null
}) {
  const entry = await (prisma as any).playoffBracketEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      userId: true,
      challengeId: true,
      challenge: {
        select: {
          config: true,
          isTestMode: true,
          ownerUserId: true,
        },
      },
    },
  })

  if (!entry || entry.challengeId !== input.challengeId || entry.userId !== input.userId) {
    throw new Error("Entry not found")
  }

  const [series, picks] = await Promise.all([
    (prisma as any).playoffBracketSeries.findMany({
      where: { challengeId: input.challengeId },
      orderBy: [{ roundIndex: "asc" }, { seriesNumber: "asc" }],
    }),
    (prisma as any).playoffBracketPick.findMany({
      where: {
        challengeId: input.challengeId,
        entryId: input.entryId,
      },
      select: { id: true, entryId: true, seriesId: true, pickTeamName: true, createdAt: true, updatedAt: true },
    }),
  ])

  if (series.length < 1) {
    throw new Error("Bracket is not ready yet")
  }

  const lockRule = sanitizePlayoffChallengeConfig(entry.challenge?.config ?? null, {
    afCommissionerEnabled: isAfCommissionerSubscriber(input.user),
  }).lockRule
  const completion = getPlayoffCompletionSummary(series, picks, {
    lockRule,
    isPoolOwner: entry.challenge?.ownerUserId === input.userId,
    isTestMode: entry.challenge?.isTestMode === true,
    hasPoolAdminAccess: hasPoolAdminAccess(input.user),
  })

  if (!completion.isSubmittable) {
    throw new Error(completion.message)
  }

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
  user?: SessionUser | null
  seriesId: string
  pickTeamName: string
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

  const series = await (prisma as any).playoffBracketSeries.findUnique({
    where: { id: input.seriesId },
    select: {
      id: true,
      challengeId: true,
      status: true,
      startsAt: true,
      homeTeamName: true,
      awayTeamName: true,
      challenge: {
        select: {
          config: true,
          isTestMode: true,
          ownerUserId: true,
        },
      },
    },
  })

  if (!series || series.challengeId !== input.challengeId) {
    throw new Error("Series not found")
  }

  const lockRule = sanitizePlayoffChallengeConfig(series.challenge?.config ?? null, {
    afCommissionerEnabled: isAfCommissionerSubscriber(input.user),
  }).lockRule
  const lockedReason = getPlayoffSeriesLockedReason({
    status: series.status,
    startsAt: toIso(series.startsAt),
  }, lockRule, {
    isPoolOwner: series.challenge?.ownerUserId === input.userId,
    isTestMode: series.challenge?.isTestMode === true,
    hasPoolAdminAccess: hasPoolAdminAccess(input.user),
  })
  if (lockedReason) {
    throw new Error(lockedReason)
  }

  const allSeries = await (prisma as any).playoffBracketSeries.findMany({
    where: { challengeId: input.challengeId },
    orderBy: [{ roundIndex: "asc" }, { seriesNumber: "asc" }],
  })

  const picks = await (prisma as any).playoffBracketPick.findMany({
    where: { entryId: input.entryId },
  })

  const dependentSeriesIds = getDependentPlayoffSeriesIds(input.seriesId, allSeries)
  const projectedPickBySeriesNumber = new Map<number, string>()
  for (const item of allSeries) {
    const pick = picks.find((candidate: any) => candidate.seriesId === item.id)
    if (item.id === input.seriesId) {
      projectedPickBySeriesNumber.set(item.seriesNumber, input.pickTeamName)
    } else if (pick && !dependentSeriesIds.has(item.id)) {
      projectedPickBySeriesNumber.set(item.seriesNumber, pick.pickTeamName)
    }
  }

  const selectedSeries = allSeries.find((item: any) => item.id === input.seriesId) ?? series
  const homeName = selectedSeries.sourceSeriesHome && !isOfficialTeamName(selectedSeries.homeTeamName)
    ? projectedPickBySeriesNumber.get(selectedSeries.sourceSeriesHome) ?? selectedSeries.homeTeamName
    : selectedSeries.homeTeamName
  const awayName = selectedSeries.sourceSeriesAway && !isOfficialTeamName(selectedSeries.awayTeamName)
    ? projectedPickBySeriesNumber.get(selectedSeries.sourceSeriesAway) ?? selectedSeries.awayTeamName
    : selectedSeries.awayTeamName

  if (selectedSeries.sourceSeriesHome && !isOfficialTeamName(selectedSeries.homeTeamName) && !projectedPickBySeriesNumber.has(selectedSeries.sourceSeriesHome)) {
    throw new Error("Pick earlier round winners first.")
  }

  if (selectedSeries.sourceSeriesAway && !isOfficialTeamName(selectedSeries.awayTeamName) && !projectedPickBySeriesNumber.has(selectedSeries.sourceSeriesAway)) {
    throw new Error("Pick earlier round winners first.")
  }

  if (![homeName, awayName].includes(input.pickTeamName)) {
    throw new Error("Pick team must be one of the teams in this series")
  }

  const pick = await prisma.$transaction(async (tx) => {
    if (dependentSeriesIds.size > 0) {
      await (tx as any).playoffBracketPick.deleteMany({
        where: {
          entryId: input.entryId,
          seriesId: { in: Array.from(dependentSeriesIds) },
        },
      })
    }

    return (tx as any).playoffBracketPick.upsert({
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
  })

  return pick
}
