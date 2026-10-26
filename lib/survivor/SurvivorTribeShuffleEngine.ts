/**
 * Survivor tribe shuffle: rebalance tribes by consecutive losses or imbalance (PROMPT 346). Deterministic.
 */

import { prisma } from '@/lib/prisma'
import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { getTribesWithMembers } from './SurvivorTribeService'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { provisionSurvivorChats } from './survivorTribeChatProvisioning'
import type { SurvivorTribeWithMembers } from './types'
import { createSurvivorChatMessage } from './survivorChatBridge'
import { survivorRedrawTribeCount } from './survivorTribeRedrawActions'

/**
 * Check if shuffle should run: consecutive council losses or size imbalance.
 * Returns { shouldShuffle, reason }.
 */
export async function checkShuffleTrigger(
  leagueId: string,
  options?: { currentWeek?: number }
): Promise<{ shouldShuffle: boolean; reason?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config || !config.tribeShuffleEnabled) return { shouldShuffle: false }

  const tribes = await getTribesWithMembers(leagueId, { activeOnly: true })
  if (tribes.length === 0) return { shouldShuffle: false }

  const councils = await prisma.survivorTribalCouncil.findMany({
    where: { leagueId, phase: 'pre_merge' },
    orderBy: { week: 'asc' },
    select: { week: true, attendingTribeId: true, eliminatedRosterId: true },
  })

  if (config.tribeShuffleConsecutiveLosses != null && config.tribeShuffleConsecutiveLosses > 0) {
    for (const tribe of tribes) {
      let consecutive = 0
      for (let i = councils.length - 1; i >= 0; i--) {
        const c = councils[i]
        if (c.attendingTribeId !== tribe.id) break
        if (c.eliminatedRosterId) consecutive++
        else break
      }
      if (consecutive >= config.tribeShuffleConsecutiveLosses) {
        return { shouldShuffle: true, reason: `Tribe ${tribe.name} has ${consecutive} consecutive council losses` }
      }
    }
  }

  if (config.tribeShuffleImbalanceThreshold != null && config.tribeShuffleImbalanceThreshold > 0) {
    const sizes = tribes.map((t) => t.members.length)
    const min = Math.min(...sizes)
    const max = Math.max(...sizes)
    if (max - min >= config.tribeShuffleImbalanceThreshold) {
      return { shouldShuffle: true, reason: `Tribe size imbalance: ${min} vs ${max}` }
    }
  }

  return { shouldShuffle: false }
}

/**
 * Reassign active managers and replace tribe huddles in the same transaction.
 */
