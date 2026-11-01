import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from './normalizeSurvivorSettings'
import { clearReleasedRosterData } from '@/lib/guillotine/GuillotineRosterReleaseEngine'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import { movePlayerBoundIdolsInTransaction } from './playerBoundIdolTransfer'
import { maybeTriggerSurvivorTribeShuffleRecommendation } from './SurvivorSitOutEngine'
import { isCouncilReadComplete } from './survivorRevealGate'
import { removeRosterFromTribeChat } from './SurvivorChatMembershipService'

const JURY_PHASES = new Set(['merge', 'post_merge', 'jury', 'finale'])

export type EliminationOutcome =
  | { ok: true; alreadyResolved: boolean; outcome: 'removed_to_waivers' | 'exile_island'; eliminatedUserId: string; eliminatedRosterId?: string; removedFromChats: number; pendingRelease: boolean; pendingExile: boolean; releasedPlayerCount?: number }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }

/** Resolve exactly once. Roster release, cast state, chat membership, and audit commit together. */
export async function resolveElimination(leagueId: string, councilId: string, actorUserId?: string): Promise<EliminationOutcome> {
  const result = await prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<EliminationOutcome> => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const council = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId } })
    if (!council) return { ok: false, status: 404, code: 'not_found', error: 'Council not found.' }
    if (council.status === 'tie_pending' || council.isTie) return { ok: false, status: 409, code: 'tie_unresolved', error: 'Resolve the tied council before elimination.' }
    if (!council.isRevealed) return { ok: false, status: 409, code: 'not_revealed', error: 'Reveal the votes before resolving elimination.' }
    if (!council.eliminatedUserId) return { ok: false, status: 409, code: 'no_eliminated', error: 'No eliminated player on this council.' }
    const userId = council.eliminatedUserId
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true, platform: true, survivorRevealMode: true } })
    if (!league || !isNativePlatform(league.platform)) return { ok: false, status: 409, code: 'not_native', error: 'Roster elimination is available only for leagues hosted on AllFantasy.' }
    // The torch goes out only after the last ballot has been read; until then nobody is named anywhere.
    if (!isCouncilReadComplete(council, league.survivorRevealMode)) return { ok: false, status: 409, code: 'read_in_progress', error: 'The votes are still being read.' }
    return eliminateCastawayInTransaction(tx, {
      leagueId, userId, week: council.week, phase: council.phase, settingsJson: league.settings,
      relatedEntityId: councilId, relatedEntityType: 'council', actorUserId,
      notice: { title: 'The tribe has spoken', body: `Week ${council.week}: a manager was voted out at Tribal Council.`, deepLinkPath: `/survivor/${leagueId}/tribal` },
    })
  }, { timeout: 30_000, maxWait: 10_000 })
  if (result.ok && !result.alreadyResolved) {
    await afterEliminationCommitted(leagueId, result)
    const council = await prisma.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId }, select: { week: true, phase: true } })
    if (council?.phase === 'pre_merge') {
      await maybeTriggerSurvivorTribeShuffleRecommendation(leagueId, council.week).catch(() => {
        console.warn('[Survivor] Tribe redraw recommendation could not be queued.')
      })
    }
  }
  return result
}

/** The legacy tribe-chat membership rows drop the roster too, after the elimination commits. */
async function afterEliminationCommitted(leagueId: string, result: Extract<EliminationOutcome, { ok: true }>): Promise<void> {
  // The thread guard no longer reads them (survivorTribeChatAccess.ts), but SurvivorTribalCouncilService still does.
  if (result.eliminatedRosterId) {
    await removeRosterFromTribeChat(leagueId, result.eliminatedRosterId).catch(() => {
      console.warn('[Survivor] Legacy tribe-chat membership could not be updated after elimination.')
    })
  }
}

export interface EliminateCastawayInput {
  leagueId: string
  userId: string
  week: number
  /** The phase the elimination happens in (the council's, or the game's for a finale step). */
  phase: string
  settingsJson: unknown
  /** What eliminated them: the council id, or a final-jury-step key. Also the rerun gate. */
  relatedEntityId: string
  relatedEntityType: 'council' | 'final_jury_step'
  actorUserId?: string | null
  /** The spoiler-safe push/email notice. */
  notice: { title: string; body: string; deepLinkPath: string }
}

/**
 * One castaway leaves the game, inside the caller's transaction (which must already hold the
 * `survivor-setup:<leagueId>` advisory lock): the league's elimination outcome (roster released to
 * waivers, or Exile Island when it is on), cast state, the jury after the merge, chat membership and
 * audit. Shared by Tribal Council (resolveElimination) and the final jury step, so both follow the
 * same rules. Idempotent on `relatedEntityId`: a second call reports `alreadyResolved`.
 */
