import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { addPlayerToRosterData } from '@/lib/waiver-wire/roster-utils'
import { resolveElimination } from './survivorEliminationService'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'

/**
 * The commissioner's "change a Tribal result": the wrong manager was voted out, the right one stays.
 *
 * 🛑 THE OLD OVERRIDE ONLY HALF DID THIS. It wrote the new name onto the council and set the new
 * manager's `playerState`, and nothing else: the manager who was really voted out stayed eliminated,
 * kept their released roster, stayed on Exile or the jury and out of their tribe; and the new one kept
 * their roster, tribe and chats while reading as eliminated. This does the whole thing.
 *
 * Two cases, and only the latest council with an elimination can be changed (anything later was
 * played on top of it):
 *
 *   NOT YET RESOLVED   the result is picked but `resolveElimination` has not run. Point the council at
 *                      the right manager; the normal resolution eliminates them. Nothing to undo.
 *   RESOLVED           undo the wrong elimination — back to active, back in their tribe (or the merge)
 *                      and its chat, off Exile and the jury, their released players returned unless
 *                      another team has claimed them since — then run the normal elimination for the
 *                      right manager, so they get every side effect a vote-out has.
 *
 * What cannot be undone, and is reported rather than hidden: a released player another team has
 * picked up since, trades voided at the elimination, cancelled waiver claims, and player-bound idols
 * that moved off the released players.
 */

export type TribalOverrideTarget = {
  councilId: string
  week: number
  /** The manager the council currently names as voted out. */
  eliminatedUserId: string
  eliminatedName: string | null
  /** True once the elimination has been carried out (roster released, Exile / jury, chats). */
  resolved: boolean
  /** Managers the commissioner may name instead: active, and at this council when it was a tribe's. */
  candidates: Array<{ userId: string; name: string }>
}

export type TribalOverrideResult =
  | {
      ok: true
      councilId: string
      reinstatedUserId: string | null
      eliminatedUserId: string
      /** Released players given back to the reinstated manager. */
      restoredPlayerIds: string[]
      /** Released players another team has since claimed: they stay where they are. */
      claimedElsewherePlayerIds: string[]
      /** False when the right manager's elimination could not run yet; it can be retried. */
      eliminationApplied: boolean
      eliminationError?: string
    }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }

const ENDED_PHASES = new Set(['finale', 'complete'])

type Db = Prisma.TransactionClient | typeof prisma

async function latestEliminationCouncil(db: Db, leagueId: string) {
  return db.survivorTribalCouncil.findFirst({
    where: { leagueId, eliminatedUserId: { not: null } },
    orderBy: [{ week: 'desc' }, { councilNumber: 'desc' }],
  })
}

async function isResolved(db: Db, leagueId: string, councilId: string): Promise<boolean> {
  const row = await db.survivorAuditEntry.findFirst({
    where: { leagueId, action: 'player_eliminated', relatedEntityId: councilId },
    select: { id: true },
  })
  return Boolean(row)
}

/** What the commissioner's override form offers, or null when no council can be changed now. */
export async function readTribalOverrideTarget(leagueId: string): Promise<TribalOverrideTarget | null> {
  const council = await latestEliminationCouncil(prisma, leagueId)
  if (!council?.eliminatedUserId) return null
  const [resolved, players] = await Promise.all([
    isResolved(prisma, leagueId, council.id),
    prisma.survivorPlayer.findMany({
      where: { leagueId, playerState: 'active', ...(council.attendingTribeId ? { tribeId: council.attendingTribeId } : {}) },
      select: { userId: true, displayName: true },
      orderBy: { displayName: 'asc' },
    }),
  ])
  return {
    councilId: council.id,
    week: council.week,
    eliminatedUserId: council.eliminatedUserId,
    eliminatedName: council.eliminatedName ?? null,
    resolved,
    candidates: players
      .filter((p) => p.userId !== council.eliminatedUserId)
      .map((p) => ({ userId: p.userId, name: p.displayName || 'Manager' })),
  }
}

