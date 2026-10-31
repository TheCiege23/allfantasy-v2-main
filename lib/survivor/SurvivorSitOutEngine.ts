import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { enqueueNotification } from './notificationEngine'
import { getTribesWithMembers } from './SurvivorTribeService'
import { logSurvivorAuditEntry } from './auditEntry'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'
import { readWeekGames } from '@/lib/redraft/weekGames'
import { randomInt } from 'node:crypto'
import { readSurvivorFullSeasonPlan } from './survivorFullSeasonPlan'
import { createSurvivorChatMessage } from './survivorChatBridge'
import {
  SURVIVOR_HOST_USER_ID,
  TRIBE_REDRAW_DECISIONS,
  TRIBE_REDRAW_DEFAULT_DECISION,
  TRIBE_REDRAW_RECOMMENDATION_ACTION,
  TRIBE_REDRAW_RESPONSE_ACTIONS,
  tribeBelowHalfOfLargest,
} from './survivorTribeRedrawActions'

const CHIMMY_HOST_USER_ID = SURVIVOR_HOST_USER_ID
const CHIMMY_HOST_NAME = '@Chimmy'

export type SurvivorSitOutAction = {
  id: string
  leagueId: string
  week: number | null
  actionType: string
  commissionerId: string
  targetUserId: string | null
  targetTribeId: string | null
  description: string
  createdAt: Date
  executedAt: Date
}

export type SurvivorTribeBalanceState = {
  leagueId: string
  week: number
  merged: boolean
  tribeSizes: Array<{ tribeId: string; tribeName: string; activeCount: number }>
  minTribeSize: number
  maxTribeSize: number
  shouldSuggestShuffle: boolean
  suggestionReason: string | null
  requiredSitOuts: Record<string, number>
}

/** Every active tribe contributes the same number of managers to its weekly total. */
export function requiredTribeSitOuts(sizes: Record<string, number>): Record<string, number> {
  const active = Object.values(sizes).filter(size => size > 0)
  const target = active.length ? Math.min(...active) : 0
  return Object.fromEntries(Object.entries(sizes).map(([id, size]) => [id, size > 0 ? size - target : 0]))
}

async function nbaWeekTipoff(leagueId: string, week: number): Promise<Date | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, season: true, survivorMode: true } })
  if (!league?.survivorMode || league.sport !== 'NBA') return null
  const window = resolveDailySportWeekWindow('NBA', league.season, week)
  if (!window) return null
  const games = await readWeekGames(prisma, { sport: 'NBA', season: league.season, week, seasonType: 'regular', dateWindow: window })
  return games.reduce<Date | null>((earliest, game) => game.startTime && (!earliest || game.startTime < earliest) ? game.startTime : earliest, null)
}

export type TribeSitOutDeadlineResult = 'not_nba' | 'awaiting_schedule' | 'before_deadline' | 'locked' | 'blocked'

/**
 * Settles missing sit-outs at the first tipoff. The league advisory lock keeps
 * the choice immutable when several score-sync workers reach the cutoff together.
 */
