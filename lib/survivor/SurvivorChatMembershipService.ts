/**
 * Survivor tribe chat membership: add/remove members, AI host (PROMPT 346). Deterministic.
 * Tribe chat is identified by source = 'tribe_<tribeId>' on LeagueChatMessage or equivalent.
 * This service manages SurvivorTribeChatMember rows for who is in each tribe chat.
 */

import { prisma } from '@/lib/prisma'
import { getSurvivorConfig } from './SurvivorLeagueConfig'
import { getTribesWithMembers } from './SurvivorTribeService'
import { appendSurvivorAudit } from './SurvivorAuditLog'
import { tribeChatSource } from './constants'

const AI_HOST_USER_ID = 'survivor-ai-host'

async function rosterIdsToUserIds(rosterIds: string[]): Promise<string[]> {
  if (rosterIds.length === 0) return []
  const rosters = await prisma.roster.findMany({
    where: { id: { in: rosterIds } },
    select: { id: true, platformUserId: true },
  })
  return rosters
    .map((row) => row.platformUserId)
    .filter((value): value is string => Boolean(value))
}

async function syncChannelMembersForTribe(leagueId: string, tribeId: string, rosterIds: string[]): Promise<void> {
  const memberUserIds = await rosterIdsToUserIds(rosterIds)
  const deduped = [...new Set([...memberUserIds, AI_HOST_USER_ID])]
  const channel = await prisma.survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'tribe', tribeId, isArchived: false },
  })
  if (!channel) return
  await prisma.survivorChatChannel.update({
    where: { id: channel.id },
    data: { memberUserIds: deduped },
  })
}

/**
 * Bootstrap tribe chat memberships after tribes are created: add all tribe members + AI host per tribe.
 */
export async function bootstrapTribeChatMembers(leagueId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const tribes = await getTribesWithMembers(leagueId)
  for (const tribe of tribes) {
    for (const member of tribe.members) {
      await prisma.survivorTribeChatMember.upsert({
        where: {
          uniq_tribe_roster: { tribeId: tribe.id, rosterId: member.rosterId },
        },
        create: {
          tribeId: tribe.id,
          rosterId: member.rosterId,
          isAiHost: false,
        },
        update: {},
      })
    }
    await prisma.survivorTribeChatMember.upsert({
      where: {
        uniq_tribe_user: { tribeId: tribe.id, userId: AI_HOST_USER_ID },
      },
      create: {
        tribeId: tribe.id,
        rosterId: '',
        userId: AI_HOST_USER_ID,
        isAiHost: true,
      },
      update: {},
    })
  }

  // Sync memberUserIds on SurvivorChatChannel so permission guard works.
  for (const tribe of tribes) {
    await syncChannelMembersForTribe(
      leagueId,
      tribe.id,
      tribe.members.map((member) => member.rosterId),
    )
  }

  await appendSurvivorAudit(leagueId, config.configId, 'chat_membership_updated', {
    action: 'bootstrap',
    tribeCount: tribes.length,
  })
  return { ok: true }
}

/**
 * Remove a roster from their tribe chat (e.g. after elimination). Add to exile/jury chat per product.
 */
export async function removeRosterFromTribeChat(leagueId: string, rosterId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const memberships = await prisma.survivorTribeChatMember.findMany({
    where: { rosterId, tribe: { configId: config.configId } },
    select: { tribeId: true },
  })

  const deleted = await prisma.survivorTribeChatMember.deleteMany({
    where: { rosterId, tribe: { configId: config.configId } },
  })
  for (const membership of memberships) {
    const remaining = await prisma.survivorTribeChatMember.findMany({
      where: { tribeId: membership.tribeId, isAiHost: false },
      select: { rosterId: true },
    })
    await syncChannelMembersForTribe(
      leagueId,
      membership.tribeId,
      remaining.map((row) => row.rosterId),
    )
  }
  if (deleted.count > 0) {
    await appendSurvivorAudit(leagueId, config.configId, 'chat_membership_updated', {
      action: 'remove',
      rosterId,
    })
  }
  return { ok: true }
}

/**
 * Get chat source string for a tribe (for filtering LeagueChatMessage or posting).
 */
export function getTribeChatSource(tribeId: string): string {
  return tribeChatSource(tribeId)
}

/**
 * Get roster IDs that are members of a tribe chat (for permission checks).
 */
export async function getTribeChatMemberRosterIds(tribeId: string): Promise<string[]> {
  const members = await prisma.survivorTribeChatMember.findMany({
    where: { tribeId, isAiHost: false },
    select: { rosterId: true },
  })
  return members.map((m) => m.rosterId).filter(Boolean)
}

/**
 * After shuffle: update tribe chat memberships to match new tribe members. Remove old, add new.
 */
export async function syncTribeChatMembersAfterShuffle(leagueId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  const tribes = await getTribesWithMembers(leagueId)
  for (const tribe of tribes) {
    const currentRosterIds = new Set(tribe.members.map((m) => m.rosterId))
    const existing = await prisma.survivorTribeChatMember.findMany({
      where: { tribeId: tribe.id, isAiHost: false },
      select: { id: true, rosterId: true },
    })
    for (const ex of existing) {
      if (!currentRosterIds.has(ex.rosterId)) {
        await prisma.survivorTribeChatMember.deleteMany({ where: { id: ex.id } })
      }
    }
    for (const rosterId of currentRosterIds) {
      await prisma.survivorTribeChatMember.upsert({
        where: {
          uniq_tribe_roster: { tribeId: tribe.id, rosterId },
        },
        create: { tribeId: tribe.id, rosterId, isAiHost: false },
        update: {},
      })
    }
    await syncChannelMembersForTribe(leagueId, tribe.id, [...currentRosterIds])
  }
  await appendSurvivorAudit(leagueId, config.configId, 'chat_membership_updated', { action: 'sync_after_shuffle' })
  return { ok: true }
}

export async function clearTribeChatMembersAfterMerge(leagueId: string): Promise<{ ok: boolean; error?: string }> {
  const config = await getSurvivorConfig(leagueId)
  if (!config) return { ok: false, error: 'Not a Survivor league' }

  await prisma.survivorTribeChatMember.deleteMany({
    where: {
      tribe: { configId: config.configId },
    },
  })

  await appendSurvivorAudit(leagueId, config.configId, 'chat_membership_updated', {
    action: 'clear_after_merge',
  })
  return { ok: true }
}