export async function runShuffle(
  leagueId: string,
  options?: { seed?: number; db?: Prisma.TransactionClient; actorUserId?: string; recommendationId?: string }
): Promise<{ ok: boolean; tribes?: SurvivorTribeWithMembers[]; error?: string }> {
  if (!options?.db) {
    const result = await withSurvivorSetupTransaction(leagueId, db => runShuffle(leagueId, { ...options, db }))
    return result.ok ? { ...result, tribes: await getTribesWithMembers(leagueId) } : result
  }
  const db = options.db
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, activeCouncilId: true } })
  if (!game || !['pre_merge', 'active', 'tribe', 'post_swap'].includes(game.phase) || game.activeCouncilId) {
    return { ok: false, error: 'A redraw is available only between councils before the merge.' }
  }
  const tribes = await db.survivorTribe.findMany({
    where: { configId: config.configId, isActive: true, isMerged: false },
    orderBy: { slotIndex: 'asc' },
    include: { members: true },
  })
  if (tribes.length < 2) return { ok: false, error: 'At least two active tribes are required.' }

  const players = await db.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true, redraftRosterId: true, tribeId: true } })
  const active = players.filter((player): player is typeof player & { redraftRosterId: string } => Boolean(player.redraftRosterId))
  if (active.length !== players.length || !active.length || new Set(active.map(player => player.redraftRosterId)).size !== active.length) {
    return { ok: false, error: 'Active managers need unique linked rosters before a redraw.' }
  }
  const activeRosterIds = new Set(active.map(player => player.redraftRosterId))
  const oldRosterIds = tribes.flatMap(tribe => tribe.members.map(member => member.rosterId)).filter(id => activeRosterIds.has(id))
  if (oldRosterIds.length !== active.length || new Set(oldRosterIds).size !== active.length ||
      active.some(player => !tribes.some(tribe => tribe.id === player.tribeId))) {
    return { ok: false, error: 'Current tribe assignments do not match the active cast. Review setup before redrawing.' }
  }

  const seed = options?.seed ?? randomInt(0, 2 ** 32)
  let s = seed
  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr]
    for (let i = out.length - 1; i > 0; i--) {
      s = (s * 1103515245 + 12345) >>> 0
      const j = (s % (i + 1)) >>> 0
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  const shuffled = shuffle(active)
  const tribeCount = survivorRedrawTribeCount(active.length, tribes.length)
  if (tribeCount == null) return { ok: false, error: 'Too few managers remain for two tribes; merge instead.' }
  // The highest slots retire when the cast no longer fills every tribe. Their huddles archive with
  // the rest, and the row stays (inactive, empty) so history still names them.
  const keptTribes = tribes.slice(0, tribeCount)
  const retiredTribeIds = tribes.slice(tribeCount).map(tribe => tribe.id)
  const tribeIds = tribes.map(tribe => tribe.id)
  const now = new Date()
  const oldChannels = await db.survivorChatChannel.findMany({ where: { leagueId, channelType: 'tribe', tribeId: { in: tribeIds }, isArchived: false }, select: { id: true } })
  const beforeSnapshot = tribes.map(tribe => ({ tribeId: tribe.id, rosterIds: tribe.members.map(member => member.rosterId) }))
  const afterSnapshot = keptTribes.map((tribe, slot) => ({ tribeId: tribe.id, rosterIds: shuffled.filter((_, index) => index % tribeCount === slot).map(player => player.redraftRosterId) }))

  // Old channels lose every member and stay archived. New groups receive new channel IDs.
  if (oldChannels.length) await db.survivorChatChannel.updateMany({ where: { id: { in: oldChannels.map(channel => channel.id) } }, data: { isArchived: true, archivedAt: now, memberUserIds: [], readOnlyUserIds: [] } })
  await db.survivorTribe.updateMany({ where: { id: { in: tribeIds } }, data: { chatChannelId: null } })
  await db.survivorTribeMember.deleteMany({ where: { tribeId: { in: tribeIds } } })
  await db.survivorTribeChatMember.deleteMany({ where: { tribeId: { in: tribeIds } } })
  if (retiredTribeIds.length) await db.survivorTribe.updateMany({ where: { id: { in: retiredTribeIds } }, data: { isActive: false, phase: 'dissolved' } })
  for (let slot = 0; slot < tribeCount; slot++) {
    const tribe = keptTribes[slot]
    const members = shuffled.filter((_, index) => index % tribeCount === slot)
    for (let index = 0; index < members.length; index++) {
      const player = members[index]
      await db.survivorTribeMember.create({ data: { tribeId: tribe.id, rosterId: player.redraftRosterId, isLeader: index === 0 } })
      await db.survivorTribeChatMember.create({ data: { tribeId: tribe.id, rosterId: player.redraftRosterId, isAiHost: false } })
      await db.survivorPlayer.update({ where: { leagueId_userId: { leagueId, userId: player.userId } }, data: { tribeId: tribe.id, canAccessTribeChat: true } })
    }
    await db.survivorTribeChatMember.create({ data: { tribeId: tribe.id, rosterId: '', userId: 'survivor-ai-host', isAiHost: true } })
  }
  const chats = await provisionSurvivorChats(leagueId, { db, actorUserId: options.actorUserId })
  await createSurvivorChatMessage(db, { data: { leagueId, channelId: chats.leagueChannelId, channelType: 'league',
    senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
    contentType: 'host_announcement', content: retiredTribeIds.length
      ? `Tribes have been randomly redrawn into ${tribeCount} tribes. Open the Tribe Board to meet your new huddle.`
      : 'Tribes have been randomly redrawn. Open the Tribe Board to meet your new huddle.' } })
  await db.survivorTribeSwap.create({ data: { leagueId, week: (await db.survivorGameState.findUnique({ where: { leagueId }, select: { currentWeek: true } }))?.currentWeek ?? 0,
    swapType: 'random_shuffle', beforeSnapshot, afterSnapshot, originalTribesRetained: true } })
  await db.survivorAuditEntry.create({ data: { leagueId, category: 'tribe', action: 'tribe_shuffle', actorUserId: options.actorUserId ?? null,
    data: { rosterCount: shuffled.length, tribeCount, previousTribeCount: tribes.length, retiredTribeIds, seed, recommendationId: options.recommendationId ?? null, archivedHuddles: oldChannels.length },
    isVisibleToCommissioner: true, isVisibleToPublic: true } })
  return { ok: true }
}
