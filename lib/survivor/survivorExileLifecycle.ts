import 'server-only'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { normalizeSurvivorFoundationSettings } from './survivorSettings'
import { afterExileReturnResolved } from './shareCards/hooks'

export interface ExileReturnCandidate {
  userId: string; tokenBalance: number; totalTokensEarned: number; eliminatedWeek: number | null
}

/** Public, stable tiebreaks: current tokens, lifetime tokens, longest stay, then manager id. */
export function selectExileReturnCandidate(players: ExileReturnCandidate[], tokensRequired: number): ExileReturnCandidate | null {
  return [...players].filter(p => p.tokenBalance >= tokensRequired).sort((a, b) =>
    b.tokenBalance - a.tokenBalance || b.totalTokensEarned - a.totalTokensEarned ||
    (a.eliminatedWeek ?? Infinity) - (b.eliminatedWeek ?? Infinity) || a.userId.localeCompare(b.userId)
  )[0] ?? null
}

/** One scheduled return per season. Called only after the return week's results are final. */
export async function resolveScheduledExileReturn(leagueId: string, completedWeek: number): Promise<string | null> {
  if (!Number.isInteger(completedWeek) || completedWeek < 1) return null
  const winnerUserId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { platform: true, settings: true } })
    if (!league || !isNativePlatform(league.platform)) return null
    const settings = normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null)
    if (!settings.exileIslandEnabled || completedWeek < settings.exileReturnWeek) return null
    const previous = await tx.survivorAuditEntry.findFirst({ where: { leagueId, action: 'scheduled_exile_return_resolved' }, select: { id: true } })
    if (previous) return null
    // Never inject a returned manager into an open ballot or after the finale starts.
    const game = await tx.survivorGameState.findUnique({ where: { leagueId } })
    if (!game || ['finale', 'complete'].includes(game.phase) || game.activeCouncilId) return null
    const players = await tx.survivorPlayer.findMany({ where: { leagueId, playerState: 'exile', eliminatedWeek: { lt: settings.exileReturnWeek } } })
    const finalized = await tx.survivorAuditEntry.findFirst({ where: { leagueId, week: settings.exileReturnWeek, action: 'exile_week_scored' }, select: { id: true, data: true } })
    const recorded = finalized?.data as { balances?: ExileReturnCandidate[] } | null
    if (players.length && !Array.isArray(recorded?.balances)) return null
    // Retry in a later week uses the deadline snapshot, never tokens earned after the cutoff.
    const winner = selectExileReturnCandidate((recorded?.balances ?? []).filter(row => players.some(player => player.userId === row.userId)), settings.exileReturnTokens)
    if (winner) {
      const player = players.find(p => p.userId === winner.userId)!
      if (player.tokenBalance < settings.exileReturnTokens) throw new Error('The deadline winner’s token balance changed before settlement; review the token ledger before retrying.')
      const roster = player.redraftRosterId ? await tx.roster.findFirst({ where: { id: player.redraftRosterId, leagueId }, select: { id: true, redraftRosterId: true } }) : null
      if (!roster) throw new Error('Exile return requires the manager’s main-island roster link.')
      if (roster.redraftRosterId) {
        const actual = await tx.redraftRoster.findFirst({ where: { id: roster.redraftRosterId, leagueId }, select: { id: true } })
        if (!actual) throw new Error('Exile return requires a valid season roster link.')
        await tx.redraftRoster.update({ where: { id: actual.id }, data: { isEliminated: false } })
      }
      const merged = Boolean(game.mergeTriggeredAt) || ['merge', 'post_merge', 'jury'].includes(game.phase)
      const tribe = merged ? null : await tx.survivorTribe.findFirst({ where: { leagueId, isActive: true, isMerged: false }, orderBy: { slotIndex: 'asc' }, select: { id: true } })
      if (!merged && !tribe) throw new Error('An active tribe is required for a pre-merge Exile return.')
      await tx.survivorPlayer.update({ where: { id: player.id }, data: {
        playerState: 'active', eliminatedWeek: null, tribeId: tribe?.id ?? null,
        canAccessTribeChat: !merged, canAccessMergeChat: merged, canAccessExileChat: false,
        canAccessJuryChat: false, isJuryMember: false, exileReturnEligible: false,
        tokenBalance: { decrement: settings.exileReturnTokens },
      } })
      await tx.survivorJuryMember.deleteMany({ where: { leagueId, rosterId: roster.id } })
      if (tribe) await tx.survivorTribeMember.upsert({ where: { tribeId_rosterId: { tribeId: tribe.id, rosterId: roster.id } }, create: { tribeId: tribe.id, rosterId: roster.id }, update: {} })
      const channels = await tx.survivorChatChannel.findMany({ where: { leagueId, isArchived: false, channelType: { in: ['exile', 'jury', 'tribe', 'merge'] } }, select: { id: true, channelType: true, tribeId: true, memberUserIds: true, readOnlyUserIds: true } })
      for (const channel of channels) {
        const joins = merged ? channel.channelType === 'merge' : channel.channelType === 'tribe' && channel.tribeId === tribe?.id
        const members = channel.memberUserIds.filter(id => id !== player.userId)
        if (joins) members.push(player.userId)
        await tx.survivorChatChannel.update({ where: { id: channel.id }, data: { memberUserIds: members, readOnlyUserIds: channel.readOnlyUserIds.filter(id => id !== player.userId) } })
      }
      await tx.survivorGameState.update({ where: { leagueId }, data: { activePlayerCount: { increment: 1 }, exilePlayerCount: { decrement: 1 } } })
      // The old roster remains released. The returning manager rebuilds through normal waivers.
      await tx.survivorAuditEntry.create({ data: { leagueId, week: settings.exileReturnWeek, category: 'exile', action: 'return_to_island', targetUserId: player.userId,
        relatedEntityId: roster.id, relatedEntityType: 'roster', data: { tokensSpent: settings.exileReturnTokens, rosterRebuild: 'waivers' }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    }
    await tx.survivorPlayer.updateMany({ where: { leagueId, playerState: 'exile' }, data: { exileReturnEligible: false } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week: settings.exileReturnWeek, category: 'exile', action: 'scheduled_exile_return_resolved',
      targetUserId: winner?.userId ?? null, data: { winnerUserId: winner?.userId ?? null, tokensRequired: settings.exileReturnTokens, completedWeek }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    const channel = await tx.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
    if (channel) await tx.survivorChatMessage.create({ data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true, contentType: 'host_announcement',
      content: winner ? `Exile return results: ${players.find(p => p.userId === winner.userId)?.displayName ?? 'A manager'} earned a return to the main island. Their roster can now be rebuilt through waivers.` : 'The Exile return deadline has passed. No manager reached the required token balance.' } })
    return winner?.userId ?? null
  }, { timeout: 30_000, maxWait: 10_000 })
  // Share cards: the returning manager's "back from Exile" card.
  if (winnerUserId) afterExileReturnResolved(leagueId)
  return winnerUserId
}
