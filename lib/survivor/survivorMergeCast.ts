import 'server-only'

import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'

/**
 * MERGE CAST — moves every active manager into one tribe with one chat, in a single transaction.
 * The legacy merge (tribeEngine.executeMerge) only rewrites SurvivorTribeMember rows; this updates
 * the canonical SurvivorPlayer state and chat channels that councils, access checks and the Exile
 * return read. Idempotent: running it again only re-syncs membership.
 */
export async function applySurvivorMergeCast(leagueId: string, week: number): Promise<{ mergeChannelId: string; members: number }> {
  return withSurvivorSetupTransaction(leagueId, async db => {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true } })
    const settings = normalizeSurvivorFoundationSettings(league?.settings && typeof league.settings === 'object' ? league.settings as Record<string, unknown> : {})
    const merged = await db.survivorTribe.findFirst({ where: { leagueId, isMerged: true }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true } })
    const active = await db.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { id: true, userId: true } })
    for (const player of active) {
      await db.survivorPlayer.update({ where: { id: player.id }, data: { canAccessMergeChat: true, canAccessTribeChat: false, ...(merged ? { tribeId: merged.id } : {}) } })
    }
    const hostIsPlaying = Boolean(league?.userId && active.some(player => player.userId === league.userId))
    const hosts = league?.userId && settings.commissionerParticipationMode === 'non_participating_host' && !hostIsPlaying ? [league.userId] : []
    const members = Array.from(new Set([...active.map(player => player.userId), ...hosts]))
    let channel = await db.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'merge', isArchived: false }, select: { id: true } })
    const created = !channel
    if (channel) await db.survivorChatChannel.update({ where: { id: channel.id }, data: { memberUserIds: members } })
    else channel = await db.survivorChatChannel.create({ data: { leagueId, channelType: 'merge', name: merged?.name ?? 'Merged Tribe', tribeId: merged?.id ?? null, memberUserIds: members }, select: { id: true } })
    // Old tribe huddles are closed; their history stays readable by the commissioner tools.
    await db.survivorChatChannel.updateMany({ where: { leagueId, channelType: 'tribe', isArchived: false }, data: { isArchived: true, archivedAt: new Date() } })
    if (created) {
      await db.survivorChatMessage.create({ data: { leagueId, channelId: channel.id, channelType: 'merge', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
        contentType: 'host_announcement', content: `Welcome to the merge. ${active.length} managers remain, and from here on it's every manager for themselves. The top weekly score wins individual immunity, and everyone voted out from now on joins the jury.` } })
      await db.survivorAuditEntry.create({ data: { leagueId, week, category: 'tribe', action: 'merge_cast_applied', data: { members: active.length, mergeChannelId: channel.id }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    }
    return { mergeChannelId: channel.id, members: active.length }
  })
}
