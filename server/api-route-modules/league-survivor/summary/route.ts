/**
 * GET: Survivor league home summary (tribes, council, challenges, exile, jury, audit). PROMPT 347.
 * Returns 404 when league is not a survivor league.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canAccessLeagueDraft, getCurrentUserRosterIdForLeague } from '@/lib/live-draft-engine/auth'
import { isSurvivorLeague, getSurvivorConfig } from '@/lib/survivor/SurvivorLeagueConfig'
import { getTribesWithMembers } from '@/lib/survivor/SurvivorTribeService'
import { getCouncil } from '@/lib/survivor/SurvivorTribalCouncilService'
import { getChallengesForWeek } from '@/lib/survivor/SurvivorChallengeEngine'
import { getJuryMembers } from '@/lib/survivor/SurvivorJuryEngine'
import { getExileLeagueId } from '@/lib/survivor/SurvivorExileEngine'
import { getAllTokenStates } from '@/lib/survivor/SurvivorTokenEngine'
import { getActiveIdolsForRoster } from '@/lib/survivor/SurvivorIdolRegistry'
import { getSurvivorAuditLog } from '@/lib/survivor/SurvivorAuditLog'
import { getTribeChatSource } from '@/lib/survivor/SurvivorChatMembershipService'
import { isMergeTriggered } from '@/lib/survivor/SurvivorMergeEngine'
import { getActiveEffectsForRoster } from '@/lib/survivor/SurvivorEffectEngine'
import { getFinaleState } from '@/lib/survivor/SurvivorFinaleEngine'
import { canReturnToIsland } from '@/lib/survivor/SurvivorReturnEngine'
import { getCurrentlyEliminatedRosterIds } from '@/lib/survivor/SurvivorRosterState'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'
import { getRosterTeamMap } from '@/lib/zombie/rosterTeamMap'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import {
  parseSurvivorFairPlayFromLeagueSettings,
  redactSurvivorSummaryPayloadForFairPlay,
  shouldApplySurvivorFairPlayRedaction,
} from '@/lib/survivor/survivorFairPlay'
import { seasonWeekBoundsForSport } from '@/lib/survivor/survivorSeasonCalendar'
import { extractLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { getSurvivorSitOutStateForWeek, getSurvivorTribeBalanceState } from '@/lib/survivor/SurvivorSitOutEngine'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'

import { survivorPublicCouncil } from '@/lib/survivor/survivorPublicCouncil'
import { getActiveTribeImmunity } from '@/lib/survivor/survivorTribeImmunity'
import { isCouncilReadComplete } from '@/lib/survivor/survivorRevealGate'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { resolveTribeEmblem } from '@/lib/survivor/survivorTribeIdentity'

export const dynamic = 'force-dynamic'

/** Crest (current name + colours) and decorative mark for a summary tribe; the merged pseudo-tribe has neither. */
function summaryTribeEmblem(t: { name: string; logoUrl?: string | null; catalogId?: string | null; primaryColor?: string | null; secondaryColor?: string | null }, sport: string | null | undefined) {
  const emblem = resolveTribeEmblem({ name: t.name, logoUrl: t.logoUrl ?? null, catalogId: t.catalogId, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor }, sport ?? 'NFL')
  return { logoUrl: emblem.crestUrl, markUrl: emblem.markUrl, mascot: emblem.mascot }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leagueId } = await ctx.params
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const allowed = await canAccessLeagueDraft(leagueId, userId)
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const isSurvivor = await isSurvivorLeague(leagueId)
  if (!isSurvivor) return NextResponse.json({ error: 'Not a survivor league' }, { status: 404 })

  const weekParam = req.nextUrl.searchParams?.get('week')
  const requestedWeek = weekParam ? Math.max(1, parseInt(weekParam, 10)) || 1 : null
  const currentWeek = await resolveSurvivorCurrentWeek(leagueId, requestedWeek)
  const weeklyScoreRows = currentWeek > 0 ? await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, week: currentWeek, countedTowardTribeTotal: true },
    select: { userId: true, tribeId: true, finalScore: true, isFinalized: true, wonIndividualImmunity: true },
  }) : []
  const tribeScores: Record<string, number> = {}
  for (const score of weeklyScoreRows) {
    if (score.tribeId) tribeScores[score.tribeId] = (tribeScores[score.tribeId] ?? 0) + score.finalScore
  }

  const [config, tribesRaw, council, challenges, jury, exileLeagueId, tokenStates, audit, merged, myRosterId, eliminatedRosterIds, mainLeagueRosters, finaleState, leagueSettingsRow, sitOutState, tribeBalance] = await Promise.all([
    getSurvivorConfig(leagueId),
    getTribesWithMembers(leagueId),
    getCouncil(leagueId, currentWeek),
    getChallengesForWeek(leagueId, currentWeek),
    getJuryMembers(leagueId),
    getExileLeagueId(leagueId),
    getExileLeagueId(leagueId).then((id) => (id ? getAllTokenStates(id) : [])),
    prisma.survivorTribalCouncil.findMany({ where: { leagueId, isRevealed: true, eliminatedRosterId: { not: null } }, select: { eliminatedRosterId: true, week: true, isRevealed: true, revealStartsAt: true, revealStep: true, revealSequence: true }, orderBy: { week: 'asc' } }),
    isMergeTriggered(leagueId, currentWeek),
    getCurrentUserRosterIdForLeague(leagueId, userId),
    getCurrentlyEliminatedRosterIds(leagueId),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
    }),
    getFinaleState(leagueId, currentWeek),
    prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
    getSurvivorSitOutStateForWeek(leagueId, currentWeek),
    getSurvivorTribeBalanceState(leagueId, currentWeek),
  ])

  if (!config) return NextResponse.json({ error: 'Config not found' }, { status: 500 })

  const leagueMeta = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true, name: true, survivorRevealMode: true },
  })
  const seasonCalendar = seasonWeekBoundsForSport(leagueMeta?.sport, config.regularSeasonEndWeek ?? null)

  // Only councils whose read has finished name a voted-out manager (see survivorRevealGate).
  const votedOutHistory = audit.filter(row => isCouncilReadComplete(row, leagueMeta?.survivorRevealMode)).map(row => ({ rosterId: row.eliminatedRosterId!, week: row.week }))
  // Weekly necklaces still being worn (until the next lineup lock). Public by design.
  const activeNecklaces = await getActiveTribeImmunity(leagueId)

  const tribes = merged
    ? [
        {
          id: 'merged',
          name: 'Merged Tribe',
          slotIndex: 0,
          members: mainLeagueRosters
            .filter((roster) => !eliminatedRosterIds.has(roster.id))
            .map((roster, index) => ({ rosterId: roster.id, isLeader: index === 0 })),
        },
      ]
    : tribesRaw.map((tribe) => ({
        ...tribe,
        members: tribe.members.filter((member) => !eliminatedRosterIds.has(member.rosterId)),
      }))

  const outWeekByRoster = new Map(votedOutHistory.map(row => [row.rosterId, row.week]))
  const outMembersByTribe = new Map<string, { rosterId: string; week: number | null }[]>()
  if (merged) {
    outMembersByTribe.set('merged', mainLeagueRosters.filter(roster => eliminatedRosterIds.has(roster.id)).map(roster => ({ rosterId: roster.id, week: outWeekByRoster.get(roster.id) ?? null })))
  } else {
    for (const tribe of tribesRaw) {
      outMembersByTribe.set(tribe.id, tribe.members.filter(member => eliminatedRosterIds.has(member.rosterId)).map(member => ({ rosterId: member.rosterId, week: outWeekByRoster.get(member.rosterId) ?? null })))
    }
  }

  const myTribeId =
    !merged && myRosterId
      ? tribes.find((tribe) => tribe.members.some((member) => member.rosterId === myRosterId))?.id ?? null
      : null

  const rosterIds = new Set<string>([
    ...tribes.flatMap((t) => t.members.map((m) => m.rosterId)),
    ...[...outMembersByTribe.values()].flat().map((m) => m.rosterId),
    ...jury.map((j) => j.rosterId),
    ...votedOutHistory.map((v) => v.rosterId!).filter(Boolean),
    ...(myRosterId ? [myRosterId] : []),
  ])

  const mainRosterByPlatformUserId = new Map<string, string>()
  for (const roster of mainLeagueRosters) {
    if (roster.platformUserId) {
      mainRosterByPlatformUserId.set(roster.platformUserId, roster.id)
    }
  }

  const exileMainRosterIdByExileRosterId = new Map<string, string>()
  let exileRosters: { id: string; platformUserId: string | null }[] = []
  if (exileLeagueId) {
    exileRosters = await prisma.roster.findMany({
      where: {
        leagueId: exileLeagueId,
        ...(tokenStates.length > 0 ? { id: { in: tokenStates.map((token) => token.rosterId) } } : {}),
      },
      select: { id: true, platformUserId: true },
    })
    for (const exileRoster of exileRosters) {
      if (!exileRoster.platformUserId) continue
      const mainRosterId = mainRosterByPlatformUserId.get(exileRoster.platformUserId)
      if (!mainRosterId) continue
      exileMainRosterIdByExileRosterId.set(exileRoster.id, mainRosterId)
      rosterIds.add(mainRosterId)
    }
  }

  const rosters = mainLeagueRosters.filter((roster) => rosterIds.has(roster.id))
  const map = await getRosterTeamMap(leagueId)
  const teamIds = [...new Set(rosters.map((r) => map.rosterIdToTeamId.get(r.id)).filter((id): id is string => id != null))]
  const teams =
    teamIds.length > 0
      ? await prisma.leagueTeam.findMany({
          where: { id: { in: teamIds } },
          select: { id: true, teamName: true },
        })
      : []
  const teamNameById = Object.fromEntries(teams.map((t) => [t.id, t.teamName ?? t.id]))
  const rosterDisplayNames: Record<string, string> = {}
  for (const r of rosters) {
    const teamId = map.rosterIdToTeamId.get(r.id)
    rosterDisplayNames[r.id] = teamId ? teamNameById[teamId] ?? r.id : r.id
  }

  let myIdols: { id: string; playerId: string; powerType: string; playerName?: string | null; playerImageUrl?: string | null }[] = []
  let myActiveEffects: {
    rewardType: string
    week: number
    appliedMode: 'full' | 'record_only' | 'queued'
    rosterId?: string | null
    tribeId?: string | null
    sourceRosterId?: string | null
  }[] = []
  if (myRosterId) {
    ;[myIdols, myActiveEffects] = await Promise.all([
      getActiveIdolsForRoster(leagueId, myRosterId),
      getActiveEffectsForRoster(leagueId, myRosterId, currentWeek),
    ])
    if (myIdols.length > 0) {
      // Resolve only the viewer's idol-bound players; other managers' placements stay sealed.
      const playerIds = [...new Set(myIdols.map((idol) => idol.playerId))]
      const [players, drafted] = await Promise.all([
        prisma.sportsPlayer.findMany({ where: { id: { in: playerIds } }, select: { id: true, name: true, imageUrl: true } }),
        prisma.draftPick.findMany({
          where: { session: { leagueId }, playerId: { in: playerIds } },
          select: { playerId: true, playerName: true, playerImageUrl: true },
        }),
      ])
      const sportsById = new Map(players.map((player) => [player.id, player]))
      const draftById = new Map(drafted.filter((pick) => pick.playerId).map((pick) => [pick.playerId!, pick]))
      myIdols = myIdols.map((idol) => {
        const player = sportsById.get(idol.playerId)
        const pick = draftById.get(idol.playerId)
        return {
          ...idol,
          playerName: player?.name ?? pick?.playerName ?? null,
          playerImageUrl: player?.imageUrl ?? pick?.playerImageUrl ?? null,
        }
      })
    }
  }

  const myMainRoster = myRosterId ? mainLeagueRosters.find((roster) => roster.id === myRosterId) ?? null : null
  const myExileRoster =
    exileLeagueId && myMainRoster?.platformUserId
      ? exileRosters.find((roster) => roster.platformUserId === myMainRoster.platformUserId) ?? null
      : null
  const myExileTokens = myExileRoster
    ? tokenStates.find((token) => token.rosterId === myExileRoster.id)?.tokens ?? 0
    : 0
  const myExileEligibility =
    exileLeagueId && myExileRoster
      ? await canReturnToIsland(leagueId, exileLeagueId, myExileRoster.id, currentWeek)
      : null
  const myExileStatus =
    myExileRoster && myRosterId
      ? {
          exileRosterId: myExileRoster.id,
          mainRosterId: myRosterId,
          tokens: myExileTokens,
          eliminated: eliminatedRosterIds.has(myRosterId),
          eligibleToReturn: myExileEligibility?.eligible ?? false,
          reason: myExileEligibility?.reason ?? null,
        }
      : null

  const myFinaleVote = myRosterId
    ? (() => {
        const vote = finaleState.votes.find((entry) => entry.jurorRosterId === myRosterId) ?? null
        return vote
          ? {
              finalistRosterId: vote.finalistRosterId,
              submittedAt: vote.submittedAt.toISOString(),
            }
          : null
      })()
    : null

  const leagueSettingsJson =
    leagueSettingsRow?.settings && typeof leagueSettingsRow.settings === 'object' && !Array.isArray(leagueSettingsRow.settings)
      ? (leagueSettingsRow.settings as Record<string, unknown>)
      : {}
  const { fairPlayLimited } = parseSurvivorFairPlayFromLeagueSettings(leagueSettingsJson)
  const leagueRole = await getLeagueRole(leagueId, userId)
  const isComm = leagueRole === 'commissioner' || leagueRole === 'co_commissioner'
  const fairPlayRedact = shouldApplySurvivorFairPlayRedaction(fairPlayLimited, isComm, Boolean(myRosterId))

  const privacy = await resolveSurvivorAccessContext(leagueId, userId)
  if (!privacy?.isLeagueMember) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const publicCouncil = survivorPublicCouncil(council, privacy.decisions.canSeePrivateVotes, { revealMode: leagueMeta?.survivorRevealMode })

  const body = {
    leagueName: leagueMeta?.name ?? 'Survivor League',
    config: {
      mode: config.mode,
      tribeCount: config.tribeCount,
      tribeSize: config.tribeSize,
      tribeFormation: config.tribeFormation,
      mergeTrigger: config.mergeTrigger,
      mergeWeek: config.mergeWeek,
      mergePlayerCount: config.mergePlayerCount,
      juryStartAfterMerge: config.juryStartAfterMerge,
      exileReturnEnabled: config.exileReturnEnabled,
      exileReturnTokens: config.exileReturnTokens,
      idolCount: config.idolCount,
      idolPowerPool: config.idolPowerPool,
      tribeShuffleEnabled: config.tribeShuffleEnabled,
      tribeShuffleConsecutiveLosses: config.tribeShuffleConsecutiveLosses,
      tribeShuffleImbalanceThreshold: config.tribeShuffleImbalanceThreshold,
      voteDeadlineDayOfWeek: config.voteDeadlineDayOfWeek,
      voteDeadlineTimeUtc: config.voteDeadlineTimeUtc,
      selfVoteDisallowed: config.selfVoteDisallowed,
      tribalCouncilDayOfWeek: config.tribalCouncilDayOfWeek,
      tribalCouncilTimeUtc: config.tribalCouncilTimeUtc,
      minigameFrequency: config.minigameFrequency,
      seasonThemeLabel: config.seasonThemeLabel,
      visualThemeId: config.visualThemeId,
      challengesSystemRun: config.challengesSystemRun,
      regularSeasonEndWeek: config.regularSeasonEndWeek,
      faqSeededAt: config.faqSeededAt,
    },
    seasonCalendar,
    currentWeek,
    tribeScores,
    // Weekly scores are public; keyed by main roster so the home can show each castaway's points.
    memberScores: Object.fromEntries(weeklyScoreRows.flatMap(row => {
      const rosterId = mainRosterByPlatformUserId.get(row.userId)
      return rosterId ? [[rosterId, row.finalScore]] : []
    })),
    immunityRosterIds: [...new Set([
      ...activeNecklaces.map(row => mainRosterByPlatformUserId.get(row.immunityWinnerUserId) ?? row.immunityWinnerRosterId),
      ...weeklyScoreRows.flatMap(row => {
        const rosterId = row.wonIndividualImmunity ? mainRosterByPlatformUserId.get(row.userId) : undefined
        return rosterId ? [rosterId] : []
      }),
    ])],
    immunity: activeNecklaces.map(row => ({
      rosterId: mainRosterByPlatformUserId.get(row.immunityWinnerUserId) ?? row.immunityWinnerRosterId,
      tribeId: row.tribeId,
      week: row.week,
      score: row.score,
      displayName: row.winnerName,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    })),
    scoresFinalized: weeklyScoreRows.length > 0 && weeklyScoreRows.every(row => row.isFinalized),
    tribes: tribes.map((t) => ({
      id: t.id,
      name: t.name,
      emoji: extractLeadingTribeIcon(t.name),
      slotIndex: t.slotIndex,
      ...summaryTribeEmblem(t, leagueMeta?.sport),
      colorHex: 'colorHex' in t ? t.colorHex ?? null : null,
      members: t.members.map((m) => ({ rosterId: m.rosterId, isLeader: m.isLeader })),
      // Voted-out castaways stay listed (struck through, "Out · Wk N") with a snuffed torch.
      outMembers: outMembersByTribe.get(t.id) ?? [],
    })),
    council: publicCouncil
      ? {
          id: publicCouncil.id,
          week: publicCouncil.week,
          phase: publicCouncil.phase,
          attendingTribeId: publicCouncil.attendingTribeId,
          voteDeadlineAt: publicCouncil.voteDeadlineAt,
          closedAt: publicCouncil.closedAt,
          eliminatedRosterId: publicCouncil?.eliminatedRosterId ?? null,
          revealSequence: publicCouncil?.revealSequence ?? null,
          revealMode: publicCouncil?.revealMode ?? 'one_at_a_time',
          revealTotalSteps: publicCouncil?.revealTotalSteps ?? null,
          revealComplete: publicCouncil?.revealComplete ?? false,
          revealNextStepAt: publicCouncil?.revealNextStepAt ?? null,
          eliminatedName: publicCouncil?.eliminatedName ?? null,
          isTie: publicCouncil?.isTie ?? false,
          isRevealed: publicCouncil.isRevealed,
          revealStartsAt: (publicCouncil as { revealStartsAt?: Date | null }).revealStartsAt ?? null,
        }
      : null,
    challenges: challenges.map((c) => ({
      id: c.id,
      week: c.week,
      challengeType: c.challengeType,
      title: c.title,
      scope: c.scope,
      submissionMode: c.submissionMode,
      status: c.status,
      lockAt: c.lockAt,
      configJson: c.configJson,
      resultJson: c.resultJson,
      winnerTribeId: c.winnerTribeId,
      winnerUserIds: c.winnerUserIds,
      winnerUserNames: c.winnerUserIds.map(userId => rosterDisplayNames[mainRosterByPlatformUserId.get(userId) ?? ''] ?? 'A manager'),
      resultSummary: c.resultSummary,
      submissionCount: c.submissions?.length ?? 0,
    })),
    jury: jury.map((j) => ({ rosterId: j.rosterId, votedOutWeek: j.votedOutWeek })),
    exileLeagueId,
    exileTokens: tokenStates.filter(token => privacy.decisions.canSeeHiddenIdolAssignments || token.rosterId === myExileRoster?.id).map((token) => {
      const mainRosterId = exileMainRosterIdByExileRosterId.get(token.rosterId) ?? null
      return {
        rosterId: token.rosterId,
        mainRosterId,
        displayName: mainRosterId ? (rosterDisplayNames[mainRosterId] ?? mainRosterId) : token.rosterId,
        tokens: token.tokens,
        lastAwardedWeek: token.lastAwardedWeek,
      }
    }),
    votedOutHistory,
    merged,
    myRosterId: myRosterId ?? undefined,
    myTribeId: myTribeId ?? undefined,
    myTribeSource: myTribeId ? getTribeChatSource(myTribeId) : null,
    myIdols,
    myActiveEffects,
    myExileStatus,
    nbaWeeklyScoringMode: normalizeSurvivorFoundationSettings(leagueSettingsRow?.settings as Record<string, unknown>).nbaWeeklyScoringMode,
    tribeBalance: {
      requiredSitOuts: tribeBalance.requiredSitOuts,
      activeCounts: Object.fromEntries(tribeBalance.tribeSizes.map(tribe => [tribe.tribeId, tribe.activeCount])),
    },
    sitOuts: {
      pending: sitOutState.pending.map((row) => ({
        id: row.id,
        week: row.week,
        targetUserId: row.targetUserId,
        targetTribeId: row.targetTribeId,
        description: row.description,
        createdAt: row.createdAt,
      })),
      accepted: sitOutState.accepted.map((row) => ({
        id: row.id,
        week: row.week,
        targetUserId: row.targetUserId,
        targetTribeId: row.targetTribeId,
        description: row.description,
        createdAt: row.createdAt,
      })),
      declined: sitOutState.declined.map((row) => ({
        id: row.id,
        week: row.week,
        targetUserId: row.targetUserId,
        targetTribeId: row.targetTribeId,
        description: row.description,
        createdAt: row.createdAt,
      })),
      myPendingResponse:
        sitOutState.pending.find((row) => row.targetUserId === userId)
          ? {
              sitOutId: sitOutState.pending.find((row) => row.targetUserId === userId)?.id ?? null,
              week: currentWeek,
            }
          : null,
    },
    finale:
      finaleState.finalists.length > 0 || finaleState.closed
        ? {
            open: finaleState.open,
            closed: finaleState.closed,
            finalists: finaleState.finalists.map((rosterId) => ({ rosterId })),
            juryVotesSubmitted: finaleState.votesSubmitted,
            juryVotesRequired: finaleState.votesRequired,
            winnerRosterId: finaleState.winnerRosterId,
            crownedAt: finaleState.crownedAt?.toISOString() ?? null,
            myJuryVote: myFinaleVote,
            voteCount: finaleState.closed ? finaleState.voteCount : null,
            bonusVotesByFinalist: finaleState.closed ? finaleState.bonusVotesByFinalist : null,
            tieBreakSeasonPoints: finaleState.closed ? finaleState.tieBreakSeasonPoints : null,
          }
        : null,
    rosterDisplayNames,
  }

  if (fairPlayRedact) {
    return NextResponse.json(redactSurvivorSummaryPayloadForFairPlay(body))
  }

  return NextResponse.json(body)
}
