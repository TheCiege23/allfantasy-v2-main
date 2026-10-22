import 'server-only'
import { isSurvivorIdolExpired, survivorIdolExpiredMessage, survivorIdolExpiryRule } from './survivorIdolExpiry'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadCouncilContext, type IdolPlayRecord } from './survivorCouncilService'
import { idolDefinition, type IdolPlayPreview } from './survivorIdolCatalog'
import { isEligibleTarget, isEligibleVoter } from './survivorBallotEligibility'

/**
 * SURVIVOR IDOL RESOLUTION (canonical Phase 3) — makes the seeded idols meaningful.
 *
 * Council powers:
 *  - vote_shield  → all votes cast against the holder are disqualified at tally (blocked_by_idol).
 *  - extra_vote   → the holder casts one extra valid ballot (stored in council.idolsPlayed; the
 *                   SurvivorVote unique(councilId,voterRosterId) constraint means the extra ballot
 *                   is not a second SurvivorVote row but an applied-at-tally record).
 *  - skip_tribal  → the holder becomes an ineligible target this council (optionally forfeits vote).
 *
 *  - vote_steal    → nullifies one eligible non-immune manager's ballot and casts a second ballot.
 * Roster raid powers are resolved by survivorStealThree; Auto Waiver Pickup remains inventory-only.
 * Council plays are one-time use and remain hidden from everyone except their owner until the read.
 */

export type IdolPlayOutcome =
  | { ok: true; idolId: string; powerType: string; alreadyPlayed: boolean; councilId: string; message: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422; code: string; error: string }


/** The catalog owns timing semantics; unsupported windows never become playable by default. */
export function idolWindowOpen(council: { status: string; phase: string; isRevealed: boolean; voteDeadlineAt: Date; votingOpensAt: Date | null }, when: string, now = new Date()): boolean {
  return when === 'Before votes close' && council.phase !== 'revote' && !council.isRevealed &&
    council.status === 'voting_open' && (!council.votingOpensAt || council.votingOpensAt <= now) && council.voteDeadlineAt > now
}

/** Owner-only projection. Never expose existing plays when listing possible targets. */
export async function getCouncilIdolPreview(leagueId: string, userId: string, idolId: string): Promise<IdolPlayPreview | null> {
  const idol = await prisma.survivorIdol.findFirst({ where: { id: idolId, leagueId, currentOwnerUserId: userId, isUsed: false, status: 'hidden' }, select: { powerType: true } })
  if (!idol) return null
  const definition = idolDefinition(idol.powerType)
  const ctx = await loadCouncilContext(leagueId)
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { activePlayerCount: true, immunePlayerId: true, pausedSnapshot: true, phase: true } })
  const owner = ctx?.scopePlayers.find(p => p.userId === userId)
  const expired = Boolean(ctx && game && isSurvivorIdolExpired(survivorIdolExpiryRule(ctx.settings), { activePlayerCount: game.activePlayerCount, week: ctx.council.week, phase: game.phase }))
  const playable = Boolean(definition.action && ctx && owner && game && game.pausedSnapshot == null && !expired && idolWindowOpen(ctx.council, definition.when))
  return {
    deadline: ctx?.council.voteDeadlineAt.toISOString() ?? null, playable,
    reason: !definition.action ? 'Not playable yet' : !playable ? 'This idol cannot be played in the current council window.' : null,
    targets: definition.needsTarget && ctx ? ctx.scopePlayers.filter(p => p.userId !== userId && p.tribeId === owner?.tribeId).map(p => ({
      userId: p.userId, name: p.displayName, disabled: p.userId === game?.immunePlayerId,
      reason: p.userId === game?.immunePlayerId ? 'Immune this week' : null,
    })) : [],
  }
}

type PlayablePower = 'vote_shield' | 'extra_vote' | 'skip_tribal' | 'vote_steal'

