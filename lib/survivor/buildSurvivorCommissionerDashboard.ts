import 'server-only'
import { tribalVotesDueFromSettings } from './survivorCeremonySchedule'

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
import { SURVIVOR_COMMISSIONER_ALERT_AUDIT_ACTION } from './survivorCommissionerAlerts'
import { buildSurvivorCommissionerTodo, type SurvivorCommissionerTodo } from './survivorCommissionerTodo'

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
      config: Awaited<ReturnType<typeof getSurvivorConfig>> & { tribalVotesDue?: ReturnType<typeof tribalVotesDueFromSettings> }
      week: number
      tribes: Array<Awaited<ReturnType<typeof getTribesWithMembers>>[number] & {
        emoji: ReturnType<typeof extractLeadingTribeIcon>
        /** Members carry the manager behind the roster so the host can move them by name. */
        members: Array<Awaited<ReturnType<typeof getTribesWithMembers>>[number]['members'][number] & { userId: string | null; displayName: string | null }>
      }>
      tribeRedraw: Awaited<ReturnType<typeof getPendingTribeRedraw>>
      /** The weekly to-do list: usually "nothing needed". */
      todo: SurvivorCommissionerTodo
      council: { id: string; week: number; status: string; isRevealed: boolean } | null
      privateBallots: []
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
    sentAlerts,
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
    // Alerts the runner raised that the to-do list keeps showing while the condition holds.
    prisma.survivorAuditEntry.findMany({
      where: { leagueId, action: SURVIVOR_COMMISSIONER_ALERT_AUDIT_ACTION, OR: [{ relatedEntityId: { startsWith: 'scores_overdue:' } }, { relatedEntityId: { startsWith: 'jury_overdue:' } }] },
      orderBy: { createdAt: 'desc' }, take: 20, select: { relatedEntityId: true },
    }),
  ])

  const activeCast = tribeRows.length
    ? await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, displayName: true, redraftRosterId: true } })
    : []
  const castByRoster = new Map(activeCast.filter(player => player.redraftRosterId).map(player => [player.redraftRosterId as string, player]))
  const tribes = tribeRows.map((tribe: Awaited<ReturnType<typeof getTribesWithMembers>>[number]) => ({
    ...tribe,
    emoji: extractLeadingTribeIcon(tribe.name),
    members: tribe.members.map(member => ({
      ...member,
      userId: castByRoster.get(member.rosterId)?.userId ?? null,
      displayName: castByRoster.get(member.rosterId)?.displayName ?? null,
    })),
  }))

  const afPlan = resolveAfPlanFromEntitlement(entitlementSnapshot.plans, entitlementSnapshot.status)

  if (!config) {
    return { ok: false, error: 'Survivor config missing', status: 404 }
  }

  const gs = gameState
  const privateIdolRows = access.decisions.canSeeHiddenIdolAssignments
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
  // Setup gaps other than open seats and automation, which the to-do list words on its own.
  const setupIssues: string[] = []
  if (!draftRow) setupIssues.push('No current draft session is available.')
  if (draftRow && ['pre_draft', 'scheduled'].includes(draftRow.status) && nbaAdpRows === 0) setupIssues.push('NBA ADP is unavailable. Verify the player pool and autopick order before starting the draft.')
  if (!exileId && access.settings.exileIslandEnabled) setupIssues.push('Exile is enabled but its side league is not linked.')
  if (config.exileReturnEnabled !== access.settings.exileIslandEnabled) setupIssues.push('Exile return rules disagree between league settings and the Survivor engine.')
  if (config.idolCount !== access.settings.idolCount) setupIssues.push('Idol inventory disagrees between league settings and the Survivor engine.')
  if (config.mergeTrigger !== (access.settings.mergeTriggerType === 'active_player_count' ? 'player_count' : 'week')) setupIssues.push('Merger trigger disagrees between league settings and the Survivor engine.')
  const nestedWaivers = savedSettings.waiverSettings && typeof savedSettings.waiverSettings === 'object' && !Array.isArray(savedSettings.waiverSettings) ? savedSettings.waiverSettings as Record<string, unknown> : {}
  if (typeof nestedWaivers.waiverType === 'string' && nestedWaivers.waiverType !== league.waiverType) setupIssues.push('Waiver method disagrees between the saved league and waiver settings.')
  const readinessIssues: string[] = [
    ...(league.leagueSize && claimedManagers < league.leagueSize ? [`${league.leagueSize - claimedManagers} manager seats still need to be claimed.`] : []),
    ...setupIssues,
    ...(gs?.lastError && !gs.lastError.startsWith('PAUSED:') ? ['Season automation reported an error; review the runtime before resuming.'] : []),
  ]
  const todo = buildSurvivorCommissionerTodo({
    leagueId,
    week: gs?.currentWeek && gs.currentWeek > 0 ? gs.currentWeek : null,
    phase: gs?.phase ?? null,
    draftStatus: draftRow?.status ?? null,
    leagueSize: league.leagueSize,
    claimedManagers,
    setupIssues,
    lastError: gs?.lastError ?? null,
    paused: gs?.pausedSnapshot != null || Boolean(gs?.lastError?.startsWith('PAUSED:')),
    autoReveal: access.settings.autoReveal,
    council: council ? { week: council.week, status: council.status, isRevealed: council.isRevealed, tiePhase: council.tiePhase ?? null } : null,
    scoresPending: !gs?.weekScoringFinalAt,
    sentAlertKeys: sentAlerts.map(row => row.relatedEntityId).filter((key): key is string => Boolean(key)),
    tribeRedrawPending: Boolean(tribeRedraw),
  })
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
    // When votes are really due: the settings screen's vote day/time, as the scheduler reads it.
    config: { ...config, tribalVotesDue: tribalVotesDueFromSettings(savedSettings) },
    week,
    tribes,
    tribeRedraw,
    todo,
    // This dashboard embeds Council control. It never transports individual choices.
    council: council ? { id: council.id, week: council.week, status: !council.isRevealed && council.status === 'tie_pending' ? 'closed' : council.status, isRevealed: council.isRevealed } : null,
    privateBallots: [],
    privateIdols: privateIdolRows.map(idol => ({
      id: idol.id,
      ownerName: ownerNames.get(idol.currentOwnerUserId ?? '') ?? 'Manager',
      powerLabel: idol.powerLabel ?? idol.powerType.replace(/_/g, ' '),
    })),
    juryCount: jury.length,
    merged,
    rosterCount,
    eliminatedCount: eliminatedIds.size,
    auditTail: auditTail.map(entry => ({ eventType: entry.eventType, createdAt: entry.createdAt, metadata: {} })),
    privacy: {
      commissionerParticipationMode: access.settings.commissionerParticipationMode,
      blindModeActive: access.isParticipatingCommissioner,
      canSeeHiddenIdolAssignments: access.decisions.canSeeHiddenIdolAssignments,
      canSeePrivateVotes: false,
      canSeeVoteTallyBeforeReveal: false,
      warnings: access.privacyWarnings,
    },
    monetization: {
      afPlan,
      afTokensRemaining: Number(tokenBalance.balance ?? 0),
      subscriptionStatus: entitlementSnapshot.status,
    },
  }
}