export async function eliminateCastawayInTransaction(tx: Prisma.TransactionClient, input: EliminateCastawayInput): Promise<EliminationOutcome> {
    const { leagueId, userId, actorUserId } = input
    const councilId = input.relatedEntityId
    const council = { week: input.week, phase: input.phase }
    const settings = normalizeSurvivorFoundationSettings(input.settingsJson && typeof input.settingsJson === 'object' ? input.settingsJson as Record<string, unknown> : {})
    let outcome = settings.exileIslandEnabled ? 'exile_island' as const : 'removed_to_waivers' as const
    const previous = await tx.survivorAuditEntry.findFirst({ where: { leagueId, action: 'player_eliminated', relatedEntityId: councilId }, select: { id: true, data: true } })
    const previousData = previous?.data as Record<string, unknown> | null
    const resumeRelease = previousData?.pendingRelease === true && previousData?.outcome === 'removed_to_waivers'
    if (previous && !resumeRelease) {
      const data = previousData
      return { ok: true, alreadyResolved: true, outcome: data?.outcome === 'exile_island' ? 'exile_island' : 'removed_to_waivers', eliminatedUserId: userId, removedFromChats: 0,
        pendingRelease: data?.pendingRelease === true, pendingExile: data?.pendingExile === true }
    }
    const player = await tx.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } } })
    if (!player) return { ok: false, status: 404, code: 'player_not_found', error: 'Eliminated player record not found.' }
    if (player.playerState !== 'active' && !(resumeRelease && player.playerState === 'eliminated')) return { ok: false, status: 409, code: 'player_not_active', error: 'This player is no longer active. Review the existing elimination before retrying.' }
    // This field stores the legacy Roster id. Never feed it directly to RedraftRosterPlayer.
    const roster = player.redraftRosterId ? await tx.roster.findFirst({ where: { leagueId, id: player.redraftRosterId }, select: { id: true, playerData: true, redraftRosterId: true } }) : null
    if (!roster) return { ok: false, status: 409, code: 'roster_missing', error: 'Link this manager to their league roster before resolving elimination.' }
    if (resumeRelease) outcome = 'removed_to_waivers'
    const now = new Date()
    let releasedPlayerCount = 0
    { // Every voted-out roster is released; Exile is a separate competition.
      const released = new Set(getRosterPlayerIds(roster.playerData))
      if (roster.redraftRosterId) {
        const actual = await tx.redraftRoster.findFirst({ where: { id: roster.redraftRosterId, leagueId }, select: { id: true, seasonId: true, season: { select: { season: true } } } })
        if (!actual) return { ok: false, status: 409, code: 'roster_bridge_invalid', error: 'Repair this manager’s season roster link before resolving elimination.' }
        const players = await tx.redraftRosterPlayer.findMany({ where: { rosterId: actual.id, droppedAt: null }, select: { playerId: true } })
        for (const p of players) released.add(p.playerId)
        await tx.redraftRosterPlayer.updateMany({ where: { rosterId: actual.id, droppedAt: null }, data: { droppedAt: now, isLocked: false } })
        for (const p of players) await movePlayerBoundIdolsInTransaction(tx, {
          leagueId, playerId: p.playerId, fromRedraftRosterId: actual.id,
          toRedraftRosterId: null, reason: 'waiver_drop',
        })
        await tx.redraftRoster.update({ where: { id: actual.id }, data: { isEliminated: true } })
        await tx.redraftRosterMoveHistory.create({ data: { leagueId, rosterId: actual.id, seasonId: actual.seasonId, season: actual.season.season, week: council.week,
          actorUserId: actorUserId ?? null, source: 'survivor:elimination', moveSummary: 'Roster released after Elimination Council', metadata: { councilId, releasedPlayerIds: [...released] } } })
      }
      await tx.roster.update({ where: { id: roster.id }, data: { playerData: (Array.isArray(roster.playerData) ? [] : clearReleasedRosterData(roster.playerData)) as Prisma.InputJsonValue } })
      await tx.waiverClaim.updateMany({ where: { leagueId, rosterId: roster.id, status: 'pending' }, data: { status: 'cancelled' } })
      releasedPlayerCount = released.size
      await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'roster', action: 'roster_released', targetUserId: userId,
        relatedEntityId: roster.id, relatedEntityType: 'roster', data: { councilId, releasedPlayerIds: [...released], reason: 'voted_out' }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    }
    const newState = outcome === 'exile_island' ? 'exile' : 'eliminated'
    // Everyone voted out after the merge sits on the jury that crowns the winner.
    const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true } })
    const joinsJury = settings.juryEnabled && JURY_PHASES.has(game?.phase ?? council.phase)
    await tx.survivorPlayer.update({ where: { id: player.id }, data: { playerState: newState, eliminatedWeek: council.week, canAccessTribeChat: false, canAccessMergeChat: false, canAccessExileChat: outcome === 'exile_island', exileReturnEligible: outcome === 'exile_island' && council.week < settings.exileReturnWeek,
      ...(joinsJury ? { isJuryMember: true, canAccessJuryChat: true } : {}) } })
    if (joinsJury) {
      await tx.survivorJuryMember.upsert({ where: { leagueId_rosterId: { leagueId, rosterId: roster.id } }, create: { leagueId, rosterId: roster.id, votedOutWeek: council.week }, update: {} })
      await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'jury', action: 'jury_joined', targetUserId: userId,
        relatedEntityId: roster.id, relatedEntityType: 'roster', data: { councilId }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    }
    let removedFromChats = 0
    const channels = await tx.survivorChatChannel.findMany({ where: { leagueId, channelType: { in: ['tribe', 'merge', 'alliance'] } }, select: { id: true, memberUserIds: true } })
    for (const ch of channels) if (ch.memberUserIds.includes(userId)) {
      await tx.survivorChatChannel.update({ where: { id: ch.id }, data: { memberUserIds: ch.memberUserIds.filter(u => u !== userId) } }); removedFromChats++
    }
    await tx.survivorTribeMember.deleteMany({ where: { rosterId: roster.id, tribe: { leagueId } } })
    const active = await tx.survivorPlayer.count({ where: { leagueId, playerState: 'active' } })
    const exiled = await tx.survivorPlayer.count({ where: { leagueId, playerState: 'exile' } })
    await tx.survivorGameState.upsert({ where: { leagueId }, create: { leagueId, phase: council.phase, currentWeek: council.week, activePlayerCount: active, exilePlayerCount: exiled, tribalCompleteAt: now },
      update: { activePlayerCount: active, exilePlayerCount: exiled, activeCouncilId: null, needsTribalLock: false, tribalCompleteAt: now } })
    if (resumeRelease && previous) await tx.survivorAuditEntry.update({ where: { id: previous.id }, data: { data: { ...previousData, pendingRelease: false, releasedPlayerCount } as Prisma.InputJsonValue } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'elimination', action: resumeRelease ? 'elimination_release_recovered' : 'player_eliminated', actorUserId: actorUserId ?? null, targetUserId: userId,
      relatedEntityId: councilId, relatedEntityType: input.relatedEntityType, data: { outcome, newState, removedFromChats, releasedPlayerCount, pendingRelease: false, pendingExile: false }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    if (outcome === 'exile_island') {
      let channel = await tx.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'exile', isArchived: false }, select: { id: true, memberUserIds: true } })
      if (!channel) channel = await tx.survivorChatChannel.create({ data: { leagueId, channelType: 'exile', name: 'Exile Island', memberUserIds: [userId] }, select: { id: true, memberUserIds: true } })
      else if (!channel.memberUserIds.includes(userId)) await tx.survivorChatChannel.update({ where: { id: channel.id }, data: { memberUserIds: { push: userId } } })
      await tx.exileIsland.upsert({ where: { leagueId }, create: { leagueId, isActive: true, currentWeek: council.week, chatChannelId: channel.id }, update: { isActive: true, chatChannelId: channel.id } })
      // The linked competition's roster starts empty; no main-island players are duplicated.
      const link = await tx.survivorExileLeague.findUnique({ where: { mainLeagueId: leagueId } })
      if (link && !await tx.roster.findFirst({ where: { leagueId: link.exileLeagueId, platformUserId: userId }, select: { id: true } })) {
        await tx.roster.create({ data: { leagueId: link.exileLeagueId, platformUserId: userId, playerData: {} } })
      }
      await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'exile', action: 'exile_enrolled', targetUserId: userId,
        relatedEntityId: roster.id, relatedEntityType: 'roster', data: { returnWeek: settings.exileReturnWeek, tokensRequired: settings.exileReturnTokens }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    }
    // Push and email stay spoiler-safe; the Torch Ceremony in league chat carries the name.
    if (!resumeRelease) await tx.survivorNotification.create({ data: { leagueId, type: 'elimination', recipientRole: 'all', title: input.notice.title,
      body: input.notice.body, deepLinkPath: input.notice.deepLinkPath, urgency: 'high', isSpoilerSafe: false, scheduledFor: now, status: 'pending' } })
    return { ok: true, alreadyResolved: false, outcome, eliminatedUserId: userId, eliminatedRosterId: roster.id, removedFromChats, pendingRelease: false, pendingExile: false, releasedPlayerCount }
}

/** After a transaction that called eliminateCastawayInTransaction commits (the final jury step). */
export async function afterCastawayEliminated(leagueId: string, result: EliminationOutcome): Promise<void> {
  if (result.ok && !result.alreadyResolved) await afterEliminationCommitted(leagueId, result)
}