export async function settleNbaTribeSitOutDeadline(leagueId: string, week: number, now = new Date()): Promise<TribeSitOutDeadlineResult> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, survivorMode: true, survivorPhase: true } })
  if (!league?.survivorMode || league.sport !== 'NBA' || !['pre_merge', 'post_swap', 'tribe'].includes(league.survivorPhase ?? '')) return 'not_nba'
  const firstTipoff = await nbaWeekTipoff(leagueId, week)
  if (!firstTipoff) return 'awaiting_schedule'
  if (now < firstTipoff) return 'before_deadline'

  const result = await withSurvivorSetupTransaction(leagueId, async tx => {
    const lockId = `sit-out-week:${leagueId}:${week}`
    const locked = await tx.survivorCommissionerAction.findUnique({ where: { id: lockId } })
    if (locked?.actionType === 'sit_out_week_locked') return { status: 'locked' as const, newlyBlocked: false }

    const [players, tribes, actions, prior] = await Promise.all([
      tx.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, tribeId: true, displayName: true } }),
      tx.survivorTribe.findMany({ where: { leagueId, isActive: true }, select: { id: true } }),
      tx.survivorCommissionerAction.findMany({ where: { leagueId, week, actionType: 'sit_out_accepted', wasConfirmed: true }, select: { targetUserId: true, targetTribeId: true } }),
      week > 1 ? tx.survivorCommissionerAction.findMany({ where: { leagueId, week: week - 1, actionType: 'sit_out_accepted', wasConfirmed: true }, select: { targetUserId: true } }) : Promise.resolve([]),
    ])
    const activeTribeIds = new Set(tribes.map(tribe => tribe.id))
    const byTribe = new Map<string, typeof players>()
    for (const player of players) {
      if (!player.tribeId || !activeTribeIds.has(player.tribeId)) continue
      byTribe.set(player.tribeId, [...(byTribe.get(player.tribeId) ?? []), player])
    }
    const required = requiredTribeSitOuts(Object.fromEntries([...byTribe].map(([tribeId, members]) => [tribeId, members.length])))
    const previousUsers = new Set(prior.map(row => row.targetUserId).filter((value): value is string => Boolean(value)))
    const acceptedUsers = new Set(actions.map(row => row.targetUserId).filter((value): value is string => Boolean(value)))
    const autoSelected: Array<{ userId: string; tribeId: string; name: string }> = []
    for (const [tribeId, members] of byTribe) {
      const already = actions.filter(row => row.targetTribeId === tribeId).length
      const missing = (required[tribeId] ?? 0) - already
      if (missing < 0) return { status: 'blocked' as const, newlyBlocked: false }
      const eligible = members.filter(row => !acceptedUsers.has(row.userId) && !previousUsers.has(row.userId))
      if (eligible.length < missing) {
        if (!locked) await tx.survivorCommissionerAction.create({ data: {
          id: lockId, leagueId, commissionerId: CHIMMY_HOST_USER_ID, week,
          actionType: 'sit_out_week_blocked', description: 'No fair tribe total is possible without a consecutive sit-out.',
          newState: { tribeId, required: required[tribeId], accepted: already, eligible: eligible.length, reason: 'no_consecutive_sit_out' },
          wasConfirmed: true,
        } })
        return { status: 'blocked' as const, newlyBlocked: !locked }
      }
      for (let i = 0; i < missing; i++) {
        const index = randomInt(eligible.length)
        const [chosen] = eligible.splice(index, 1)
        autoSelected.push({ userId: chosen.userId, tribeId, name: chosen.displayName })
      }
    }
    for (const row of autoSelected) {
      await tx.survivorCommissionerAction.create({ data: {
        id: `sit-out-auto:${leagueId}:${week}:${row.userId}`, leagueId,
        commissionerId: CHIMMY_HOST_USER_ID, week, actionType: 'sit_out_accepted',
        targetUserId: row.userId, targetTribeId: row.tribeId,
        description: `${row.name} was selected by Chimmy to sit out of the tribe total.`,
        newState: { status: 'accepted', automatic: true, selectedAt: now.toISOString() }, wasConfirmed: true,
      } })
    }
    const lockData = {
      actionType: 'sit_out_week_locked', description: 'Weekly tribe contributions locked at first NBA tipoff.',
      newState: { required, autoSelected: autoSelected.map(row => ({ userId: row.userId, tribeId: row.tribeId })), firstTipoff: firstTipoff.toISOString() },
      wasConfirmed: true,
    }
    if (locked) await tx.survivorCommissionerAction.update({ where: { id: lockId }, data: lockData })
    else await tx.survivorCommissionerAction.create({ data: { id: lockId, leagueId, commissionerId: CHIMMY_HOST_USER_ID, week, ...lockData } })
    return { status: 'locked' as const, newlyBlocked: false }
  })
  if (result.newlyBlocked) {
    await enqueueNotification(leagueId, 'tribe_shuffle_recommendation', {
      recipientRole: 'commissioner', title: 'Tribe balance needs a redraw',
      body: 'No eligible sit-out rotation can balance tribe totals this week. Review the tribe switch.',
      deepLinkPath: `/survivor/${leagueId}/commissioner?tab=tribes`, urgency: 'high', isSpoilerSafe: true,
    })
  }
  return result.status
}

/** Runs in the existing score-sync slot, independently of the season automation gate. */
export async function runNbaTribeSitOutDeadlineBatch(now = new Date()) {
  const states = await prisma.survivorGameState.findMany({
    where: { weekScoringFinalAt: null, phase: { in: ['pre_merge', 'post_swap', 'tribe'] }, league: { survivorMode: true, sport: 'NBA' } },
    select: { leagueId: true, currentWeek: true, pausedSnapshot: true, league: { select: { settings: true } } }, orderBy: { updatedAt: 'asc' }, take: 20,
  })
  const outcomes: Record<string, number> = {}
  let failed = 0
  for (const state of states) {
    if (state.pausedSnapshot != null) {
      outcomes.paused = (outcomes.paused ?? 0) + 1
      continue
    }
    try {
      const week = state.currentWeek > 0 ? state.currentWeek : readSurvivorFullSeasonPlan(state.league.settings)?.startWeek
      if (!week) continue
      const result = await settleNbaTribeSitOutDeadline(state.leagueId, week, now)
      outcomes[result] = (outcomes[result] ?? 0) + 1
    } catch {
      failed++
    }
  }
  return { considered: states.length, failed, outcomes }
}