export async function overrideTribalResult(input: {
  leagueId: string
  councilId: string
  eliminateUserId: string
  actorUserId: string
  notes?: string
}): Promise<TribalOverrideResult> {
  const { leagueId, councilId, eliminateUserId } = input
  const phase1 = await withSurvivorSetupTransaction(leagueId, async (tx) => {
    const council = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId } })
    if (!council) return { ok: false, status: 404, code: 'not_found', error: 'Council not found.' } as const
    if (!council.eliminatedUserId) return { ok: false, status: 409, code: 'no_result', error: 'This council has no result to change yet.' } as const
    if (council.isTie || council.status === 'tie_pending') return { ok: false, status: 409, code: 'tie_unresolved', error: 'Settle the tie before changing the result.' } as const
    const latest = await latestEliminationCouncil(tx, leagueId)
    if (latest?.id !== council.id) {
      return { ok: false, status: 409, code: 'not_latest', error: 'Only the most recent Tribal Council can be changed; later councils were played after it.' } as const
    }
    const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, activeCouncilId: true, mergeTriggeredAt: true } })
    if (game && ENDED_PHASES.has(game.phase)) return { ok: false, status: 409, code: 'season_over', error: 'The finale has started; Tribal results can no longer change.' } as const
    if (game?.activeCouncilId && game.activeCouncilId !== council.id) {
      return { ok: false, status: 409, code: 'council_open', error: 'Finish the open Tribal Council before changing an earlier one.' } as const
    }
    const wrongUserId = council.eliminatedUserId
    if (wrongUserId === eliminateUserId) return { ok: false, status: 400, code: 'same_player', error: 'That manager is already the one voted out.' } as const

    const right = await tx.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId: eliminateUserId } } })
    if (!right || right.playerState !== 'active') return { ok: false, status: 409, code: 'not_active', error: 'Only an active manager can be voted out.' } as const
    if (council.attendingTribeId && right.tribeId !== council.attendingTribeId) {
      return { ok: false, status: 409, code: 'not_at_council', error: 'That manager was not at this Tribal Council.' } as const
    }

    const resolved = await isResolved(tx, leagueId, council.id)
    let restoredPlayerIds: string[] = []
    let claimedElsewherePlayerIds: string[] = []
    if (resolved) {
      const undo = await reinstateWrongPlayer(tx, { leagueId, councilId: council.id, week: council.week, userId: wrongUserId, merged: Boolean(game?.mergeTriggeredAt) || ['merge', 'post_merge', 'jury'].includes(game?.phase ?? '') })
      if (!undo.ok) return undo
      restoredPlayerIds = undo.restoredPlayerIds
      claimedElsewherePlayerIds = undo.claimedElsewherePlayerIds
      // The council's elimination is now the right manager's to carry out: retire the old record so
      // `resolveElimination` runs again instead of answering "already resolved".
      await tx.survivorAuditEntry.updateMany({
        where: { leagueId, action: 'player_eliminated', relatedEntityId: council.id },
        data: { action: 'player_eliminated_overridden' },
      })
    }

    await tx.survivorTribalCouncil.update({
      where: { id: council.id },
      data: {
        eliminatedUserId: eliminateUserId,
        eliminatedRosterId: right.redraftRosterId ?? null,
        eliminatedName: right.displayName ?? '',
        auditLog: {
          ...(council.auditLog && typeof council.auditLog === 'object' && !Array.isArray(council.auditLog) ? council.auditLog as Record<string, unknown> : {}),
          commissionerOverride: true,
          overriddenFromUserId: wrongUserId,
          notes: input.notes ?? '',
        } as Prisma.InputJsonValue,
      },
    })
    await tx.survivorAuditEntry.create({
      data: {
        leagueId, week: council.week, category: 'tribal', action: 'tribal_result_overridden', actorUserId: input.actorUserId,
        targetUserId: eliminateUserId, relatedEntityId: council.id, relatedEntityType: 'council',
        data: { fromUserId: wrongUserId, toUserId: eliminateUserId, wasResolved: resolved, restoredPlayerIds, claimedElsewherePlayerIds, notes: input.notes ?? '' },
        isVisibleToCommissioner: true, isVisibleToPublic: true,
      },
    })
    return { ok: true, resolved, wrongUserId, restoredPlayerIds, claimedElsewherePlayerIds } as const
  })
  if (!phase1.ok) return phase1

  // A resolved council now names the right manager with no elimination record: carry it out the
  // normal way. An unresolved one waits for its normal resolution, exactly as before.
  let eliminationApplied = !phase1.resolved
  let eliminationError: string | undefined
  if (phase1.resolved) {
    const outcome = await resolveElimination(leagueId, councilId, input.actorUserId)
    eliminationApplied = outcome.ok
    if (!outcome.ok) eliminationError = outcome.error
  }
  return {
    ok: true,
    councilId,
    reinstatedUserId: phase1.resolved ? phase1.wrongUserId : null,
    eliminatedUserId: eliminateUserId,
    restoredPlayerIds: phase1.restoredPlayerIds,
    claimedElsewherePlayerIds: phase1.claimedElsewherePlayerIds,
    eliminationApplied,
    ...(eliminationError ? { eliminationError } : {}),
  }
}

/**
 * Undo one carried-out elimination: the inverse of `resolveElimination`, and the same re-entry the
 * scheduled Exile return makes (`resolveScheduledExileReturn`), back into the manager's OWN tribe.
 */