async function playPower(
  leagueId: string,
  ownerUserId: string,
  power: PlayablePower,
  extra: { idolId?: string; extraTargetUserId?: string; stolenVoterUserId?: string; forfeitsVote?: boolean } = {},
): Promise<IdolPlayOutcome> {
  try {
    return await prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<IdolPlayOutcome> => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-idol:${leagueId}`}, 0))::text`
      const ctx = await loadCouncilContext(leagueId, undefined, tx)
      if (!ctx) return { ok: false, status: 404, code: 'no_active_council', error: 'No active Elimination Council.' }
      const { council, settings, eligibility, userToRoster } = ctx

      if (council.isRevealed || council.status === 'cancelled') {
        return { ok: false, status: 409, code: 'council_closed', error: 'Idols can no longer be played at this council.' }
      }
      if (council.phase === 'revote') {
        return { ok: false, status: 409, code: 'revote_no_new_idols', error: 'No new idols can be played during a revote.' }
      }
      if (!idolWindowOpen(council, idolDefinition(power).when)) {
        return { ok: false, status: 409, code: 'window_closed', error: 'The vote window is closed; this power can no longer be played.' }
      }

      const ownerRosterId = userToRoster[ownerUserId]
      if (!ownerRosterId) {
        return { ok: false, status: 403, code: 'not_in_council', error: 'You are not an active player at this council.' }
      }

      // Idol expiry: the league's one rule (merge / players left / week), see survivorIdolExpiry.
      const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true, activePlayerCount: true, phase: true } })
      if (game?.pausedSnapshot != null) return { ok: false, status: 409, code: 'league_paused', error: 'The league is paused.' }
      const activePlayerCount = game?.activePlayerCount ??
        (await tx.survivorPlayer.count({ where: { leagueId, playerState: 'active' } }))
      const expiryRule = survivorIdolExpiryRule(settings)
      if (isSurvivorIdolExpired(expiryRule, { activePlayerCount, week: council.week, phase: game?.phase ?? council.phase })) {
        return { ok: false, status: 422, code: 'idol_expired', error: survivorIdolExpiredMessage(expiryRule) }
      }

      if (power === 'extra_vote' || power === 'vote_steal') {
        const shot = await tx.survivorAuditEntry.findUnique({
          where: { id: `survivor-shot:${leagueId}:${ownerUserId}` }, select: { relatedEntityId: true },
        })
        if (shot?.relatedEntityId === council.id) {
          return { ok: false, status: 409, code: 'shot_forfeited_vote', error: 'Playing Shot in the Dark forfeited your vote at this council.' }
        }
        if (!isEligibleVoter(eligibility, ownerUserId)) {
          return { ok: false, status: 403, code: 'not_eligible_voter', error: 'Only an eligible voter can play an Extra Vote.' }
        }
        if (extra.extraTargetUserId && !isEligibleTarget(eligibility, ownerUserId, extra.extraTargetUserId)) {
          return { ok: false, status: 422, code: 'not_eligible_target', error: 'That player cannot be voted for at this council.' }
        }
      }

      if (power === 'vote_steal') {
        const stolenUserId = extra.stolenVoterUserId
        if (!stolenUserId || stolenUserId === ownerUserId || !isEligibleVoter(eligibility, stolenUserId) ||
            !eligibility.targetUserIds.includes(stolenUserId)) {
          return { ok: false, status: 422, code: 'invalid_stolen_vote', error: 'Choose a non-immune tribemate who can vote at this council.' }
        }
        const owner = ctx.scopePlayers.find(p => p.userId === ownerUserId)
        const victim = ctx.scopePlayers.find(p => p.userId === stolenUserId)
        if (owner?.tribeId !== victim?.tribeId) return { ok: false, status: 422, code: 'wrong_tribe', error: 'Choose a manager in your tribe at council.' }
        if (council.idolsPlayed.some(play => play.powerType === 'vote_steal' && play.stolenVoterUserId === stolenUserId)) {
          return { ok: false, status: 409, code: 'idol_state_changed', error: 'The idol could not be played. Refresh and try again.' }
        }
      }

      const idol = await tx.survivorIdol.findFirst({
        where: { ...(extra.idolId ? { id: extra.idolId } : {}), leagueId, currentOwnerUserId: ownerUserId, powerType: power, isUsed: false, status: 'hidden' },
        orderBy: { assignedAt: 'asc' },
        select: { id: true, expiresAtWeek: true },
      })
      if (!idol) {
        // Idempotency: if the owner already played this power at this council, report it truthfully.
        const already = council.idolsPlayed.find((p) => p.playerUserId === ownerUserId && p.powerType === power && (!extra.idolId || p.idolId === extra.idolId))
        if (already) {
          return { ok: true, idolId: already.idolId, powerType: power, alreadyPlayed: true, councilId: council.id, message: 'Power already played at this council.' }
        }
        return { ok: false, status: 404, code: 'no_playable_idol', error: `You do not hold a playable ${power.replace('_', ' ')}.` }
      }

      if (idol.expiresAtWeek != null && council.week >= idol.expiresAtWeek) return { ok: false, status: 422, code: 'idol_expired', error: 'This idol has expired.' }
      if (!idolWindowOpen(council, idolDefinition(power).when)) return { ok: false, status: 409, code: 'window_closed', error: 'The vote deadline has passed.' }

      const extraTargetRosterId = extra.extraTargetUserId ? userToRoster[extra.extraTargetUserId] : undefined
      const record: IdolPlayRecord = {
        idolId: idol.id,
        powerType: power,
        playerUserId: ownerUserId,
        playerRosterId: ownerRosterId,
        ...(power === 'vote_shield' ? { protectedRosterId: ownerRosterId } : {}),
        ...(power === 'extra_vote' || power === 'vote_steal' ? { extraTargetUserId: extra.extraTargetUserId, extraTargetRosterId } : {}),
        ...(power === 'vote_steal' ? { stolenVoterUserId: extra.stolenVoterUserId, stolenVoterRosterId: userToRoster[extra.stolenVoterUserId!] } : {}),
        ...(power === 'skip_tribal' ? { forfeitsVote: Boolean(extra.forfeitsVote) } : {}),
        playedAt: new Date().toISOString(),
      }

      const existing = council.idolsPlayed
      const consumed = await tx.survivorIdol.updateMany({ where: { id: idol.id, leagueId, currentOwnerUserId: ownerUserId, isUsed: false, status: 'hidden' }, data: { status: 'played', isUsed: true, usedAt: new Date(), usedAtCouncilId: council.id } })
      if (consumed.count !== 1) return { ok: false, status: 409, code: 'idol_state_changed', error: 'The idol changed. Refresh and try again.' }
      await tx.survivorTribalCouncil.update({ where: { id: council.id }, data: { idolsPlayed: [...existing, record] as unknown as Prisma.InputJsonValue } })
      await tx.survivorIdolLedgerEntry.create({ data: { leagueId, idolId: idol.id, eventType: 'played', fromRosterId: ownerRosterId,
        metadata: { councilId: council.id, powerType: power, ...(extraTargetRosterId ? { extraTargetRosterId } : {}), ...(extra.stolenVoterUserId ? { stolenVoterUserId: extra.stolenVoterUserId } : {}) } } })
      await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'idol', action: 'idol_played', actorUserId: ownerUserId,
        relatedEntityId: idol.id, relatedEntityType: 'idol', data: { powerType: power, councilId: council.id }, isVisibleToCommissioner: false, isVisibleToPublic: false } })
      const message =
        power === 'vote_shield'
          ? 'Vote Shield played. Votes cast against you will not count when revealed.'
          : power === 'extra_vote'
            ? 'Extra Vote played. Your additional ballot will be counted at tally.'
            : power === 'vote_steal'
              ? 'Vote Steal played. Your target will learn their ballot was taken at the public read.'
              : 'Council Pass played. You are safe from being voted out at this council.'
      return { ok: true, idolId: idol.id, powerType: power, alreadyPlayed: false, councilId: council.id, message }
    }, { isolationLevel: 'Serializable' })
  } catch {
    return { ok: false, status: 409, code: 'idol_state_changed', error: 'The idol could not be played. Refresh and try again.' }
  }
}