export type SurvivorSitOutCandidate = {
  rosterId: string
  userId: string
  displayName: string
  tribeId: string
}

export type SitOutNominationResult =
  | { ok: true; sitOutId: string; nominatedUserId: string; nominatedDisplayName: string }
  | { ok: false; error: string; eligibleCandidates?: SurvivorSitOutCandidate[] }

export type SitOutResponseResult =
  | { ok: true; status: 'accepted' | 'declined'; sitOutId: string }
  | { ok: false; error: string }

export type SitOutMiniGameGuard = {
  blocked: boolean
  sitOutExcludedUserIds: string[]
  reason?: string
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function toPrismaJson(
  value: Prisma.JsonValue | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined
  if (value === null) return Prisma.JsonNull
  return value as Prisma.InputJsonValue
}

function toSitOutAction(
  row: Awaited<ReturnType<typeof prisma.survivorCommissionerAction.findFirst>> extends infer T
    ? NonNullable<T>
    : never,
): SurvivorSitOutAction {
  return {
    ...row,
    createdAt: row.executedAt,
  }
}

function hasSameWeekPendingNomination(actions: SurvivorSitOutAction[], nominatedUserId: string): boolean {
  return actions.some((row) => row.actionType === 'sit_out_nominated' && row.targetUserId === nominatedUserId)
}

async function postToTribeChat(leagueId: string, tribeId: string, content: string, cardData?: Record<string, unknown>): Promise<void> {
  const channel = await prisma.survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'tribe', tribeId, isArchived: false },
    select: { id: true },
  })
  if (!channel) return

  await createSurvivorChatMessage(prisma, {
    data: {
      leagueId,
      channelId: channel.id,
      channelType: 'tribe',
      senderUserId: CHIMMY_HOST_USER_ID,
      senderName: CHIMMY_HOST_NAME,
      senderIsHost: true,
      isSystemMessage: true,
      content,
      contentType: 'announcement',
      cardData: cardData as object | undefined,
    },
  })
}

async function getAcceptedSitOutActions(leagueId: string, week: number): Promise<SurvivorSitOutAction[]> {
  const rows = await prisma.survivorCommissionerAction.findMany({
    where: {
      leagueId,
      week,
      actionType: 'sit_out_accepted',
      wasConfirmed: true,
    },
    orderBy: { executedAt: 'asc' },
  })
  return rows.map(toSitOutAction)
}

async function getNominatedAndAcceptedActions(leagueId: string, week: number): Promise<SurvivorSitOutAction[]> {
  const rows = await prisma.survivorCommissionerAction.findMany({
    where: {
      leagueId,
      week,
      actionType: { in: ['sit_out_nominated', 'sit_out_accepted', 'sit_out_declined'] },
    },
    orderBy: { executedAt: 'asc' },
  })
  return rows.map(toSitOutAction)
}

export async function getSurvivorTribeBalanceState(leagueId: string, week: number): Promise<SurvivorTribeBalanceState> {
  const [league, tribes] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { survivorPhase: true } }),
    getTribesWithMembers(leagueId, { activeOnly: true }),
  ])

  const merged = ['merge', 'post_merge', 'jury', 'finale'].includes(league?.survivorPhase ?? '')
  if (merged || tribes.length === 0) {
    return {
      leagueId,
      week,
      merged,
      tribeSizes: [],
      minTribeSize: 0,
      maxTribeSize: 0,
      shouldSuggestShuffle: false,
      suggestionReason: null,
      requiredSitOuts: {},
    }
  }

  const activePlayers = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active' },
    select: { redraftRosterId: true },
  })
  const activeRosterIds = new Set(activePlayers.map((p) => p.redraftRosterId).filter((id): id is string => Boolean(id)))

  const tribeSizes = tribes.map((tribe) => ({
    tribeId: tribe.id,
    tribeName: tribe.name,
    activeCount: tribe.members.filter((m) => activeRosterIds.has(m.rosterId)).length,
  }))
  const activeSizes = tribeSizes.map(t => t.activeCount)
  const minTribeSize = activeSizes.length ? Math.min(...activeSizes) : 0
  const maxTribeSize = Math.max(...tribeSizes.map((t) => t.activeCount))
  // The owner's rule: a tribe below half the size of the largest tribe. Exactly half is not below.
  const shouldSuggestShuffle = tribeBelowHalfOfLargest(activeSizes)

  return {
    leagueId,
    week,
    merged,
    tribeSizes,
    minTribeSize,
    maxTribeSize,
    shouldSuggestShuffle,
    suggestionReason: shouldSuggestShuffle
      ? `A tribe has dropped below half the size of the largest tribe (${minTribeSize} vs ${maxTribeSize} active managers).`
      : null,
    requiredSitOuts: requiredTribeSitOuts(Object.fromEntries(tribeSizes.map(tribe => [tribe.tribeId, tribe.activeCount]))),
  }
}

