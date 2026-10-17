/**
 * Build deterministic context for Survivor AI. NO outcome logic — only data for narration/advice.
 * PROMPT 348: Elimination, vote count, idol validity, immunity, exile return are rules-driven only.
 */

import { getSurvivorConfig } from '../SurvivorLeagueConfig'
import { getActiveEffectsForRoster } from '../SurvivorEffectEngine'
import { getTribesWithMembers } from '../SurvivorTribeService'
import { getCouncil } from '../SurvivorTribalCouncilService'
import { getChallengesForWeek } from '../SurvivorChallengeEngine'
import { getFinaleState } from '../SurvivorFinaleEngine'
import { getJuryMembers } from '../SurvivorJuryEngine'
import { getExileLeagueId } from '../SurvivorExileEngine'
import { getAllTokenStates } from '../SurvivorTokenEngine'
import { getActiveIdolsForRoster } from '../SurvivorIdolRegistry'
import { getSurvivorAuditLog } from '../SurvivorAuditLog'
import { isMergeTriggered } from '../SurvivorMergeEngine'
import { canReturnToIsland } from '../SurvivorReturnEngine'
import { getCurrentlyEliminatedRosterIds } from '../SurvivorRosterState'
import { getRosterTeamMap } from '@/lib/zombie/rosterTeamMap'
import { resolveSurvivorAccessContext } from '../survivorAccessControl'
import { survivorPublicCouncil } from '../survivorPublicCouncil'
import { prisma } from '@/lib/prisma'
import type { LeagueSport } from '@prisma/client'
import { buildHistoricalContext, type HistoricalContext } from '@/lib/ai/historicalContextBuilder'

export type SurvivorAIType =
  | 'host_intro'
  | 'host_challenge'
  | 'host_merge'
  | 'host_council'
  | 'host_scroll'
  | 'host_jury'
  | 'tribe_help'
  | 'idol_help'
  | 'tribal_help'
  | 'exile_help'
  | 'bestball_help'

export interface SurvivorAIDeterministicContext {
  leagueId: string
  sport: LeagueSport
  currentWeek: number
  config: {
    mode: string
    tribeCount: number
    tribeSize: number
    mergeTrigger: string
    mergeWeek: number
    mergePlayerCount: number | null
    juryStartAfterMerge: boolean
    exileReturnEnabled: boolean
    exileReturnTokens: number
    voteDeadlineDayOfWeek: number | null
    voteDeadlineTimeUtc: string | null
    selfVoteDisallowed: boolean
  }
  tribes: { id: string; name: string; slotIndex: number; members: { rosterId: string; isLeader: boolean }[] }[]
  council: {
    id: string
    week: number
    phase: string
    attendingTribeId: string | null
    voteDeadlineAt: Date
    closedAt: Date | null
    eliminatedRosterId: string | null
  } | null
  challenges: { id: string; week: number; challengeType: string; lockAt: Date | null; resultJson: unknown; submissionCount: number }[]
  jury: { rosterId: string; votedOutWeek: number }[]
  exileLeagueId: string | null
  exileTokens: { rosterId: string; tokens: number; lastAwardedWeek: number | null }[]
  votedOutHistory: { rosterId: string; week: number }[]
  merged: boolean
  rosterDisplayNames: Record<string, string>
  myRosterId: string | null
  myIdols: { id: string; playerId: string; powerType: string }[]
  myActiveEffects: { rewardType: string; week: number; appliedMode: 'full' | 'record_only' | 'queued'; rosterId?: string | null; tribeId?: string | null; sourceRosterId?: string | null }[]
  myExileStatus: { exileRosterId: string; tokens: number; eliminated: boolean; eligibleToReturn: boolean; reason: string | null } | null
  finale: {
    open: boolean
    closed: boolean
    finalists: string[]
    juryVotesSubmitted: number
    juryVotesRequired: number
    winnerRosterId: string | null
  } | null
  historical?: HistoricalContext | null
}

/**
 * Build deterministic context for Survivor AI. Used by AI layer for narration and advice only.
 */
