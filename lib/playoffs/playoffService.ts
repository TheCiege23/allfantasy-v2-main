import "server-only"
import { prisma } from "@/lib/prisma"
import { hasPoolAdminAccess } from "@/lib/auth/admin"
import { buildPlayoffTemplate, getPlayoffRoundOrder } from "./playoffTemplate"
import { resolvePlayoffSeedField } from "./playoffSeeding"
import { readSingleGameSchedule } from "./singleGameSchedule"
import type { PlayoffChallengeConfig, PlayoffChallengeListItem, PlayoffChallengeView, PlayoffCreateResponse, PlayoffSport } from "./types"
import { getDependentPlayoffSeriesIds, isOfficialTeamName } from "./playoffBracketProjection"
import { nflDivisionalMatchups } from "./nflPlayoffs"
import { nflSeriesRows, readNflPlayoffsSnapshot } from "./syncNflPlayoffs"
import { allowsPlayoffLatePicks, canUsePlayoffLatePicks, getPlayoffSeriesLockedReason } from "./playoffLocking"
import { assertBracketOpen, defaultPlayoffSeasonYear, firstGameDeadline, isSingleGameBracketSport, rankBrackets, scoreAndPotential, championshipTotal, FREE_BRACKETS_PER_TOURNAMENT, PAID_BRACKETS_PER_TOURNAMENT } from "./playoffCompetition"
import { EntitlementResolver } from "@/lib/subscription/EntitlementResolver"
import { planFlagsFromSnapshot } from "@/lib/subscription/livePlanFlags"
import { loadBracketTeamProfiles } from "./teamIntelligence"
import { getStoredTeamLogoResolver } from "@/lib/sport-teams/storedTeamLogos"
import { defaultPlayoffChallengeConfig, sanitizePlayoffChallengeConfig } from "./playoffChallengeConfig"
import { hasAfCommissionerPlan } from "@/lib/entitlements/afCommissionerPlan"
import { getPlayoffCompletionSummary } from "./playoffCompletion"
import { eligibleNbaCupPicks, nbaCupLockedReason } from "./nbaCupTournament"
import { nbaCupSeriesRows, readNbaCupSnapshot } from "./nbaCupCache"
import { cfpInviteCode, isPrivateCfpPool, verifyCfpInvite } from "./cfpInvite"

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
  /*
   * ⚠ MLB WAS MISSING AND FELL THROUGH TO "FIFA World Cup Pool" — so an MLB pool
   * created with a blank or one-letter name was titled after the World Cup.
   * Found 2026-10-01 while adding the CFP. Every PlayoffSport is named explicitly
   * now; only the literal "fifa" reaches the last line.
   */
  if (sport === "mlb") return "MLB Postseason Pool"
  if (sport === "ncaaf") return "College Football Playoff Pool"
  if (sport === "nba_cup") return "NBA Cup Bracket League"
  if (sport === "nfl") return "NFL Playoffs Pool"
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
  // The creator's real plan decides which AF Commissioner options the pool keeps. This used to
  // be the test-account allowlist, so a paying commissioner's options were silently dropped.
  const config = sanitizePlayoffChallengeConfig(input.config, {
    afCommissionerEnabled: await hasAfCommissionerPlan(input.user),
  })
  // Fail before writing if a private CFP pool cannot issue secure invitations.
  if (isPrivateCfpPool(input.sport, config)) cfpInviteCode("configurationcheck")
  // Live single-game pools use one fair lock and scoring rule, even for direct API requests.
  if (!input.isTestMode && (input.sport === "ncaaf" || input.sport === "nba_cup" || input.sport === "nfl")) {
    config.lockRule = "series_start"
    config.scoringStyle = "round_points"
  }

  const seasonYear = input.seasonYear ?? defaultPlayoffSeasonYear(input.sport)
  const baseTemplate = buildPlayoffTemplate({
    sport: input.sport,
    seasonYear,
    isTestMode: input.isTestMode,
  })
  // A pool created after the official field is published must begin with real
  // teams. Earlier pools are migrated when the admin publishes the field.
  const field = !input.isTestMode && (input.sport === "ncaaf" || input.sport === "nfl")
    ? await resolvePlayoffSeedField(input.sport, seasonYear)
    : null
  /*
   * NFL: games the scheduled writer has already placed (times, and later the
   * reseeded divisional matchups and results), so a pool made mid-postseason
   * starts current instead of waiting fifteen minutes for the next sync.
   */
  const nflPlaced = !input.isTestMode && input.sport === "nfl" && field?.isFinal
    ? nflSeriesRows((await readNflPlayoffsSnapshot(seasonYear))?.games ?? [], field.seeds).rows
    : []
  const schedule = !input.isTestMode && input.sport === "ncaaf"
    ? await readSingleGameSchedule(input.sport, seasonYear)
    : null
  const scheduledTemplate = baseTemplate.map((row) => ({
    ...row,
    startsAt: schedule?.games.find((game) => game.seriesNumber === row.seriesNumber)?.startsAt ?? row.startsAt,
  }))
  // NFL: like the CFP, a bracket league cannot be created once the first game has kicked off.
  const nflWildCardTimes = nflPlaced.filter((row) => row.seriesNumber <= 6).map((row) => ({ startsAt: row.startsAt?.toISOString() ?? null }))
  const nflDeadline = nflWildCardTimes.length === 6 ? firstGameDeadline(nflWildCardTimes) : null
  if (nflDeadline != null && Date.now() >= nflDeadline) {
    throw new Error("The NFL playoffs have started. New bracket leagues are closed.")
  }
  if (!input.isTestMode && input.sport === "ncaaf" && schedule &&
      firstGameDeadline(scheduledTemplate) != null && Date.now() >= firstGameDeadline(scheduledTemplate)!) {
    throw new Error("This tournament has started. New bracket leagues are closed.")
  }
  const template = field?.isFinal
    ? scheduledTemplate.map((row) => {
        const seededName = (name: string) => {
          const hit = /^(?:CFP|EAST|WEST|AFC|NFC)(\d+)$/i.exec(name)
          return hit ? field.seeds.get(row.conference)?.get(Number(hit[1])) ?? name : name
        }
        return { ...row, homeTeamName: seededName(row.homeTeamName), awayTeamName: seededName(row.awayTeamName) }
      })
    : scheduledTemplate

  const automaticCup = !input.isTestMode && input.sport === "nba_cup"
    ? nbaCupSeriesRows((await readNbaCupSnapshot(seasonYear))?.games ?? []) : []
  const result = await prisma.$transaction(async (tx) => {
    const challengeData: Record<string, unknown> = {
      ownerUserId: input.user.id,
      name: challengeName,
      sport: input.sport,
      seasonYear,
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

    for (const game of nflPlaced) {
      await (tx as any).playoffBracketSeries.update({ where: { challengeId_seriesNumber: { challengeId: challenge.id, seriesNumber: game.seriesNumber } }, data: { ...game, lastSyncedAt: new Date() } })
    }

    if (automaticCup.length) {
      await (tx as any).playoffBracketSeries.createMany({
        data: automaticCup.filter((game) => game.round === "cup_group_play").map((game) => ({ ...game, challengeId: challenge.id, lastSyncedAt: new Date() })),
      })
      for (const game of automaticCup.filter((game) => game.round !== "cup_group_play")) {
        await (tx as any).playoffBracketSeries.update({ where: { challengeId_seriesNumber: { challengeId: challenge.id, seriesNumber: game.seriesNumber } }, data: { ...game, lastSyncedAt: new Date() } })
      }
    }

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
      inviteCode: isPrivateCfpPool(challenge.sport, challenge.config)
        ? challenge.ownerUserId === userId ? cfpInviteCode(challenge.id) : ""
        : toInviteCode(challenge.id),
      config: challenge.config ?? defaultPlayoffChallengeConfig(),
    }
  })
}