export async function getEligibleSitOutCandidates(
  leagueId: string,
  tribeId: string,
  week: number,
): Promise<SurvivorSitOutCandidate[]> {
  const [members, lastWeekAccepted] = await Promise.all([
    prisma.survivorTribeMember.findMany({ where: { tribeId }, select: { rosterId: true } }),
    prisma.survivorCommissionerAction.findMany({
      where: {
        leagueId,
        week: week > 1 ? week - 1 : 0,
        actionType: 'sit_out_accepted',
        wasConfirmed: true,
      },
      select: { targetUserId: true },
    }),
  ])
  if (members.length === 0) return []

  const rosterIds = members.map((m) => m.rosterId)
  const [rosters, players] = await Promise.all([
    prisma.roster.findMany({
      where: { id: { in: rosterIds }, leagueId },
      select: { id: true, platformUserId: true },
    }),
    prisma.survivorPlayer.findMany({
      where: {
        leagueId,
        redraftRosterId: { in: rosterIds },
        playerState: 'active',
      },
      select: {
        redraftRosterId: true,
        userId: true,
        displayName: true,
        hasImmunityThisWeek: true,
      },
    }),
  ])

  const previousWeekSitOutUserIds = new Set(lastWeekAccepted.map((row) => row.targetUserId).filter((id): id is string => Boolean(id)))
  const userByRosterId = new Map(rosters.map((r) => [r.id, r.platformUserId]).filter((entry): entry is [string, string] => Boolean(entry[1])))

  return players
    .filter((player) => {
      const rosterId = player.redraftRosterId
      if (!rosterId) return false
      const rosterUserId = userByRosterId.get(rosterId)
      if (!rosterUserId) return false
      if (previousWeekSitOutUserIds.has(rosterUserId)) return false
      return true
    })
    .map((player) => ({
      rosterId: player.redraftRosterId ?? '',
      userId: player.userId,
      displayName: player.displayName,
      tribeId,
    }))
    .filter((candidate) => Boolean(candidate.rosterId))
}