async function reinstateWrongPlayer(
  tx: Prisma.TransactionClient,
  input: { leagueId: string; councilId: string; week: number; userId: string; merged: boolean },
): Promise<{ ok: true; restoredPlayerIds: string[]; claimedElsewherePlayerIds: string[] } | { ok: false; status: 409; code: string; error: string }> {
  const { leagueId, userId, merged } = input
  const player = await tx.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } } })
  if (!player) return { ok: false, status: 409, code: 'player_not_found', error: 'The voted-out manager has no Survivor record.' }
  if (player.playerState === 'active') return { ok: true, restoredPlayerIds: [], claimedElsewherePlayerIds: [] }
  const tribe = !merged && player.tribeId
    ? await tx.survivorTribe.findFirst({ where: { id: player.tribeId, leagueId, isActive: true, isMerged: false }, select: { id: true } })
    : null
  if (!merged && !tribe) return { ok: false, status: 409, code: 'tribe_missing', error: 'The voted-out manager’s tribe no longer exists. Redraw the tribes first.' }

  await tx.survivorPlayer.update({
    where: { id: player.id },
    data: {
      playerState: 'active', eliminatedWeek: null, tribeId: tribe?.id ?? player.tribeId,
      canAccessTribeChat: !merged, canAccessMergeChat: merged, canAccessExileChat: false,
      canAccessJuryChat: false, isJuryMember: false, exileReturnEligible: false,
    },
  })

  const roster = player.redraftRosterId
    ? await tx.roster.findFirst({ where: { leagueId, id: player.redraftRosterId }, select: { id: true, playerData: true, redraftRosterId: true } })
    : null
  if (roster) {
    await tx.survivorJuryMember.deleteMany({ where: { leagueId, rosterId: roster.id } })
    if (tribe) await tx.survivorTribeMember.upsert({ where: { tribeId_rosterId: { tribeId: tribe.id, rosterId: roster.id } }, create: { tribeId: tribe.id, rosterId: roster.id }, update: {} })
  }

  const channels = await tx.survivorChatChannel.findMany({
    where: { leagueId, isArchived: false, channelType: { in: ['exile', 'jury', 'tribe', 'merge'] } },
    select: { id: true, channelType: true, tribeId: true, memberUserIds: true, readOnlyUserIds: true },
  })
  for (const channel of channels) {
    const joins = merged ? channel.channelType === 'merge' : channel.channelType === 'tribe' && channel.tribeId === tribe?.id
    const members = channel.memberUserIds.filter((id) => id !== userId)
    if (joins) members.push(userId)
    await tx.survivorChatChannel.update({ where: { id: channel.id }, data: { memberUserIds: members, readOnlyUserIds: channel.readOnlyUserIds.filter((id) => id !== userId) } })
  }

  // The released roster comes back, player by player, unless another team has claimed one since.
  const restoredPlayerIds: string[] = []
  const claimedElsewherePlayerIds: string[] = []
  if (roster) {
    const release = await tx.survivorAuditEntry.findFirst({
      where: { leagueId, action: 'roster_released', relatedEntityId: roster.id },
      orderBy: { createdAt: 'desc' },
      select: { data: true },
    })
    const data = release?.data as { councilId?: unknown; releasedPlayerIds?: unknown } | null
    const releasedIds = data?.councilId === input.councilId && Array.isArray(data.releasedPlayerIds) ? data.releasedPlayerIds.map(String) : []
    const actual = roster.redraftRosterId
      ? await tx.redraftRoster.findFirst({ where: { id: roster.redraftRosterId, leagueId }, select: { id: true, seasonId: true } })
      : null
    let playerData: unknown = roster.playerData
    for (const playerId of releasedIds) {
      const elsewhere = actual
        ? await tx.redraftRosterPlayer.findFirst({ where: { playerId, droppedAt: null, roster: { seasonId: actual.seasonId }, rosterId: { not: actual.id } }, select: { id: true } })
        : null
      if (elsewhere) { claimedElsewherePlayerIds.push(playerId); continue }
      if (actual) {
        const dropped = await tx.redraftRosterPlayer.findFirst({ where: { rosterId: actual.id, playerId, droppedAt: { not: null } }, orderBy: { droppedAt: 'desc' }, select: { id: true } })
        if (!dropped) { claimedElsewherePlayerIds.push(playerId); continue }
        await tx.redraftRosterPlayer.update({ where: { id: dropped.id }, data: { droppedAt: null } })
      }
      playerData = addPlayerToRosterData(playerData, playerId)
      restoredPlayerIds.push(playerId)
    }
    if (restoredPlayerIds.length) await tx.roster.update({ where: { id: roster.id }, data: { playerData: playerData as Prisma.InputJsonValue } })
    if (actual) await tx.redraftRoster.update({ where: { id: actual.id }, data: { isEliminated: false } })
  }

  const [active, exiled] = await Promise.all([
    tx.survivorPlayer.count({ where: { leagueId, playerState: 'active' } }),
    tx.survivorPlayer.count({ where: { leagueId, playerState: 'exile' } }),
  ])
  await tx.survivorGameState.updateMany({ where: { leagueId }, data: { activePlayerCount: active, exilePlayerCount: exiled } })
  await tx.survivorAuditEntry.create({
    data: {
      leagueId, week: input.week, category: 'elimination', action: 'elimination_reversed', targetUserId: userId,
      relatedEntityId: input.councilId, relatedEntityType: 'council',
      data: { restoredPlayerIds, claimedElsewherePlayerIds }, isVisibleToCommissioner: true, isVisibleToPublic: true,
    },
  })
  return { ok: true, restoredPlayerIds, claimedElsewherePlayerIds }
}
