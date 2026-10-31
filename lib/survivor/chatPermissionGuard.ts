import { prisma } from '@/lib/prisma'
import { logSurvivorAuditEntry } from '@/lib/survivor/auditEntry'
import { loadReunionOpen } from '@/lib/survivor/survivorReunion'

export async function canSendToChannel(
  leagueId: string,
  userId: string,
  channelId: string,
  opts?: { senderIsHost?: boolean },
): Promise<{ allowed: boolean; reason?: string }> {
  const player = await prisma.survivorPlayer.findFirst({
    where: { leagueId, userId },
  })
  const channel = await prisma.survivorChatChannel.findFirst({
    where: { id: channelId, leagueId },
  })
  if (!channel) return { allowed: false, reason: 'channel_not_found' }
  if (channel.isArchived) return { allowed: false, reason: 'channel_archived' }

  const isMember = channel.memberUserIds.includes(userId)
  if (!isMember) return { allowed: false, reason: 'not_a_member' }

  const type = channel.channelType
  const state = player?.playerState ?? 'unknown'

  if (type === 'tribe') {
    if (state !== 'active' || player?.canAccessTribeChat === false) {
      await logDeny(leagueId, userId, 'tribe_access_revoked')
      return { allowed: false, reason: 'tribe_access_revoked' }
    }
  } else if (type === 'merge') {
    if (player?.canAccessMergeChat === false) {
      await logDeny(leagueId, userId, 'merge_access_revoked')
      return { allowed: false, reason: 'merge_access_revoked' }
    }
    if (state === 'eliminated' || state === 'exile') {
      await logDeny(leagueId, userId, 'merge_access_revoked')
      return { allowed: false, reason: 'merge_access_revoked' }
    }
    if (state !== 'active' && !player?.hasImmunityThisWeek) {
      await logDeny(leagueId, userId, 'merge_access_revoked')
      return { allowed: false, reason: 'merge_access_revoked' }
    }
  } else if (type === 'alliance') {
    if (state === 'eliminated' || state === 'exile') {
      await logDeny(leagueId, userId, 'alliance_access_revoked')
      return { allowed: false, reason: 'alliance_access_revoked' }
    }
    if (state !== 'active' && !player?.hasImmunityThisWeek) {
      await logDeny(leagueId, userId, 'alliance_access_revoked')
      return { allowed: false, reason: 'alliance_access_revoked' }
    }
  } else if (type === 'exile') {
    if (opts?.senderIsHost) return { allowed: true }
    if (state !== 'exile' || player?.canAccessExileChat === false) {
      await logDeny(leagueId, userId, 'exile_access_revoked')
      return { allowed: false, reason: 'exile_access_revoked' }
    }
  } else if (type === 'jury') {
    if (!player?.isJuryMember || player.canAccessJuryChat === false) {
      await logDeny(leagueId, userId, 'jury_access_revoked')
      return { allowed: false, reason: 'jury_access_revoked' }
    }
  } else if (type === 'finale') {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { survivorPhase: true },
    })
    if (league?.survivorPhase !== 'finale' || (!player?.isFinalist && !player?.isJuryMember)) {
      await logDeny(leagueId, userId, 'finale_access_revoked')
      return { allowed: false, reason: 'finale_access_revoked' }
    }
  } else if (type === 'league') {
    // The reunion: after the finale the Island Chat reopens to everyone (commissioner toggle).
    if (state === 'eliminated' && !(await loadReunionOpen(leagueId))) {
      await logDeny(leagueId, userId, 'eliminated_read_only')
      return { allowed: false, reason: 'eliminated_read_only' }
    }
  }

  return { allowed: true }
}

async function logDeny(leagueId: string, userId: string, reason: string): Promise<void> {
  await logSurvivorAuditEntry({
    leagueId,
    category: 'chat',
    action: 'CHAT_SEND_DENIED',
    actorUserId: userId,
    data: { reason },
    isVisibleToCommissioner: true,
    isVisibleToPublic: false,
  })
}

export async function revokeAllTribeAccess(leagueId: string, userId: string): Promise<void> {
  await prisma.survivorPlayer.updateMany({
    where: { leagueId, userId },
    data: { canAccessTribeChat: false, canAccessMergeChat: false },
  })
  const channels = await prisma.survivorChatChannel.findMany({
    where: { leagueId, channelType: { in: ['tribe', 'merge'] } },
  })
  for (const ch of channels) {
    const next = ch.memberUserIds.filter((id) => id !== userId)
    if (next.length !== ch.memberUserIds.length) {
      await prisma.survivorChatChannel.update({
        where: { id: ch.id },
        data: { memberUserIds: next },
      })
    }
  }
  await logSurvivorAuditEntry({
    leagueId,
    category: 'chat',
    action: 'TRIBE_ACCESS_REVOKED',
    targetUserId: userId,
    data: { userId },
    isVisibleToCommissioner: true,
  })
}

export async function grantExileAccess(leagueId: string, userId: string): Promise<void> {
  await prisma.survivorPlayer.updateMany({
    where: { leagueId, userId },
    data: { canAccessExileChat: true },
  })
  const exileCh = await prisma.survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'exile' },
  })
  if (exileCh && !exileCh.memberUserIds.includes(userId)) {
    await prisma.survivorChatChannel.update({
      where: { id: exileCh.id },
      data: { memberUserIds: [...exileCh.memberUserIds, userId] },
    })
  }
  await logSurvivorAuditEntry({
    leagueId,
    category: 'chat',
    action: 'EXILE_CHAT_GRANTED',
    targetUserId: userId,
    data: { userId },
    isVisibleToCommissioner: true,
  })
}

export async function grantJuryAccess(leagueId: string, userId: string): Promise<void> {
  await prisma.survivorPlayer.updateMany({
    where: { leagueId, userId },
    data: { canAccessJuryChat: true, isJuryMember: true },
  })
  const juryCh = await prisma.survivorChatChannel.findFirst({
    where: { leagueId, channelType: 'jury' },
  })
  if (juryCh && !juryCh.memberUserIds.includes(userId)) {
    await prisma.survivorChatChannel.update({
      where: { id: juryCh.id },
      data: { memberUserIds: [...juryCh.memberUserIds, userId] },
    })
  }
  await logSurvivorAuditEntry({
    leagueId,
    category: 'chat',
    action: 'JURY_CHAT_GRANTED',
    targetUserId: userId,
    data: { userId },
    isVisibleToCommissioner: true,
  })
}
