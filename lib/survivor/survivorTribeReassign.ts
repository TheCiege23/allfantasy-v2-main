import 'server-only'

import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'
import { provisionSurvivorChats } from './survivorTribeChatProvisioning'
import { createSurvivorChatMessage } from './survivorChatBridge'
import { getTribesWithMembers } from './SurvivorTribeService'

export type ReassignTribeMemberOutcome =
  | { ok: true; userId: string; fromTribeId: string | null; toTribeId: string; tribes: Awaited<ReturnType<typeof getTribesWithMembers>> }
  | { ok: false; status: 403 | 404 | 409; error: string }

const OPEN_PHASES = new Set(['pre_merge', 'active', 'tribe', 'post_swap'])

/**
 * Move one active manager to another tribe by hand, between councils, before the merge.
 *
 * Only a non-participating host may do this: a playing commissioner choosing teammates is the
 * fairness hole the random redraw exists to close. Tribe membership, the legacy tribe-chat rows,
 * the player's tribe and the huddle channels move together in one setup transaction, and Chimmy
 * announces the move in league chat. Idols and Exile tokens are bound to the manager, so nothing
 * about them changes.
 */
export async function reassignSurvivorTribeMember(
  leagueId: string,
  input: { userId: string; toTribeId: string; actorUserId: string },
): Promise<ReassignTribeMemberOutcome> {
  const result = await withSurvivorSetupTransaction(leagueId, async (db): Promise<Exclude<ReassignTribeMemberOutcome, { ok: true }> | { ok: true; userId: string; fromTribeId: string | null; toTribeId: string }> => {
    const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (!league) return { ok: false, status: 404, error: 'League not found.' }
    const settings = normalizeSurvivorFoundationSettings(league.settings && typeof league.settings === 'object' ? league.settings as Record<string, unknown> : {})
    if (settings.commissionerParticipationMode !== 'non_participating_host') {
      return { ok: false, status: 403, error: 'A playing commissioner cannot move managers between tribes. Use the random redraw.' }
    }
    const game = await db.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, activeCouncilId: true, currentWeek: true } })
    if (!game || !OPEN_PHASES.has(game.phase) || game.activeCouncilId) {
      return { ok: false, status: 409, error: 'Managers can move only between councils, before the merge.' }
    }
    const player = await db.survivorPlayer.findUnique({
      where: { leagueId_userId: { leagueId, userId: input.userId } },
      select: { id: true, displayName: true, playerState: true, redraftRosterId: true, tribeId: true },
    })
    if (!player || player.playerState !== 'active' || !player.redraftRosterId) {
      return { ok: false, status: 404, error: 'Active manager with a linked roster not found.' }
    }
    const target = await db.survivorTribe.findFirst({ where: { id: input.toTribeId, leagueId, isActive: true, isMerged: false }, select: { id: true, name: true } })
    if (!target) return { ok: false, status: 404, error: 'Target tribe not found.' }
    if (player.tribeId === target.id) return { ok: false, status: 409, error: `${player.displayName} is already on ${target.name}.` }

    const fromTribeId = player.tribeId
    const rosterId = player.redraftRosterId
    await db.survivorTribeMember.deleteMany({ where: { rosterId, tribe: { leagueId } } })
    await db.survivorTribeMember.create({ data: { tribeId: target.id, rosterId, isLeader: false } })
    await db.survivorTribeChatMember.deleteMany({ where: { rosterId, isAiHost: false, tribe: { leagueId } } })
    await db.survivorTribeChatMember.create({ data: { tribeId: target.id, rosterId, isAiHost: false } })
    await db.survivorPlayer.update({ where: { id: player.id }, data: { tribeId: target.id, canAccessTribeChat: true } })
    // Refreshes every huddle's member list from the players' tribes: out of the old one, into the new.
    const chats = await provisionSurvivorChats(leagueId, { db, actorUserId: input.actorUserId })
    await createSurvivorChatMessage(db, { data: { leagueId, channelId: chats.leagueChannelId, channelType: 'league',
      senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
      contentType: 'host_announcement', content: `${player.displayName} now sits with ${target.name}. Open the Tribe Board to see the new lineup.` } })
    await db.survivorAuditEntry.create({ data: {
      leagueId, week: game.currentWeek, category: 'tribe', action: 'tribe_member_reassigned',
      actorUserId: input.actorUserId, targetUserId: input.userId, relatedEntityId: target.id, relatedEntityType: 'survivor_tribe',
      data: { fromTribeId, toTribeId: target.id, rosterId }, isVisibleToCommissioner: true, isVisibleToPublic: true,
    } })
    return { ok: true, userId: input.userId, fromTribeId, toTribeId: target.id }
  })
  if (!result.ok) return result
  return { ...result, tribes: await getTribesWithMembers(leagueId) }
}
