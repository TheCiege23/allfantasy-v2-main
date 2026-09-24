import 'server-only'

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
      council: Awaited<ReturnType<typeof getCouncil>>
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
    select: { id: true, name: true, sport: true, leagueSize: true, leagueVariant: true },
  })
  if (!league || league.leagueVariant !== 'survivor') {
    return { ok: false, error: 'Not a Survivor league', status: 404 }
  }

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
  ] = await Promise.all([
    getSurvivorConfig(leagueId),
    getTribesWithMembers(leagueId),
    getCouncil(leagueId, week),
    getJuryMembers(leagueId),
    isMergeTriggered(leagueId, week),
    getExileLeagueId(leagueId),
    prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { id: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId } }),
    prisma.roster.count({ where: { leagueId } }),
    prisma.survivorChatChannel.count({ where: { leagueId } }),
    getSurvivorAuditLog(leagueId, { limit: 12, eventTypes: undefined }),
    new EntitlementResolver().resolveSnapshot(userId, email),
    new TokenBalanceResolver().resolveForUser(userId, email),
    getCurrentlyEliminatedRosterIds(leagueId),
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
    council,
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