export function playVoteShield(leagueId: string, ownerUserId: string, idolId?: string): Promise<IdolPlayOutcome> {
  return playPower(leagueId, ownerUserId, 'vote_shield', { idolId })
}

export function playExtraVote(leagueId: string, ownerUserId: string, extraTargetUserId?: string, idolId?: string): Promise<IdolPlayOutcome> {
  return playPower(leagueId, ownerUserId, 'extra_vote', { extraTargetUserId, idolId })
}

export function playSkipTribal(leagueId: string, ownerUserId: string, opts: { forfeitsVote?: boolean; idolId?: string } = {}): Promise<IdolPlayOutcome> {
  return playPower(leagueId, ownerUserId, 'skip_tribal', { forfeitsVote: opts.forfeitsVote, idolId: opts.idolId })
}

export function playVoteSteal(leagueId: string, ownerUserId: string, stolenVoterUserId: string, extraTargetUserId?: string, idolId?: string): Promise<IdolPlayOutcome> {
  return playPower(leagueId, ownerUserId, 'vote_steal', { stolenVoterUserId, extraTargetUserId, idolId })
}

/** Council powers the given user can currently play (owner-only view). */
export async function getPlayableIdolsForUser(
  leagueId: string,
  userId: string,
): Promise<Array<{ idolId: string; powerType: string; label: string; alreadyPlayed: boolean }>> {
  const ctx = await loadCouncilContext(leagueId)
  if (!ctx || ctx.council.isRevealed || ctx.council.status === 'cancelled' || ctx.council.phase === 'revote') return []
  const idols = await prisma.survivorIdol.findMany({
    where: { leagueId, currentOwnerUserId: userId, powerType: { in: ['vote_shield', 'extra_vote', 'skip_tribal', 'vote_steal'] } },
    select: { id: true, powerType: true, powerLabel: true, isUsed: true, status: true },
  })
  return (idols as Array<{ id: string; powerType: string; powerLabel: string | null; isUsed: boolean; status: string }>).map((i) => ({
    idolId: i.id,
    powerType: i.powerType,
    label: i.powerLabel ?? i.powerType,
    alreadyPlayed: i.isUsed || i.status !== 'hidden',
  }))
}

