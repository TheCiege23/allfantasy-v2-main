import 'server-only'

import { randomInt } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { provisionSurvivorChats } from './survivorTribeChatProvisioning'

/**
 * TRIBE REDRAW — the one-time random reshuffle offered when a tribe falls to 40% of its original
 * size. The commissioner approves or postpones it (playing commissioners included: the draw is
 * random, so approving it reveals nothing and favours no one). Membership is canonical on
 * SurvivorPlayer.tribeId; the legacy member rows and tribe chats are rebuilt from it.
 */

export const TRIBE_REDRAW_RECOMMENDATION = 'sit_out_shuffle_recommendation'
export const TRIBE_REDRAW_APPROVED = 'tribe_redraw_approved'
export const TRIBE_REDRAW_POSTPONED = 'tribe_redraw_postponed'

export type TribeRedrawStatus = { status: 'none' | 'recommended' | 'postponed' | 'done'; recommendedWeek: number | null }

/** Fisher–Yates with an unbiased integer source, then dealt round-robin so sizes differ by at most one. */
export function dealTribes(userIds: string[], tribeIds: string[], pick: (maxExclusive: number) => number = randomInt): Map<string, string> {
  const order = [...userIds]
  for (let i = order.length - 1; i > 0; i--) {
    const j = pick(i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return new Map(order.map((userId, index) => [userId, tribeIds[index % tribeIds.length]]))
}

export async function getTribeRedrawStatus(leagueId: string): Promise<TribeRedrawStatus> {
  const actions = await prisma.survivorCommissionerAction.findMany({
    where: { leagueId, actionType: { in: [TRIBE_REDRAW_RECOMMENDATION, TRIBE_REDRAW_APPROVED, TRIBE_REDRAW_POSTPONED] } },
    orderBy: { executedAt: 'asc' },
    select: { actionType: true, week: true },
  })
  const recommendation = actions.find(action => action.actionType === TRIBE_REDRAW_RECOMMENDATION)
  if (!recommendation) return { status: 'none', recommendedWeek: null }
  if (actions.some(action => action.actionType === TRIBE_REDRAW_APPROVED)) return { status: 'done', recommendedWeek: recommendation.week }
  return { status: actions.some(action => action.actionType === TRIBE_REDRAW_POSTPONED) ? 'postponed' : 'recommended', recommendedWeek: recommendation.week }
}

export type TribeRedrawOutcome =
  | { ok: true; tribeSizes: Record<string, number> }
  | { ok: false; status: 404 | 409; error: string }

export async function decideTribeRedraw(
  leagueId: string,
  actorUserId: string,
  decision: 'approve' | 'postpone',
  pick?: (maxExclusive: number) => number,
): Promise<TribeRedrawOutcome> {
  const current = await getTribeRedrawStatus(leagueId)
  if (current.status === 'none') return { ok: false, status: 404, error: 'No tribe redraw has been recommended.' }
  if (current.status === 'done') return { ok: false, status: 409, error: 'The tribes have already been redrawn this season.' }
  if (decision === 'postpone') {
    await prisma.survivorCommissionerAction.create({ data: { leagueId, commissionerId: actorUserId, week: current.recommendedWeek,
      actionType: TRIBE_REDRAW_POSTPONED, description: 'Tribe redraw postponed. It can still be approved before the merge.', wasConfirmed: true } })
    return { ok: true, tribeSizes: {} }
  }
  return withSurvivorSetupTransaction(leagueId, async db => {
    const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, activeCouncilId: true, currentWeek: true, pausedSnapshot: true } })
    if (!game || !['pre_merge', 'post_swap'].includes(game.phase)) return { ok: false as const, status: 409 as const, error: 'Tribes can only be redrawn before the merge.' }
    if (game.activeCouncilId) return { ok: false as const, status: 409 as const, error: 'Wait until the open Tribal Council is resolved before redrawing tribes.' }
    if (game.pausedSnapshot != null) return { ok: false as const, status: 409 as const, error: 'Resume the season before redrawing tribes.' }
    if (await db.survivorCommissionerAction.findFirst({ where: { leagueId, actionType: TRIBE_REDRAW_APPROVED }, select: { id: true } })) {
      return { ok: false as const, status: 409 as const, error: 'The tribes have already been redrawn this season.' }
    }
    const players = await db.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { id: true, userId: true, redraftRosterId: true } })
    const tribes = await db.survivorTribe.findMany({ where: { leagueId, isActive: true, isMerged: false }, orderBy: { slotIndex: 'asc' }, select: { id: true, name: true } })
    // Every tribe that keeps playing needs at least two managers to hold a vote.
    const keep = tribes.slice(0, Math.max(1, Math.min(tribes.length, Math.floor(players.length / 2))))
    if (keep.length < 2) return { ok: false as const, status: 409 as const, error: 'Too few managers remain to split into tribes. Merge instead.' }
    const assignment = dealTribes(players.map(player => player.userId), keep.map(tribe => tribe.id), pick)
    for (const player of players) await db.survivorPlayer.update({ where: { id: player.id }, data: { tribeId: assignment.get(player.userId)!, canAccessTribeChat: true } })
    // Legacy membership rows mirror the canonical assignment for older readers.
    await db.survivorTribeMember.deleteMany({ where: { tribeId: { in: tribes.map(tribe => tribe.id) } } })
    for (const player of players) if (player.redraftRosterId) await db.survivorTribeMember.create({ data: { tribeId: assignment.get(player.userId)!, rosterId: player.redraftRosterId } })
    for (const tribe of tribes.slice(keep.length)) await db.survivorTribe.update({ where: { id: tribe.id }, data: { isActive: false } })
    await provisionSurvivorChats(leagueId, { db, actorUserId })
    const tribeSizes = Object.fromEntries(keep.map(tribe => [tribe.name, [...assignment.values()].filter(id => id === tribe.id).length]))
    await db.survivorCommissionerAction.create({ data: { leagueId, commissionerId: actorUserId, week: game.currentWeek,
      actionType: TRIBE_REDRAW_APPROVED, description: 'Random tribe redraw approved and applied.', newState: { tribeSizes } as object, wasConfirmed: true } })
    await db.survivorAuditEntry.create({ data: { leagueId, week: game.currentWeek, category: 'tribe', action: 'tribes_redrawn', actorUserId,
      data: { tribeSizes }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    const channel = await db.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
    if (channel) await db.survivorChatMessage.create({ data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
      contentType: 'host_announcement', content: `Drop your buffs. The tribes have been redrawn at random: ${Object.entries(tribeSizes).map(([name, size]) => `${name} (${size})`).join(', ')}. Check your new tribe chat.` } })
    return { ok: true as const, tribeSizes }
  })
}