export async function nominateSurvivorSitOut(input: {
  leagueId: string
  week: number
  nominatorUserId: string
  nominatorRosterId: string
  tribeId: string
  nominatedRosterId: string
  command: string
}): Promise<SitOutNominationResult> {
  const { leagueId, week, nominatorUserId, nominatorRosterId, tribeId, nominatedRosterId, command } = input

  const [league, nomineeRoster, nomineePlayer, nominatorPlayer, existingForWeek, eligible] = await Promise.all([
    prisma.league.findUnique({ where: { id: leagueId }, select: { survivorPhase: true } }),
    prisma.roster.findFirst({
      where: { id: nominatedRosterId, leagueId },
      select: { id: true, platformUserId: true },
    }),
    prisma.survivorPlayer.findFirst({
      where: { leagueId, redraftRosterId: nominatedRosterId },
      select: { userId: true, displayName: true, playerState: true },
    }),
    prisma.survivorPlayer.findFirst({
      where: { leagueId, redraftRosterId: nominatorRosterId },
      select: { userId: true, tribeId: true, playerState: true },
    }),
    getNominatedAndAcceptedActions(leagueId, week),
    getEligibleSitOutCandidates(leagueId, tribeId, week),
  ])
  const [balance, tipoff] = await Promise.all([getSurvivorTribeBalanceState(leagueId, week), nbaWeekTipoff(leagueId, week)])
  if (tipoff && new Date() >= tipoff) return { ok: false, error: 'Sit-out nominations closed at the first NBA tipoff of the week.' }
  const required = balance.requiredSitOuts[tribeId] ?? 0
  const acceptedCount = existingForWeek.filter(row => row.actionType === 'sit_out_accepted' && row.targetTribeId === tribeId).length
  if (required <= acceptedCount) return { ok: false, error: 'Your tribe has filled its sit-out spots for this week.' }
  if (required === 0) return { ok: false, error: 'This tribe does not need a sit-out this week.' }

  if (league?.survivorPhase === 'merge' || league?.survivorPhase === 'jury' || league?.survivorPhase === 'finale') {
    return { ok: false, error: 'Sit-out nominations are pre-merge only.' }
  }
  if (!nominatorPlayer || nominatorPlayer.playerState !== 'active') {
    return { ok: false, error: 'Only active tribe members can nominate a sit-out.' }
  }
  if (nominatorPlayer.tribeId !== tribeId) {
    return { ok: false, error: 'Sit-out nominations must be submitted from your own tribe chat.' }
  }
  if (!nomineeRoster?.platformUserId || !nomineePlayer) {
    return { ok: false, error: 'Could not resolve that manager in this Survivor league.', eligibleCandidates: eligible }
  }
  if (nomineePlayer.playerState !== 'active') {
    return { ok: false, error: 'Only active managers can be nominated to sit out.', eligibleCandidates: eligible }
  }

  const candidateAllowed = eligible.some((candidate) => candidate.userId === nomineeRoster.platformUserId)
  if (!candidateAllowed) {
    return {
      ok: false,
      error: 'That manager is not eligible to sit out right now (immunity or back-to-back rule).',
      eligibleCandidates: eligible,
    }
  }
  if (hasSameWeekPendingNomination(existingForWeek, nomineeRoster.platformUserId)) {
    return { ok: false, error: 'A pending sit-out nomination already exists for that manager this week.' }
  }
  if (existingForWeek.some((row) => row.actionType === 'sit_out_accepted' && row.targetUserId === nomineeRoster.platformUserId)) {
    return { ok: false, error: 'This manager already accepted a sit-out for the current week.' }
  }

  const nominationResult = await withSurvivorSetupTransaction(leagueId, async tx => {
    const [locked, accepted, pending, active] = await Promise.all([
      tx.survivorCommissionerAction.findUnique({ where: { id: `sit-out-week:${leagueId}:${week}` }, select: { id: true } }),
      tx.survivorCommissionerAction.count({ where: { leagueId, week, targetTribeId: tribeId, actionType: 'sit_out_accepted', wasConfirmed: true } }),
      tx.survivorCommissionerAction.findFirst({ where: { leagueId, week, targetUserId: nomineeRoster.platformUserId, actionType: 'sit_out_nominated' }, select: { id: true } }),
      tx.survivorPlayer.findFirst({ where: { leagueId, userId: nomineeRoster.platformUserId, playerState: 'active', tribeId }, select: { userId: true } }),
    ])
    if (locked || (tipoff && new Date() >= tipoff)) return { ok: false as const, error: 'Sit-out nominations closed at the first NBA tipoff.' }
    if (!active) return { ok: false as const, error: 'That manager is no longer active in your tribe.' }
    if (accepted >= required) return { ok: false as const, error: 'Your tribe has filled its sit-out spots for this week.' }
    if (pending) return { ok: false as const, error: 'A pending sit-out nomination already exists for that manager this week.' }
    const created = await tx.survivorCommissionerAction.create({ data: {
      leagueId,
      commissionerId: nominatorUserId,
      week,
      actionType: 'sit_out_nominated',
      targetUserId: nomineeRoster.platformUserId,
      targetTribeId: tribeId,
      description: `${nomineePlayer.displayName} was nominated to sit out (pending acceptance).`,
      previousState: {
        status: 'none',
      } as object,
      newState: {
        status: 'pending',
        nominatedByUserId: nominatorUserId,
        nominatedByRosterId: nominatorRosterId,
        nominatedRosterId,
        command,
      } as object,
      wasConfirmed: false,
    } })
    return { ok: true as const, created }
  })
  if (!nominationResult.ok) return nominationResult
  const created = nominationResult.created

  await Promise.all([
    enqueueNotification(leagueId, 'sit_out_nomination', {
      recipientUserId: nomineeRoster.platformUserId,
      title: '🪑 Sit-out nomination pending',
      body: `Your tribe nominated you to sit out this week. Confirm Yes/No in Survivor.`,
      deepLinkPath: `/league/${leagueId}/survivor?sitOutId=${created.id}`,
      urgency: 'high',
      isSpoilerSafe: true,
    }),
    postToTribeChat(
      leagueId,
      tribeId,
      `${nomineePlayer.displayName} was nominated to sit out this week. This only becomes official if they click Yes.`,
      {
        type: 'sit_out_nomination',
        sitOutId: created.id,
        status: 'pending',
        nominatedUserId: nomineeRoster.platformUserId,
        nominatedDisplayName: nomineePlayer.displayName,
        week,
      },
    ),
    logSurvivorAuditEntry({
      leagueId,
      week,
      category: 'sit_out',
      action: 'SIT_OUT_NOMINATED',
      actorUserId: nominatorUserId,
      targetUserId: nomineeRoster.platformUserId,
      targetTribeId: tribeId,
      relatedEntityId: created.id,
      relatedEntityType: 'survivor_commissioner_action',
      data: {
        status: 'pending',
        nominatedByRosterId: nominatorRosterId,
      },
      isVisibleToCommissioner: true,
      isVisibleToPublic: false,
    }),
  ])

  return {
    ok: true,
    sitOutId: created.id,
    nominatedUserId: nomineeRoster.platformUserId,
    nominatedDisplayName: nomineePlayer.displayName,
  }
}