export async function buildSurvivorAIContext(args: {
  leagueId: string
  currentWeek: number
  userId: string
}): Promise<SurvivorAIDeterministicContext | null> {
  const { leagueId, currentWeek, userId } = args
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember) return null
  const config = await getSurvivorConfig(leagueId)
  if (!config) return null

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { sport: true },
  })
  const sport = (league?.sport ?? 'NFL') as LeagueSport

  const [tribes, council, challenges, jury, exileLeagueId, tokenStates, audit, merged, myRosterId, finaleState, historical] = await Promise.all([
    getTribesWithMembers(leagueId),
    getCouncil(leagueId, currentWeek),
    getChallengesForWeek(leagueId, currentWeek),
    getJuryMembers(leagueId),
    getExileLeagueId(leagueId),
    getExileLeagueId(leagueId).then((id) => (id ? getAllTokenStates(id) : [])),
    prisma.survivorTribalCouncil.findMany({ where: { leagueId, isRevealed: true, eliminatedRosterId: { not: null } }, select: { eliminatedRosterId: true, week: true }, orderBy: { week: 'asc' } }),
    isMergeTriggered(leagueId, currentWeek),
    prisma.roster.findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true } }).then((r) => r?.id ?? null),
    getFinaleState(leagueId, currentWeek),
    buildHistoricalContext(leagueId).catch(() => null),
  ])

  const [eliminatedRosterIds, mainLeagueRosters] = await Promise.all([
    getCurrentlyEliminatedRosterIds(leagueId),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true },
    }),
  ])

  const votedOutHistory = audit.map(row => ({ rosterId: row.eliminatedRosterId!, week: row.week }))

  const normalizedTribes = merged
    ? [{
        id: 'merged',
        name: 'Merged Tribe',
        slotIndex: 0,
        members: mainLeagueRosters
          .filter((roster) => !eliminatedRosterIds.has(roster.id))
          .map((roster, index) => ({ rosterId: roster.id, isLeader: index === 0 })),
      }]
    : tribes.map((tribe) => ({
        ...tribe,
        members: tribe.members.filter((member) => !eliminatedRosterIds.has(member.rosterId)),
      }))

  const rosterIds = new Set<string>([
    ...normalizedTribes.flatMap((t) => t.members.map((m) => m.rosterId)),
    ...jury.map((j) => j.rosterId),
    ...votedOutHistory.map((v) => v.rosterId),
    ...(myRosterId ? [myRosterId] : []),
  ])
  const rosters =
    rosterIds.size > 0
      ? await prisma.roster.findMany({
          where: { leagueId, id: { in: [...rosterIds] } },
          select: { id: true },
        })
      : []
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

  let myIdols: { id: string; playerId: string; powerType: string }[] = []
  let myActiveEffects: { rewardType: string; week: number; appliedMode: 'full' | 'record_only' | 'queued'; rosterId?: string | null; tribeId?: string | null; sourceRosterId?: string | null }[] = []
  let myExileStatus: { exileRosterId: string; tokens: number; eliminated: boolean; eligibleToReturn: boolean; reason: string | null } | null = null
  if (myRosterId) {
    myIdols = await getActiveIdolsForRoster(leagueId, myRosterId)
    myActiveEffects = await getActiveEffectsForRoster(leagueId, myRosterId, currentWeek)
  }

  if (exileLeagueId && myRosterId) {
    const mainRoster = mainLeagueRosters.find((roster) => roster.id === myRosterId) ?? null
    const exileRoster =
      mainRoster?.platformUserId
        ? await prisma.roster.findFirst({
            where: { leagueId: exileLeagueId, platformUserId: mainRoster.platformUserId },
            select: { id: true },
          })
        : null
    if (exileRoster) {
      const tokenState = tokenStates.find((token) => token.rosterId === exileRoster.id) ?? null
      const eligibility = await canReturnToIsland(leagueId, exileLeagueId, exileRoster.id, currentWeek)
      myExileStatus = {
        exileRosterId: exileRoster.id,
        tokens: tokenState?.tokens ?? 0,
        eliminated: eliminatedRosterIds.has(myRosterId),
        eligibleToReturn: eligibility.eligible,
        reason: eligibility.reason ?? null,
      }
    }
  }

  return {
    leagueId,
    sport,
    currentWeek,
    config: {
      mode: config.mode,
      tribeCount: config.tribeCount,
      tribeSize: config.tribeSize,
      mergeTrigger: config.mergeTrigger,
      mergeWeek: config.mergeWeek ?? 0,
      mergePlayerCount: config.mergePlayerCount,
      juryStartAfterMerge: config.juryStartAfterMerge === 1,
      exileReturnEnabled: config.exileReturnEnabled,
      exileReturnTokens: config.exileReturnTokens,
      voteDeadlineDayOfWeek: config.voteDeadlineDayOfWeek,
      voteDeadlineTimeUtc: config.voteDeadlineTimeUtc,
      selfVoteDisallowed: config.selfVoteDisallowed,
    },
    tribes: normalizedTribes.map((t) => ({
      id: t.id,
      name: t.name,
      slotIndex: t.slotIndex,
      members: t.members.map((m) => ({ rosterId: m.rosterId, isLeader: m.isLeader })),
    })),
    council: council
      ? {
          id: council.id,
          week: council.week,
          phase: council.phase,
          attendingTribeId: council.attendingTribeId,
          voteDeadlineAt: council.voteDeadlineAt,
          closedAt: council.closedAt,
          eliminatedRosterId: survivorPublicCouncil(council, access.decisions.canSeePrivateVotes)?.eliminatedRosterId ?? null,
        }
      : null,
    challenges: challenges.map((c) => ({
      id: c.id,
      week: c.week,
      challengeType: c.challengeType,
      lockAt: c.lockAt,
      resultJson: c.resultJson,
      submissionCount: c.submissions?.length ?? 0,
    })),
    jury: jury.map((j) => ({ rosterId: j.rosterId, votedOutWeek: j.votedOutWeek })),
    exileLeagueId,
    exileTokens: tokenStates.filter(token => access.decisions.canSeeHiddenIdolAssignments || token.rosterId === myExileStatus?.exileRosterId),
    votedOutHistory,
    merged,
    rosterDisplayNames,
    myRosterId,
    myIdols,
    myActiveEffects,
    myExileStatus,
    finale:
      finaleState.finalists.length > 0 || finaleState.closed
        ? {
            open: finaleState.open,
            closed: finaleState.closed,
            finalists: finaleState.finalists,
            juryVotesSubmitted: finaleState.votesSubmitted,
            juryVotesRequired: finaleState.votesRequired,
            winnerRosterId: finaleState.winnerRosterId,
          }
        : null,
    historical: access.decisions.canSeeHiddenIdolAssignments ? historical ?? null : null,
  }
}
