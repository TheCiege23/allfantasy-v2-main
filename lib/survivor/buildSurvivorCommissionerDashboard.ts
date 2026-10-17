import 'server-only'
import { survivorPublicCouncil } from './survivorPublicCouncil'

import { prisma } from '@/lib/prisma'
import { getLeagueRole, type LeagueRole } from '@/lib/league/permissions'
import { isSurvivorLeague, getSurvivorConfig } from '@/lib/survivor/SurvivorLeagueConfig'
import { getTribesWithMembers } from '@/lib/survivor/SurvivorTribeService'
import { getCouncil } from '@/lib/survivor/SurvivorTribalCouncilService'
import { getJuryMembers } from '@/lib/survivor/SurvivorJuryEngine'
import { getExileLeagueId } from '@/lib/survivor/SurvivorExileEngine'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'
import { isMergeTriggered } from '@/lib/survivor/SurvivorMergeEngine'
import { getSurvivorAuditLog } from '@/lib/survivor/SurvivorAuditLog'
import { getCurrentlyEliminatedRosterIds } from '@/lib/survivor/SurvivorRosterState'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import { TokenBalanceResolver } from '@/lib/tokens/TokenBalanceResolver'
import { resolveAfPlanFromEntitlement } from '@/lib/tournament/resolve-af-plan-from-subscription'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import { extractLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { resolveSurvivorAccessContext } from '@/lib/survivor/survivorAccessControl'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { getPendingTribeRedraw } from './survivorTribeRedrawDecision'

export type SurvivorCommissionerDashboardResult =
  | {
      ok: true
      role: LeagueRole
      league: {
        id: string
        name: string
        sport: string
        leagueSize: number | null
      }
      shell: {
        draftSessionExists: boolean
        survivorChatChannels: number
        exileLeagueLinked: boolean
      }
      operations: {
        claimedManagers: number
        draft: { status: string; picksMade: number; totalPicks: number; timerSeconds: number | null } | null
        pendingTrades: number
        completedTrades: number
        exileActive: boolean
        activeChallenges: number
        automationNeedsAttention: boolean
        readinessIssues: string[]
      }
      gameState: {
        phase: string
        currentWeek: number
        activeTribeCount: number
        activePlayerCount: number
        exilePlayerCount: number
        juryPlayerCount: number
        immuneTribeId: string | null
        immunePlayerId: string | null
        tribalDeadline: string | null
      } | null
      config: Awaited<ReturnType<typeof getSurvivorConfig>>
      week: number
      tribes: Awaited<ReturnType<typeof getTribesWithMembers>>
      tribeRedraw: Awaited<ReturnType<typeof getPendingTribeRedraw>>
      council: Awaited<ReturnType<typeof getCouncil>>
      privateBallots: { voterName: string; targetName: string; submittedAt: string; doesNotCount: boolean }[]
      privateIdols: { id: string; ownerName: string; powerLabel: string }[]
      juryCount: number
      merged: boolean
      rosterCount: number
      eliminatedCount: number
      auditTail: Awaited<ReturnType<typeof getSurvivorAuditLog>>
      privacy: {
        commissionerParticipationMode: string
        blindModeActive: boolean
        canSeeHiddenIdolAssignments: boolean
        canSeePrivateVotes: boolean
        canSeeVoteTallyBeforeReveal: boolean
        warnings: string[]
      }
      monetization: {
        afPlan: AfPlanId | null
        afTokensRemaining: number
        subscriptionStatus: string
      }
    }
  | { ok: false; error: string; status: 403 | 404 }

export async function buildSurvivorCommissionerDashboard(
  leagueId: string,
  userId: string,
  email: string | null | undefined,
): Promise<SurvivorCommissionerDashboardResult> {
  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    return { ok: false, error: 'Commissioner or co-commissioner access required', status: 403 }
  }
  const access = await resolveSurvivorAccessContext(leagueId, userId)
  if (!access?.isLeagueMember) {
    return { ok: false, error: 'Commissioner or co-commissioner access required', status: 403 }
  }

  const survivor = await isSurvivorLeague(leagueId)
  if (!survivor) {
    return { ok: false, error: 'Not a Survivor league', status: 404 }
  }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true, leagueSize: true, leagueVariant: true, waiverType: true, settings: true },
  })
  if (!league || league.leagueVariant !== 'survivor') {
    return { ok: false, error: 'Not a Survivor league', status: 404 }
  }
  const savedSettings = league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings) ? league.settings as Record<string, unknown> : {}
  const fullSeasonPlan = savedSettings.survivor_full_season_plan && typeof savedSettings.survivor_full_season_plan === 'object' && !Array.isArray(savedSettings.survivor_full_season_plan)
    ? savedSettings.survivor_full_season_plan as Record<string, unknown> : {}
  const nbaSeason = typeof fullSeasonPlan.season === 'number' ? fullSeasonPlan.season : new Date().getFullYear()

  const week = await resolveSurvivorCurrentWeek(leagueId, null)

  const [
    config,
    tribeRows,
    council,
    jury,
    merged,
    exileId,
    draftRow,
    gameState,
    rosterCount,
    chatCount,
    auditTail,
    entitlementSnapshot,
    tokenBalance,
    eliminatedIds,
    claimedManagers,
    pendingTrades,
    completedTrades,
    exileIsland,
    activeChallenges,
    nbaAdpRows,
    tribeRedraw,
  ] = await Promise.all([
    getSurvivorConfig(leagueId),
    getTribesWithMembers(leagueId),
    getCouncil(leagueId, week),
    getJuryMembers(leagueId),
    isMergeTriggered(leagueId, week),
    getExileLeagueId(leagueId),
    prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { id: true, status: true, rounds: true, teamCount: true, timerSeconds: true, _count: { select: { picks: true } } } }),
    prisma.survivorGameState.findUnique({ where: { leagueId } }),
    prisma.roster.count({ where: { leagueId } }),
    prisma.survivorChatChannel.count({ where: { leagueId } }),
    access.decisions.canSeeHiddenIdolAssignments ? getSurvivorAuditLog(leagueId, { limit: 12, eventTypes: undefined }) : Promise.resolve([]),
    new EntitlementResolver().resolveSnapshot(userId, email),
    new TokenBalanceResolver().resolveForUser(userId, email),
    getCurrentlyEliminatedRosterIds(leagueId),
    prisma.leagueTeam.count({ where: { leagueId, claimedByUserId: { not: null } } }),
    prisma.redraftTradeProposal.count({ where: { leagueId, status: 'pending' } }),
    prisma.redraftTradeProposal.count({ where: { leagueId, status: 'accepted' } }),
    prisma.exileIsland.findUnique({ where: { leagueId }, select: { isActive: true } }),
    prisma.survivorChallenge.count({ where: { leagueId, status: { in: ['active', 'open'] } } }),
    league.sport === 'NBA' ? prisma.adpDataRecord.count({ where: { sport: 'NBA', season: nbaSeason } }) : Promise.resolve(null),
    getPendingTribeRedraw(leagueId),
  ])

  const tribes = tribeRows.map((tribe: Awaited<ReturnType<typeof getTribesWithMembers>>[number]) => ({
    ...tribe,
    emoji: extractLeadingTribeIcon(tribe.name),
  }))

  const afPlan = resolveAfPlanFromEntitlement(entitlementSnapshot.plans, entitlementSnapshot.status)

  if (!config) {
    return { ok: false, error: 'Survivor config missing', status: 404 }
  }

  const gs = gameState
  const privateIdolRows = access.isNonParticipatingCommissionerHost
    ? await prisma.survivorIdol.findMany({
        where: { leagueId, status: { in: ['hidden', 'revealed'] }, isUsed: false },
        select: { id: true, currentOwnerUserId: true, powerLabel: true, powerType: true },
      })
    : []
  const idolOwners = privateIdolRows.length
    ? await prisma.survivorPlayer.findMany({
        where: { leagueId, userId: { in: privateIdolRows.map(idol => idol.currentOwnerUserId).filter((id): id is string => Boolean(id)) } },
        select: { userId: true, displayName: true },
      })
    : []
  const ownerNames = new Map(idolOwners.map(owner => [owner.userId, owner.displayName]))
  const readinessIssues: string[] = []
  if (league.leagueSize && claimedManagers < league.leagueSize) readinessIssues.push(`${league.leagueSize - claimedManagers} manager seats still need to be claimed.`)
  if (!draftRow) readinessIssues.push('No current draft session is available.')
  if (draftRow && ['pre_draft', 'scheduled'].includes(draftRow.status) && nbaAdpRows === 0) readinessIssues.push('NBA ADP is unavailable. Verify the player pool and autopick order before starting the draft.')
  if (!exileId && access.settings.exileIslandEnabled) readinessIssues.push('Exile is enabled but its side league is not linked.')
  if (config.exileReturnEnabled !== access.settings.exileIslandEnabled) readinessIssues.push('Exile return rules disagree between league settings and the Survivor engine.')
  if (config.idolCount !== access.settings.idolCount) readinessIssues.push('Idol inventory disagrees between league settings and the Survivor engine.')
  if (config.mergeTrigger !== (access.settings.mergeTriggerType === 'active_player_count' ? 'player_count' : 'week')) readinessIssues.push('Merger trigger disagrees between league settings and the Survivor engine.')
  const nestedWaivers = savedSettings.waiverSettings && typeof savedSettings.waiverSettings === 'object' && !Array.isArray(savedSettings.waiverSettings) ? savedSettings.waiverSettings as Record<string, unknown> : {}
  if (typeof nestedWaivers.waiverType === 'string' && nestedWaivers.waiverType !== league.waiverType) readinessIssues.push('Waiver method disagrees between the saved league and waiver settings.')
  if (gs?.lastError && !gs.lastError.startsWith('PAUSED:')) readinessIssues.push('Season automation reported an error; review the runtime before resuming.')
  return {
    ok: true,
    role,
    league: {
      id: league.id,
      name: league.name ?? 'Survivor',
      sport: String(league.sport ?? 'NFL'),
      leagueSize: league.leagueSize,
    },
    shell: {
      draftSessionExists: Boolean(draftRow),
      survivorChatChannels: chatCount,
      exileLeagueLinked: Boolean(exileId),
    },
    operations: {
      claimedManagers,
      draft: draftRow ? {
        status: draftRow.status,
        picksMade: draftRow._count.picks,
        totalPicks: draftRow.rounds * draftRow.teamCount,
        timerSeconds: draftRow.timerSeconds,
      } : null,
      pendingTrades,
      completedTrades,
      exileActive: exileIsland?.isActive ?? false,
      activeChallenges,
      automationNeedsAttention: Boolean(gs?.lastError && !gs.lastError.startsWith('PAUSED:')),
      readinessIssues,
    },
    gameState: gs
      ? {
          phase: gs.phase,
          currentWeek: gs.currentWeek,
          activeTribeCount: gs.activeTribeCount,
          activePlayerCount: gs.activePlayerCount,
          exilePlayerCount: gs.exilePlayerCount,
          juryPlayerCount: gs.juryPlayerCount,
          immuneTribeId: gs.immuneTribeId,
          immunePlayerId: gs.immunePlayerId,
          tribalDeadline: gs.tribalDeadline?.toISOString() ?? null,
        }
      : null,
    config,
    week,
    tribes,
    tribeRedraw,
    council: survivorPublicCouncil(council, access.decisions.canSeePrivateVotes),
    privateBallots: access.isNonParticipatingCommissionerHost
      ? (council?.votes ?? []).map(vote => ({
          voterName: vote.voterName ?? vote.voterUserId ?? 'Manager',
          targetName: vote.targetName ?? vote.targetUserId ?? 'Manager',
          submittedAt: vote.submittedAt.toISOString(),
          doesNotCount: vote.doesNotCount,
        }))
      : [],
    privateIdols: privateIdolRows.map(idol => ({
      id: idol.id,
      ownerName: ownerNames.get(idol.currentOwnerUserId ?? '') ?? 'Manager',
      powerLabel: idol.powerLabel ?? idol.powerType.replace(/_/g, ' '),
    })),
    juryCount: jury.length,
    merged,
    rosterCount,
    eliminatedCount: eliminatedIds.size,
    auditTail,
    privacy: {
      commissionerParticipationMode: access.settings.commissionerParticipationMode,
      blindModeActive: access.isParticipatingCommissioner,
      canSeeHiddenIdolAssignments: access.decisions.canSeeHiddenIdolAssignments,
      canSeePrivateVotes: access.decisions.canSeePrivateVotes,
      canSeeVoteTallyBeforeReveal: access.decisions.canSeeVoteTallyBeforeReveal,
      warnings: access.privacyWarnings,
    },
    monetization: {
      afPlan,
      afTokensRemaining: Number(tokenBalance.balance ?? 0),
      subscriptionStatus: entitlementSnapshot.status,
    },
  }
}