export async function respondToSurvivorSitOut(input: {
  leagueId: string
  sitOutId: string
  responderUserId: string
  accept: boolean
}): Promise<SitOutResponseResult> {
  const nomination = await prisma.survivorCommissionerAction.findFirst({
    where: {
      id: input.sitOutId,
      leagueId: input.leagueId,
    },
  })
  if (!nomination) return { ok: false, error: 'Sit-out nomination was not found.' }
  if (nomination.actionType !== 'sit_out_nominated') {
    return { ok: false, error: 'This sit-out nomination is no longer pending.' }
  }
  if (!nomination.targetUserId || nomination.targetUserId !== input.responderUserId) {
    return { ok: false, error: 'Only the nominated manager can respond to this sit-out.' }
  }

  const status: 'accepted' | 'declined' = input.accept ? 'accepted' : 'declined'
  const tipoff = nomination.week == null ? null : await nbaWeekTipoff(input.leagueId, nomination.week)
  if (tipoff && new Date() >= tipoff) return { ok: false, error: 'Sit-out decisions closed at the first NBA tipoff.' }
  const changed = await withSurvivorSetupTransaction(input.leagueId, async tx => {
    const current = await tx.survivorCommissionerAction.findUnique({ where: { id: nomination.id } })
    if (!current || current.actionType !== 'sit_out_nominated') return { ok: false as const, error: 'This sit-out nomination is no longer pending.' }
    if (tipoff && new Date() >= tipoff) return { ok: false as const, error: 'Sit-out decisions closed at the first NBA tipoff.' }
    if (input.accept) {
      if (current.week == null || !current.targetTribeId) return { ok: false as const, error: 'Sit-out nomination is missing its week or tribe.' }
      const [active, accepted, prior, lock] = await Promise.all([
        tx.survivorPlayer.findMany({ where: { leagueId: input.leagueId, playerState: 'active' }, select: { userId: true, tribeId: true } }),
        tx.survivorCommissionerAction.findMany({ where: { leagueId: input.leagueId, week: current.week, actionType: 'sit_out_accepted', wasConfirmed: true }, select: { targetUserId: true, targetTribeId: true } }),
        current.week > 1 ? tx.survivorCommissionerAction.findMany({ where: { leagueId: input.leagueId, week: current.week - 1, actionType: 'sit_out_accepted', wasConfirmed: true }, select: { targetUserId: true } }) : Promise.resolve([]),
        tx.survivorCommissionerAction.findUnique({ where: { id: `sit-out-week:${input.leagueId}:${current.week}` }, select: { id: true } }),
      ])
      if (lock) return { ok: false as const, error: 'Weekly tribe sit-outs are already locked.' }
      if (!active.some(row => row.userId === input.responderUserId && row.tribeId === current.targetTribeId)) return { ok: false as const, error: 'This manager is no longer an active member of the tribe.' }
      if (prior.some(row => row.targetUserId === input.responderUserId)) return { ok: false as const, error: 'A manager cannot sit out in consecutive weeks.' }
      const counts: Record<string, number> = {}
      for (const row of active) if (row.tribeId) counts[row.tribeId] = (counts[row.tribeId] ?? 0) + 1
      const required = requiredTribeSitOuts(counts)[current.targetTribeId] ?? 0
      if (accepted.filter(row => row.targetTribeId === current.targetTribeId).length >= required) return { ok: false as const, error: 'Your tribe has already filled its sit-out spots.' }
    }
    const updated = await tx.survivorCommissionerAction.update({
      where: { id: nomination.id },
      data: {
        actionType: status === 'accepted' ? 'sit_out_accepted' : 'sit_out_declined',
        description: status === 'accepted' ? 'Sit-out nomination accepted by nominated manager.' : 'Sit-out nomination declined by nominated manager.',
        previousState: toPrismaJson(current.newState),
        newState: { ...asObject(current.newState), status, respondedAt: new Date().toISOString(), respondedByUserId: input.responderUserId } as object,
        wasConfirmed: status === 'accepted', executedAt: new Date(),
      },
    })
    return { ok: true as const, updated }
  })
  if (!changed.ok) return changed
  const updated = changed.updated

  await Promise.all([
    nomination.targetTribeId
      ? postToTribeChat(
          input.leagueId,
          nomination.targetTribeId,
          status === 'accepted'
            ? 'Sit-out accepted. Only this manager’s tribe score contribution is excluded; individual scoring, challenges, and voting still count.'
            : 'Sit-out declined. No sit-out is applied for this nomination.',
          {
            type: 'sit_out_response',
            sitOutId: nomination.id,
            status,
            week: nomination.week ?? null,
          },
        )
      : Promise.resolve(),
    logSurvivorAuditEntry({
      leagueId: input.leagueId,
      week: nomination.week,
      category: 'sit_out',
      action: status === 'accepted' ? 'SIT_OUT_ACCEPTED' : 'SIT_OUT_DECLINED',
      actorUserId: input.responderUserId,
      targetUserId: input.responderUserId,
      targetTribeId: nomination.targetTribeId,
      relatedEntityId: nomination.id,
      relatedEntityType: 'survivor_commissioner_action',
      data: {
        status,
      },
      isVisibleToCommissioner: true,
      isVisibleToPublic: false,
    }),
  ])

  if (status === 'accepted' && nomination.week != null) {
    await maybeTriggerSurvivorTribeShuffleRecommendation(input.leagueId, nomination.week)
  }

  return { ok: true, status, sitOutId: updated.id }
}