export async function getPlayoffBracketView(input: {
  challengeId: string
  user: SessionUser | null
  requestedEntryId?: string | null
  inviteCode?: string | null
  /** Only for trusted server-side jobs; never derived from a request. */
  trustedInternal?: boolean
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

  const privateCfp = isPrivateCfpPool(challenge.sport, challenge.config)
  const isCfpMember = Boolean(input.user?.id && (input.user.id === challenge.ownerUserId ||
    challenge.entries.some((entry: { userId: string }) => entry.userId === input.user!.id)))
  if (privateCfp && !input.trustedInternal && !isCfpMember && !verifyCfpInvite(challenge.id, input.inviteCode)) return null

  const singleGameSport = !challenge.isTestMode && isSingleGameBracketSport(challenge.sport)
  const seasonSchedule = singleGameSport && challenge.sport === "ncaaf" ? await readSingleGameSchedule(challenge.sport, challenge.seasonYear) : null
  const scheduleByNumber = new Map(seasonSchedule?.games.map((game) => [game.seriesNumber, game]) ?? [])
  const firstStart = singleGameSport ? firstGameDeadline(challenge.series) : null
  const userId = input.user?.id ?? null
  let viewerTournamentBracketLimit: number | null = null
  let viewerTournamentBracketUsed: number | null = null
  if (singleGameSport && userId) {
    const [snapshot, used] = await Promise.all([
      new EntitlementResolver().resolveSnapshot(userId, input.user?.email).catch(() => null),
      (prisma as any).playoffBracketEntry.count({
        where: { userId, challenge: { sport: challenge.sport, seasonYear: challenge.seasonYear, isTestMode: false } },
      }),
    ])
    viewerTournamentBracketLimit = snapshot && planFlagsFromSnapshot(snapshot).pro
      ? PAID_BRACKETS_PER_TOURNAMENT
      : FREE_BRACKETS_PER_TOURNAMENT
    viewerTournamentBracketUsed = used
  }
  // The pool's options belong to its OWNER's plan, not the viewer's: a member without AF
  // Commissioner still sees (and is scored by) the spread or series-length picks the owner set up.
  const config = sanitizePlayoffChallengeConfig(challenge.config ?? null, {
    afCommissionerEnabled: await hasAfCommissionerPlan(
      input.user?.id && input.user.id === challenge.ownerUserId ? input.user : { id: challenge.ownerUserId },
    ),
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
  const teamNames = challengeSeries.flatMap((game: any) => [game.homeTeamName, game.awayTeamName]) as string[]
  const [teamProfiles, teamLogos] = singleGameSport
    ? await Promise.all([
        loadBracketTeamProfiles(challenge.sport, challenge.seasonYear, teamNames),
        (async (): Promise<Record<string, string>> => {
          const resolveLogo = await getStoredTeamLogoResolver(challenge.sport === "nba_cup" ? "NBA" : challenge.sport === "nfl" ? "NFL" : "NCAAF")
          const logos: Record<string, string> = {}
          for (const name of new Set(teamNames)) {
            // A seed slot or projected winner is not a team identity.
            if (!isOfficialTeamName(name) || /^(?:CFP|EAST|WEST)\d+$/i.test(name)) continue
            const url = resolveLogo(name)
            if (url) logos[name] = url
          }
          return logos
        })(),
      ])
    : [{}, {}]
  const totalSeries = challengeSeries.length
  const completionEntryId = activeEntry?.id ?? null
  const picks = activeEntry
    ? await (prisma as any).playoffBracketPick.findMany({
        where: { entryId: activeEntry.id },
        orderBy: [{ createdAt: "asc" }],
      })
    : []
  const completionPicks = challenge.sport === "nba_cup" && !challenge.isTestMode
    ? picks.map((pick: any) => ({ ...pick, pickTeamName: pick.draftTeamName ?? pick.pickTeamName }))
    : picks
  const completion = getPlayoffCompletionSummary(challengeSeries, completionPicks, {
    sport: challenge.sport,
    lockRule,
    isPoolOwner,
    isTestMode: challenge.isTestMode === true,
    hasPoolAdminAccess: viewerHasPoolAdminAccess,
  })

  const allEntryPicks = await (prisma as any).playoffBracketPick.findMany({
    where: { challengeId: challenge.id },
    select: { entryId: true, seriesId: true, pickTeamName: true, confirmedAt: true },
  })

  const pickCountByEntryId = new Map<string, number>()
  for (const pick of allEntryPicks) {
    pickCountByEntryId.set(pick.entryId, (pickCountByEntryId.get(pick.entryId) ?? 0) + 1)
  }

  const scoreByEntryId = new Map<string, ReturnType<typeof scoreAndPotential>>()
  for (const entry of challengeEntries) {
    scoreByEntryId.set(
      entry.id,
      /*
       * `round` and the sport are both required for weighted scoring. Passing
       * the sport is what makes an MLB World Series pick worth 30 rather than
       * 1; NBA and NHL are absent from the weight table on purpose, so they
       * keep flat scoring and their 26 live pools are not restated.
       */
      scoreAndPotential(
        challengeSeries,
        challenge.sport === "nba_cup" && !challenge.isTestMode
          ? eligibleNbaCupPicks(challengeSeries, allEntryPicks.filter((pick: any) => pick.entryId === entry.id), entry.finalizedAt)
          : allEntryPicks.filter((pick: any) => pick.entryId === entry.id),
        challenge.sport as PlayoffSport
      )
    )
  }
  const finalTotal = championshipTotal(challengeSeries)
  const ranks = new Map(rankBrackets(
    challengeEntries.filter((entry: any) => entry.finalizedAt).map((entry: any) => ({
      id: entry.id,
      totalScore: scoreByEntryId.get(entry.id)?.totalScore ?? 0,
      potentialTotal: scoreByEntryId.get(entry.id)?.potentialTotal ?? 0,
      correctPicks: scoreByEntryId.get(entry.id)?.correctPicks ?? 0,
      tiebreakerTotalScore: entry.tiebreakerTotalScore ?? null,
    })),
    finalTotal,
  ).map((entry) => [entry.id, entry.rank]))
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
    viewerTournamentBracketLimit,
    viewerTournamentBracketUsed,
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
      firstGameStartsAt: firstStart == null ? null : new Date(firstStart).toISOString(),
      config,
      inviteCode: privateCfp
        ? input.user?.id === challenge.ownerUserId ? cfpInviteCode(challenge.id) : ""
        : toInviteCode(challenge.id),
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
          isComplete: singleGameSport ? Boolean(activeEntry.finalizedAt) : activeEntry.id === completionEntryId ? completion.isSubmittable : (pickCountByEntryId.get(activeEntry.id) ?? 0) >= totalSeries,
          finalizedAt: toIso(activeEntry.finalizedAt),
          tiebreakerTotalScore: activeEntry.tiebreakerTotalScore ?? null,
          rank: ranks.get(activeEntry.id) ?? null,
          potentialTotal: scoreByEntryId.get(activeEntry.id)?.potentialTotal ?? 0,
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
      isComplete: singleGameSport ? Boolean(entry.finalizedAt) : entry.id === completionEntryId ? completion.isSubmittable : (pickCountByEntryId.get(entry.id) ?? 0) >= totalSeries,
      finalizedAt: toIso(entry.finalizedAt),
      rank: ranks.get(entry.id) ?? null,
      potentialTotal: scoreByEntryId.get(entry.id)?.potentialTotal ?? 0,
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
      gameLabel: series.providerGamesJson?.gameLabel || scheduleByNumber.get(series.seriesNumber)?.label || null,
      location: series.providerGamesJson?.location || scheduleByNumber.get(series.seriesNumber)?.location || null,
      homeTeamWins: series.homeTeamWins ?? 0,
      awayTeamWins: series.awayTeamWins ?? 0,
      seriesSummary: series.seriesSummary ?? null,
      nextGameAt: toIso(series.nextGameAt),
      venue: challenge.sport === "nba_cup" ? series.venue || null : scheduleByNumber.get(series.seriesNumber)?.venue || series.venue || null,
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
    teamProfiles,
    teamLogos,
    nbaCupLastSyncedAt: challenge.sport === "nba_cup" ? (await readNbaCupSnapshot(challenge.seasonYear).catch(() => null))?.syncedAt || null : null,
    picks: picks.map((pick: any) => ({
      id: pick.id,
      entryId: pick.entryId,
      seriesId: pick.seriesId,
      pickTeamName: challenge.sport === "nba_cup" && !challenge.isTestMode &&
        !nbaCupLockedReason(challengeSeries.find((s: any) => s.id === pick.seriesId) ?? {})
        ? pick.draftTeamName ?? pick.pickTeamName
        : pick.pickTeamName,
      confirmedAt: toIso(pick.confirmedAt),
      confirmedTeamName: pick.confirmedAt ? pick.pickTeamName : null,
      draftTeamName: pick.draftTeamName ?? null,
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
  inviteCode?: string | null
}) {
  if (!input.user.id) {
    throw new Error("Authenticated user required")
  }

  const challenge = await (prisma as any).playoffBracketChallenge.findUnique({
    where: { id: input.challengeId },
    select: { id: true, ownerUserId: true, config: true, sport: true, seasonYear: true, isTestMode: true, series: { select: { startsAt: true } } },
  })
  if (!challenge) {
    throw new Error("Challenge not found")
  }
  if (!challenge.isTestMode && isSingleGameBracketSport(challenge.sport)) {
    if (challenge.sport !== "nba_cup") assertBracketOpen(challenge.series)
    const snapshot = await new EntitlementResolver().resolveSnapshot(input.user.id, input.user.email).catch(() => null)
    const paid = Boolean(snapshot && planFlagsFromSnapshot(snapshot).pro)
    const limit = paid ? PAID_BRACKETS_PER_TOURNAMENT : FREE_BRACKETS_PER_TOURNAMENT
    const used = await (prisma as any).playoffBracketEntry.count({
      where: { userId: input.user.id, challenge: { sport: challenge.sport, seasonYear: challenge.seasonYear, isTestMode: false } },
    })
    if (used >= limit) throw new Error(`Tournament bracket limit reached (${limit}). Extra brackets are an AF subscription benefit, never an entry fee or prize contribution.`)
  }

  /*
   * 🛑 THE CAPS WERE STORED, REPORTED TO THE CLIENT, AND NEVER ENFORCED.
   *
   * `getPlayoffBracketView` already returns `maxParticipants` and `maxEntriesPerParticipant`
   * to the UI, so a pool has been DISPLAYING its limits while this function ignored the config
   * entirely and allowed a hard-coded 5 entries per user. The displayed number was the honest
   * one; the server was the liar. These now read the same config the view renders.
   *
   * `afCommissionerEnabled` is intentionally NOT passed: the caps are plain numbers on the
   * base config, not gated features, so a lapsed subscription must not silently uncap a pool.
   */
  const config = sanitizePlayoffChallengeConfig(challenge.config ?? null)
  const maxEntriesPerParticipant = config.maxEntriesPerParticipant
  const maxParticipants = config.maxParticipants

  const existingEntries = await (prisma as any).playoffBracketEntry.findMany({
    where: {
      challengeId: input.challengeId,
      userId: input.user.id,
    },
    orderBy: { createdAt: "asc" },
  })

  if (isPrivateCfpPool(challenge.sport, challenge.config) && challenge.ownerUserId !== input.user.id &&
      existingEntries.length === 0 && !verifyCfpInvite(challenge.id, input.inviteCode)) {
    throw new Error("A valid CFP invitation is required to join this pool.")
  }

  if (existingEntries.length >= maxEntriesPerParticipant) {
    throw new Error(
      maxEntriesPerParticipant === 1
        ? "This pool allows one bracket per person."
        : `Entry limit reached (max ${maxEntriesPerParticipant} per person).`,
    )
  }

  /*
   * The participant cap counts PEOPLE, not entries, and only bites a NEW participant —
   * someone who already has an entry is inside the pool and is bounded by the per-person cap
   * above. Counting entries here instead would refuse a second bracket in a pool with room.
   */
  if (existingEntries.length === 0) {
    const distinctParticipants: Array<{ userId: string }> = await (
      prisma as any
    ).playoffBracketEntry.findMany({
      where: { challengeId: input.challengeId },
      select: { userId: true },
      distinct: ["userId"],
    })
    if (distinctParticipants.length >= maxParticipants) {
      throw new Error(`This pool is full (${maxParticipants} participants).`)
    }
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

async function lockCupEntryAndGames(tx: any, challengeId: string, entryId: string) {
  // Keep old app instances compatible during rollout without auto-confirming new drafts.
  await tx.$queryRaw`SELECT set_config('allfantasy.cup_daily_mode', 'on', true)`
  // A save, a day confirmation and provider result updates must not interleave.
  await tx.$queryRaw`SELECT id FROM playoff_bracket_entries WHERE id = ${entryId} FOR UPDATE`
  await tx.$queryRaw`SELECT id FROM playoff_bracket_series WHERE challenge_id = ${challengeId} ORDER BY id FOR UPDATE`
}

export async function finalizeNbaCupDay(input: {
  challengeId: string
  entryId: string
  userId: string
  day: string
  timeZone: string
}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) throw new Error("Invalid game date.")
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: input.timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
  } catch {
    throw new Error("Invalid time zone.")
  }
  const dayOf = (start: Date | string) => {
    const parts = formatter.formatToParts(new Date(start))
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
    return `${value("year")}-${value("month")}-${value("day")}`
  }
  const owner = await (prisma as any).playoffBracketEntry.findUnique({
    where: { id: input.entryId },
    select: { userId: true, challengeId: true },
  })
  if (!owner || owner.userId !== input.userId || owner.challengeId !== input.challengeId) throw new Error("Entry not found.")
  return prisma.$transaction(async (tx) => {
    const db = tx as any
    await lockCupEntryAndGames(tx, input.challengeId, input.entryId)
    const entry = await db.playoffBracketEntry.findUnique({
      where: { id: input.entryId },
      select: { id: true, userId: true, challengeId: true, challenge: { select: { sport: true, isTestMode: true } } },
    })
    if (!entry || entry.userId !== input.userId || entry.challengeId !== input.challengeId ||
      entry.challenge?.sport !== "nba_cup" || entry.challenge?.isTestMode) throw new Error("Entry not found.")
    const games = await db.playoffBracketSeries.findMany({
      where: { challengeId: input.challengeId },
    })
    const open = games.filter((game: any) => game.startsAt && dayOf(game.startsAt) === input.day &&
      !nbaCupLockedReason({ ...game, startsAt: toIso(game.startsAt) }))
    if (!open.length) throw new Error("No open games on this day.")
    const picks = await db.playoffBracketPick.findMany({
      where: { entryId: input.entryId, seriesId: { in: open.map((game: any) => game.id) } },
    })
    for (const game of open) {
      const pick = picks.find((p: any) => p.seriesId === game.id)
      if (!pick || ![game.homeTeamName, game.awayTeamName].includes(pick.draftTeamName ?? pick.pickTeamName)) {
        throw new Error("Pick every open game on this day before finalizing.")
      }
    }
    for (const game of open) {
      const confirmedAt = new Date()
      if (new Date(game.startsAt).getTime() <= confirmedAt.getTime()) throw new Error("A game just started. Refresh and try again.")
      const pick = picks.find((p: any) => p.seriesId === game.id)
      if (!pick.confirmedAt || pick.draftTeamName) {
        await db.playoffBracketPick.update({
          where: { id: pick.id },
          data: { pickTeamName: pick.draftTeamName ?? pick.pickTeamName, draftTeamName: null, confirmedAt },
        })
      }
    }
    await db.playoffBracketEntry.updateMany({ where: { id: input.entryId, finalizedAt: null }, data: { finalizedAt: new Date() } })
    return { challengeId: input.challengeId, entryId: input.entryId, confirmed: open.length }
  }, { isolationLevel: "Serializable" })
}

export async function submitPlayoffBracketEntry(input: {
  challengeId: string
  entryId: string
  userId: string
  user?: SessionUser | null
  tiebreakerTotalScore?: number | null
}) {
  const entry = await (prisma as any).playoffBracketEntry.findUnique({
    where: { id: input.entryId },
    select: {
      id: true,
      userId: true,
      challengeId: true,
      finalizedAt: true,
      tiebreakerTotalScore: true,
      challenge: {
        select: {
          config: true,
          isTestMode: true,
          ownerUserId: true,
          sport: true,
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
      select: { id: true, entryId: true, seriesId: true, pickTeamName: true, draftTeamName: true, confirmedAt: true, createdAt: true, updatedAt: true },
    }),
  ])

  if (series.length < 1) {
    throw new Error("Bracket is not ready yet")
  }

  // lockRule is on the base config, not an AF Commissioner option, so no plan check is needed.
  const lockRule = sanitizePlayoffChallengeConfig(entry.challenge?.config ?? null).lockRule
  const completionPicks = entry.challenge?.sport === "nba_cup" && !entry.challenge?.isTestMode
    ? picks.map((pick: any) => ({ ...pick, pickTeamName: pick.draftTeamName ?? pick.pickTeamName }))
    : picks
  const completion = getPlayoffCompletionSummary(series, completionPicks, {
    sport: entry.challenge?.sport,
    lockRule,
    isPoolOwner: entry.challenge?.ownerUserId === input.userId,
    isTestMode: entry.challenge?.isTestMode === true,
    hasPoolAdminAccess: hasPoolAdminAccess(input.user),
  })

  if (!completion.isSubmittable) {
    throw new Error(completion.message)
  }
  if (!entry.challenge?.isTestMode && isSingleGameBracketSport(entry.challenge?.sport)) {
    const rollingCup = entry.challenge.sport === "nba_cup"
    if (!rollingCup) assertBracketOpen(series)
    const guess = input.tiebreakerTotalScore
    if ((!rollingCup || guess !== undefined) && (!Number.isInteger(guess) || Number(guess) < 0 || Number(guess) > 500)) {
      throw new Error("Enter a final-game combined score from 0 to 500 to finalize.")
    }
    const championship = series.find((game: any) => game.round === "cup_championship")
    const finalLocked = rollingCup && championship && (championship.status !== "scheduled" || (championship.startsAt && new Date(championship.startsAt).getTime() <= Date.now()))
    if (finalLocked && guess !== undefined && guess !== entry.tiebreakerTotalScore) throw new Error("The championship tiebreaker locked at tipoff.")
    // Keep the first Cup submission timestamp: subsequent edits must not invalidate earlier earned picks.
    if (rollingCup) {
      await prisma.$transaction(async (tx) => {
        await lockCupEntryAndGames(tx, input.challengeId, input.entryId)
        const now = new Date()
        const freshGames = await (tx as any).playoffBracketSeries.findMany({ where: { challengeId: input.challengeId } })
        const freshPicks = await (tx as any).playoffBracketPick.findMany({ where: { entryId: input.entryId } })
        for (const game of freshGames) {
          if (nbaCupLockedReason({ ...game, startsAt: toIso(game.startsAt) })) continue
          const pick = freshPicks.find((candidate: any) => candidate.seriesId === game.id)
          const selected = pick?.draftTeamName ?? pick?.pickTeamName
          if (!pick || ![game.homeTeamName, game.awayTeamName].includes(selected)) throw new Error("Pick every open game before finalizing the pool.")
          if (!pick.confirmedAt || pick.draftTeamName) {
            await (tx as any).playoffBracketPick.update({
              where: { id: pick.id },
              data: { pickTeamName: selected, draftTeamName: null, confirmedAt: now },
            })
          }
        }
        await (tx as any).playoffBracketEntry.updateMany({ where: { id: entry.id, finalizedAt: null }, data: { finalizedAt: new Date() } })
        if (guess !== undefined) {
          await (tx as any).playoffBracketEntry.update({ where: { id: entry.id }, data: { tiebreakerTotalScore: guess } })
        }
      }, { isolationLevel: "Serializable" })
    } else {
      await (prisma as any).playoffBracketEntry.update({ where: { id: entry.id }, data: { finalizedAt: new Date(), tiebreakerTotalScore: Number(guess) } })
    }
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
  confirmationMode?: "per_day"
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
          sport: true,
          seasonYear: true,
        },
      },
    },
  })

  if (!series || series.challengeId !== input.challengeId) {
    throw new Error("Series not found")
  }
  const rollingCup = !series.challenge?.isTestMode && series.challenge?.sport === "nba_cup"
  if (rollingCup) {
    if (input.confirmationMode !== "per_day") throw new Error("Refresh this page before saving NBA Cup picks; game-day finalization is now required.")
    const reason = nbaCupLockedReason({ ...series, startsAt: toIso(series.startsAt) })
    if (reason) throw new Error(reason)
  }
  const fixedLockPool = !series.challenge?.isTestMode && (series.challenge?.sport === "ncaaf" || series.challenge?.sport === "nfl")
  if (fixedLockPool) {
    const starts = await (prisma as any).playoffBracketSeries.findMany({
      where: { challengeId: input.challengeId }, select: { startsAt: true, round: true },
    })
    assertBracketOpen(starts)
  }

  if (fixedLockPool) {
    const field = await resolvePlayoffSeedField(series.challenge.sport, series.challenge.seasonYear)
    if (!field.isFinal) throw new Error("Official tournament field is pending.")
    // NFL rounds after the Wild Card are scheduled only as the round before ends; the
    // bracket's lock is the Wild Card kickoff (assertBracketOpen), not each game's own time.
    if (series.challenge?.sport === "ncaaf" && !series.startsAt) throw new Error("Official game schedule is pending.")
  }

  // lockRule is on the base config, not an AF Commissioner option, so no plan check is needed.
  const singleGameLivePool = !series.challenge?.isTestMode &&
    (series.challenge?.sport === "ncaaf" || series.challenge?.sport === "nba_cup" || series.challenge?.sport === "nfl")
  const lockRule = singleGameLivePool
    ? "series_start"
    : sanitizePlayoffChallengeConfig(series.challenge?.config ?? null).lockRule
  const lockedReason = getPlayoffSeriesLockedReason({
    status: series.status,
    startsAt: toIso(series.startsAt),
  }, lockRule, {
    isPoolOwner: !singleGameLivePool && series.challenge?.ownerUserId === input.userId,
    isTestMode: series.challenge?.isTestMode === true,
    hasPoolAdminAccess: !singleGameLivePool && hasPoolAdminAccess(input.user),
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

  const dependentSeriesIds = rollingCup ? new Set<string>() : getDependentPlayoffSeriesIds(input.seriesId, allSeries)
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
  let homeName = selectedSeries.sourceSeriesHome && !isOfficialTeamName(selectedSeries.homeTeamName)
    ? projectedPickBySeriesNumber.get(selectedSeries.sourceSeriesHome) ?? selectedSeries.homeTeamName
    : selectedSeries.homeTeamName
  let awayName = selectedSeries.sourceSeriesAway && !isOfficialTeamName(selectedSeries.awayTeamName)
    ? projectedPickBySeriesNumber.get(selectedSeries.sourceSeriesAway) ?? selectedSeries.awayTeamName
    : selectedSeries.awayTeamName
  /*
   * NFL divisional games are reseeded from the entry's own Wild Card picks — the same
   * matchup `buildProjectedPlayoffSeries` shows. Until all three of the conference's Wild
   * Card picks exist, the slots keep their placeholder names and the pick is refused below.
   */
  if (selectedSeries.round === "nfl_divisional") {
    const matchup = nflDivisionalMatchups(allSeries, projectedPickBySeriesNumber).get(selectedSeries.seriesNumber)
    if (matchup) { homeName = matchup.homeTeamName; awayName = matchup.awayTeamName }
    else if (!isOfficialTeamName(homeName) || !isOfficialTeamName(awayName)) throw new Error("Pick every Wild Card game in this conference first.")
  }

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
    if (rollingCup) {
      await lockCupEntryAndGames(tx, input.challengeId, input.entryId)
      const fresh = await (tx as any).playoffBracketSeries.findUnique({ where: { id: input.seriesId } })
      if (!fresh || fresh.challengeId !== input.challengeId) throw new Error("Game not found")
      const reason = nbaCupLockedReason({ ...fresh, startsAt: toIso(fresh.startsAt) })
      if (reason) throw new Error(reason)
      if (![fresh.homeTeamName, fresh.awayTeamName].includes(input.pickTeamName)) throw new Error("The confirmed matchup changed. Refresh before picking.")
    } else if (singleGameLivePool) assertBracketOpen(allSeries)
    if (dependentSeriesIds.size > 0) {
      await (tx as any).playoffBracketPick.deleteMany({
        where: {
          entryId: input.entryId,
          seriesId: { in: Array.from(dependentSeriesIds) },
        },
      })
    }

    if (singleGameLivePool && !rollingCup) {
      await (tx as any).playoffBracketEntry.update({ where: { id: input.entryId }, data: { finalizedAt: null } })
    }
    if (rollingCup) {
      const previous = await (tx as any).playoffBracketPick.findUnique({
        where: { entryId_seriesId: { entryId: input.entryId, seriesId: input.seriesId } },
      })
      // Keep the last confirmed pick untouched until this day's draft is finalized.
      return (tx as any).playoffBracketPick.upsert({
        where: { entryId_seriesId: { entryId: input.entryId, seriesId: input.seriesId } },
        create: { challengeId: input.challengeId, entryId: input.entryId, seriesId: input.seriesId, pickTeamName: input.pickTeamName },
        update: previous?.confirmedAt
          ? { draftTeamName: previous.pickTeamName === input.pickTeamName ? null : input.pickTeamName }
          : { pickTeamName: input.pickTeamName, draftTeamName: null },
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
