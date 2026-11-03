import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { readSurvivorGovernanceSettings } from './survivorGovernanceSettings'
import { validateAllianceRequest, type AllianceRequestResult } from './survivorAlliancePolicy'
import { governanceCopy } from './survivorGovernanceCopy'
import { createSurvivorChatMessage } from './survivorChatBridge'

/**
 * Alliance chats: castaways create private `alliance` channels (SurvivorChatChannel, which already
 * carries the type, its members and its read-only members — no schema change). Reading and posting
 * then follow the existing guards: members only; an eliminated or exiled member cannot post.
 *
 * Host visibility: by default an alliance is members-only, like any private channel. With the
 * commissioner's "host can read alliances" switch on, a NON-playing host is added as a read-only
 * member (in `memberUserIds` so they can read, in `readOnlyUserIds`, and the send guard refuses them
 * because they hold no active player row). A playing commissioner is never added: they are a castaway.
 */

const ALLIANCE = 'alliance'
const MERGED_PHASES = new Set(['merge', 'merging', 'post_merge', 'jury', 'finale', 'complete'])

async function nonPlayingHostIds(leagueId: string, league: { userId: string; settings: unknown }): Promise<string[]> {
  const settings = normalizeSurvivorFoundationSettings(league.settings && typeof league.settings === 'object' ? league.settings as Record<string, unknown> : {})
  if (settings.commissionerParticipationMode !== 'non_participating_host') return []
  const plays = await prisma.survivorPlayer.findFirst({ where: { leagueId, userId: league.userId, playerState: { notIn: ['host', 'non_participating_host', 'spectator', 'viewer'] } }, select: { id: true } })
  const owns = await prisma.roster.findFirst({ where: { leagueId, platformUserId: league.userId }, select: { id: true } })
  return plays || owns ? [] : [league.userId]
}

export type CreateAllianceResult =
  | { ok: true; channelId: string; name: string; memberUserIds: string[] }
  | Extract<AllianceRequestResult, { ok: false }>
  | { ok: false; code: 'not_found'; error: string }

export async function createSurvivorAlliance(
  leagueId: string,
  creatorUserId: string,
  input: { name: string; memberUserIds: string[] },
): Promise<CreateAllianceResult> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, settings: true, language: true, survivorMode: true } })
  if (!league?.survivorMode) return { ok: false, code: 'not_found', error: 'This is not a Survivor league.' }
  const settings = readSurvivorGovernanceSettings(league.settings)
  const [cast, game, open] = await Promise.all([
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true, playerState: true, tribeId: true } }),
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true } }),
    prisma.survivorChatChannel.findMany({ where: { leagueId, channelType: ALLIANCE, isArchived: false, memberUserIds: { has: creatorUserId } }, select: { memberUserIds: true, readOnlyUserIds: true } }),
  ])
  const creator = cast.find((c) => c.userId === creatorUserId) ?? null
  const verdict = validateAllianceRequest({
    settings,
    creator,
    requestedUserIds: input.memberUserIds,
    cast,
    name: input.name,
    merged: Boolean(game?.mergeTriggeredAt) || MERGED_PHASES.has(String(game?.phase ?? '')),
    existingMemberSets: open.map((c) => c.memberUserIds.filter((id) => !c.readOnlyUserIds.includes(id))),
  })
  if (!verdict.ok) return verdict
  const hosts = settings.allianceHostCanRead ? await nonPlayingHostIds(leagueId, league) : []
  const channel = await prisma.survivorChatChannel.create({
    data: { leagueId, name: verdict.name, channelType: ALLIANCE, memberUserIds: [...verdict.memberUserIds, ...hosts], readOnlyUserIds: hosts },
    select: { id: true },
  })
  // No member list in the audit: who is allied with whom stays between the members.
  await prisma.survivorAuditEntry.create({
    data: { leagueId, category: 'chat', action: 'alliance_created', actorUserId: creatorUserId, relatedEntityId: channel.id, relatedEntityType: 'survivor_chat_channel',
      data: { memberCount: verdict.memberUserIds.length, hostCanRead: hosts.length > 0 }, isVisibleToCommissioner: hosts.length > 0, isVisibleToPublic: false },
  })
  const creatorName = creator?.displayName ?? 'A castaway'
  await createSurvivorChatMessage(prisma, { data: { leagueId, channelId: channel.id, channelType: ALLIANCE,
    senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, contentType: 'host_announcement',
    content: governanceCopy(league.language).allianceCreated(verdict.name, creatorName) } }).catch(() => {})
  return { ok: true, channelId: channel.id, name: verdict.name, memberUserIds: verdict.memberUserIds }
}

export async function leaveSurvivorAlliance(leagueId: string, userId: string, channelId: string): Promise<{ ok: true; archived: boolean } | { ok: false; status: 404; error: string }> {
  const channel = await prisma.survivorChatChannel.findFirst({ where: { id: channelId, leagueId, channelType: ALLIANCE, isArchived: false }, select: { id: true, memberUserIds: true, readOnlyUserIds: true } })
  if (!channel || !channel.memberUserIds.includes(userId) || channel.readOnlyUserIds.includes(userId)) return { ok: false, status: 404, error: 'You are not in that alliance.' }
  const members = channel.memberUserIds.filter((id) => id !== userId)
  const castawaysLeft = members.filter((id) => !channel.readOnlyUserIds.includes(id))
  // An alliance of one is not an alliance: it closes.
  const archived = castawaysLeft.length < 2
  await prisma.survivorChatChannel.update({ where: { id: channel.id }, data: archived ? { memberUserIds: members, isArchived: true, archivedAt: new Date() } : { memberUserIds: members } })
  return { ok: true, archived }
}

export async function listSurvivorAlliances(leagueId: string, userId: string) {
  const [channels, cast] = await Promise.all([
    prisma.survivorChatChannel.findMany({ where: { leagueId, channelType: ALLIANCE, isArchived: false, memberUserIds: { has: userId } }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, memberUserIds: true, readOnlyUserIds: true } }),
    prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true, displayName: true, playerState: true } }),
  ])
  return channels.map((c) => ({
    channelId: c.id,
    name: c.name,
    hostReads: c.readOnlyUserIds.length > 0,
    readOnly: c.readOnlyUserIds.includes(userId),
    members: c.memberUserIds.filter((id) => !c.readOnlyUserIds.includes(id)).map((id) => {
      const p = cast.find((x) => x.userId === id)
      return { userId: id, displayName: p?.displayName ?? 'Castaway', canPost: p?.playerState === 'active' }
    }),
  }))
}