export async function applySurvivorSitOutToScoring(
  leagueId: string,
  week: number,
): Promise<{ sitOutExcludedUserIds: string[]; tribeScoreBeforeSitOut: Record<string, number>; tribeScoreAfterSitOut: Record<string, number> }> {
  const accepted = await getAcceptedSitOutActions(leagueId, week)
  const sitOutExcludedUserIds = [...new Set(accepted.map((row) => row.targetUserId).filter((id): id is string => Boolean(id)))]
  if (sitOutExcludedUserIds.length === 0) {
    return {
      sitOutExcludedUserIds: [],
      tribeScoreBeforeSitOut: {},
      tribeScoreAfterSitOut: {},
    }
  }

  const weeklyRows = await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, week },
    select: { id: true, userId: true, tribeId: true, finalScore: true, countedTowardTribeTotal: true },
  })

  const tribeScoreBeforeSitOut: Record<string, number> = {}
  for (const row of weeklyRows) {
    if (!row.tribeId || !row.countedTowardTribeTotal) continue
    tribeScoreBeforeSitOut[row.tribeId] = (tribeScoreBeforeSitOut[row.tribeId] ?? 0) + row.finalScore
  }

  const excludedRowIds = weeklyRows
    .filter((row) => sitOutExcludedUserIds.includes(row.userId) && row.countedTowardTribeTotal)
    .map((row) => row.id)

  if (excludedRowIds.length > 0) {
    await prisma.survivorWeeklyScore.updateMany({
      where: { id: { in: excludedRowIds } },
      data: { countedTowardTribeTotal: false },
    })
  }

  const refreshedRows = await prisma.survivorWeeklyScore.findMany({
    where: { leagueId, week },
    select: { tribeId: true, finalScore: true, countedTowardTribeTotal: true },
  })
  const tribeScoreAfterSitOut: Record<string, number> = {}
  for (const row of refreshedRows) {
    if (!row.tribeId || !row.countedTowardTribeTotal) continue
    tribeScoreAfterSitOut[row.tribeId] = (tribeScoreAfterSitOut[row.tribeId] ?? 0) + row.finalScore
  }

  await logSurvivorAuditEntry({
    leagueId,
    week,
    category: 'sit_out',
    action: 'SIT_OUT_APPLIED_TO_SCORING',
    data: {
      sitOutExcludedUserIds,
      tribeScoreBeforeSitOut,
      tribeScoreAfterSitOut,
    },
    isVisibleToCommissioner: true,
    isVisibleToPublic: false,
  })

  return {
    sitOutExcludedUserIds,
    tribeScoreBeforeSitOut,
    tribeScoreAfterSitOut,
  }
}

