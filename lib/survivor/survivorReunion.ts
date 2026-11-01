import 'server-only'

import { prisma } from '@/lib/prisma'
import { createSurvivorChatMessage } from './survivorChatBridge'
import { readSurvivorFinaleSettings } from './survivorFinaleSettings'

/**
 * The reunion (original league, gap report §6 #61): "We will open the chat room for everyone to
 * come back in and party at the reunion." Once a champion is crowned, the Island Chat (the Survivor
 * `league` channel, mirrored into league chat) reopens to every manager in the league — voted-out,
 * jury and finalists alike. Commissioner toggle `reunionChatEnabled` (default on); it can only take
 * effect after the finale, so no running season changes.
 */

/** Pure: is the reunion open? Only after a champion is crowned, and only when the commissioner allows it. */
export function isReunionOpen(input: { reunionChatEnabled: boolean; crowned: boolean }): boolean {
  return input.reunionChatEnabled && input.crowned
}

export function reunionAnnouncement(language: string | null | undefined, winnerName: string): string {
  return String(language ?? '').toLowerCase().startsWith('es')
    ? `¡Bienvenidos a la reunión! ${winnerName} es el último en pie. El chat de la isla está abierto otra vez para todos: los eliminados, el jurado y los finalistas.`
    : `Welcome to the reunion! ${winnerName} is the last one standing. Island Chat is open to everyone again: voted-out managers, the jury and the finalists.`
}

/** Server: whether the reunion is open for this league right now. Never throws. */
export async function loadReunionOpen(leagueId: string): Promise<boolean> {
  try {
    const [league, session] = await Promise.all([
      prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } }),
      prisma.jurySession.findUnique({ where: { leagueId }, select: { winnerId: true } }),
    ])
    return isReunionOpen({ reunionChatEnabled: readSurvivorFinaleSettings(league?.settings).reunionChatEnabled, crowned: Boolean(session?.winnerId) })
  } catch {
    return false
  }
}

/**
 * Open the reunion once: every Survivor manager back in the Island Chat channel and one welcome
 * line. Idempotent through a deterministic audit id, best-effort for the caller.
 */
export async function openReunionChatOnce(leagueId: string, winnerName: string): Promise<'opened' | 'already_open' | 'disabled' | 'no_channel'> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, language: true } })
  if (!readSurvivorFinaleSettings(league?.settings).reunionChatEnabled) return 'disabled'
  const auditId = `survivor-reunion:${leagueId}`
  if (await prisma.survivorAuditEntry.findUnique({ where: { id: auditId }, select: { id: true } })) return 'already_open'
  const channel = await prisma.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true, memberUserIds: true } })
  if (!channel) return 'no_channel'
  const players = await prisma.survivorPlayer.findMany({ where: { leagueId }, select: { userId: true } })
  const members = [...new Set([...channel.memberUserIds, ...players.map((p) => p.userId)])]
  if (members.length !== channel.memberUserIds.length) {
    await prisma.survivorChatChannel.update({ where: { id: channel.id }, data: { memberUserIds: members } })
  }
  try {
    await prisma.survivorAuditEntry.create({ data: { id: auditId, leagueId, category: 'chat', action: 'reunion_opened', data: { memberCount: members.length }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
  } catch {
    return 'already_open' // a concurrent tick won the race; it posts the welcome
  }
  await createSurvivorChatMessage(prisma, { data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
    contentType: 'host_announcement', content: reunionAnnouncement(league?.language, winnerName) } })
  return 'opened'
}