/** Cast the owner's additional ballot privately; never alter the victim's visible submission. */
export async function submitAdditionalIdolVote(leagueId: string, userId: string, targetUserId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-idol:${leagueId}`}, 0))::text`
    const ctx = await loadCouncilContext(leagueId, undefined, tx)
    const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
    if (game?.pausedSnapshot != null) return { ok: false as const, status: 409 as const, error: 'The league is paused.' }
    if (!ctx || !idolWindowOpen(ctx.council, 'Before votes close')) return { ok: false as const, status: 409 as const, error: 'The vote window is closed.' }
    const shot = await tx.survivorAuditEntry.findUnique({
      where: { id: `survivor-shot:${leagueId}:${userId}` }, select: { relatedEntityId: true },
    })
    if (shot?.relatedEntityId === ctx.council.id) return { ok: false as const, status: 409 as const, error: 'Playing Shot in the Dark forfeited your vote at this council.' }
    if (!isEligibleTarget(ctx.eligibility, userId, targetUserId)) return { ok: false as const, status: 422 as const, error: 'Choose an eligible vote target.' }
    const play = ctx.council.idolsPlayed.find(p => p.playerUserId === userId && ['extra_vote', 'vote_steal'].includes(p.powerType) && (!p.extraTargetUserId || ctx.settings.voteChangePolicy === 'allow_until_close'))
    if (!play) return { ok: false as const, status: 409 as const, error: 'No additional ballot is available.' }
    const plays = ctx.council.idolsPlayed.map(p => p === play ? { ...p, extraTargetUserId: targetUserId, extraTargetRosterId: ctx.userToRoster[targetUserId] } : p)
    await tx.survivorTribalCouncil.update({ where: { id: ctx.council.id }, data: { idolsPlayed: plays as unknown as Prisma.InputJsonValue } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week: ctx.council.week, category: 'vote', action: 'additional_vote_submitted', actorUserId: userId, data: {}, isVisibleToCommissioner: false, isVisibleToPublic: false } })
    return { ok: true as const, targetName: ctx.scopePlayers.find(p => p.userId === targetUserId)?.displayName ?? null, message: 'Your additional vote was received privately.' }
  }, { isolationLevel: 'Serializable' })
}