export async function applySurvivorSitOutToMiniGames(input: {
  leagueId: string
  week: number
  rosterId: string
}): Promise<SitOutMiniGameGuard> {
  // Sit-outs change only the verified tribe fantasy total. A manager may still
  // submit individual challenges, take part in tribe decisions, and vote.
  void input
  return { blocked: false, sitOutExcludedUserIds: [] }
}

export async function maybeTriggerSurvivorTribeShuffleRecommendation(
  leagueId: string,
  week: number,
): Promise<{ triggered: boolean; reason: string }> {
  const balance = await getSurvivorTribeBalanceState(leagueId, week)

  if (!balance.shouldSuggestShuffle) {
    return { triggered: false, reason: 'No tribe has dropped below half the size of the largest tribe.' }
  }
  const existingRecommendation = await prisma.survivorCommissionerAction.findFirst({
    where: { leagueId, actionType: TRIBE_REDRAW_RECOMMENDATION_ACTION }, orderBy: { executedAt: 'desc' }, select: { id: true, week: true },
  })
  if (existingRecommendation) {
    if (existingRecommendation.week === week) return { triggered: false, reason: 'This week’s shuffle recommendation already exists.' }
    const priorResponse = await prisma.survivorCommissionerAction.findFirst({
      where: { leagueId, actionType: { in: TRIBE_REDRAW_RESPONSE_ACTIONS }, description: existingRecommendation.id },
      select: { id: true },
    })
    if (!priorResponse) return { triggered: false, reason: 'An earlier shuffle recommendation is awaiting a commissioner decision.' }
  }

  const created = await prisma.survivorCommissionerAction.create({
    data: {
      id: `survivor-redraw:${leagueId}:${week}`,
      leagueId,
      commissionerId: CHIMMY_HOST_USER_ID,
      week,
      actionType: TRIBE_REDRAW_RECOMMENDATION_ACTION,
      description: 'A tribe fell below half the size of the largest tribe. Choose a random redraw, reassign by hand, or merge now; the random redraw runs on its own before the next council.',
      newState: {
        minTribeSize: balance.minTribeSize,
        maxTribeSize: balance.maxTribeSize,
        tribeSizes: balance.tribeSizes,
        defaultDecision: TRIBE_REDRAW_DEFAULT_DECISION,
        options: [...TRIBE_REDRAW_DECISIONS],
      } as object,
      wasConfirmed: false,
    },
  })

  await Promise.all([
    enqueueNotification(leagueId, 'tribe_shuffle_recommendation', {
      recipientRole: 'commissioner',
      title: '⚖️ Tribe redraw recommended',
      body: 'A tribe has fallen below half the size of the largest tribe. Choose a random redraw, reassign by hand, or merge now. The random redraw runs on its own before the next council.',
      deepLinkPath: `/survivor/${leagueId}/commissioner?tab=tribes`,
      urgency: 'high',
      isSpoilerSafe: true,
    }),
    logSurvivorAuditEntry({
      leagueId,
      week,
      category: 'sit_out',
      action: 'SIT_OUT_SHUFFLE_RECOMMENDED',
      relatedEntityId: created.id,
      relatedEntityType: 'survivor_commissioner_action',
      data: {
        minTribeSize: balance.minTribeSize,
        maxTribeSize: balance.maxTribeSize,
        tribeSizes: balance.tribeSizes,
      },
      isVisibleToCommissioner: true,
      isVisibleToPublic: false,
    }),
  ])

  return { triggered: true, reason: 'Shuffle recommendation created.' }
}

export async function getSurvivorSitOutStateForWeek(leagueId: string, week: number): Promise<{
  pending: SurvivorSitOutAction[]
  accepted: SurvivorSitOutAction[]
  declined: SurvivorSitOutAction[]
}> {
  const rows = (await prisma.survivorCommissionerAction.findMany({
    where: {
      leagueId,
      week,
      actionType: { in: ['sit_out_nominated', 'sit_out_accepted', 'sit_out_declined'] },
    },
    orderBy: { executedAt: 'asc' },
  }))

  return {
    pending: rows.filter((row) => row.actionType === 'sit_out_nominated').map(toSitOutAction),
    accepted: rows.filter((row) => row.actionType === 'sit_out_accepted').map(toSitOutAction),
    declined: rows.filter((row) => row.actionType === 'sit_out_declined').map(toSitOutAction),
  }
}
