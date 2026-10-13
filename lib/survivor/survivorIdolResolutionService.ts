import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadCouncilContext, type IdolPlayRecord } from './survivorCouncilService'
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

type PlayablePower = 'vote_shield' | 'extra_vote' | 'skip_tribal' | 'vote_steal'

async function playPower(
  leagueId: string,
  ownerUserId: string,
  power: PlayablePower,
  extra: { extraTargetUserId?: string; stolenVoterUserId?: string; forfeitsVote?: boolean } = {},
): Promise<IdolPlayOutcome> {
  const ctx = await loadCouncilContext(leagueId)
  if (!ctx) return { ok: false, status: 404, code: 'no_active_council', error: 'No active Elimination Council.' }
  const { council, settings, eligibility, userToRoster } = ctx

  if (council.isRevealed || council.status === 'cancelled') {
    return { ok: false, status: 409, code: 'council_closed', error: 'Idols can no longer be played at this council.' }
  }
  if (council.phase === 'revote') {
    return { ok: false, status: 409, code: 'revote_no_new_idols', error: 'No new idols can be played during a revote.' }
  }
  // Vote Shield may be played up to reveal; vote-affecting plays close with the window.
  if (power !== 'vote_shield' && council.status === 'closed') {
    return { ok: false, status: 409, code: 'window_closed', error: 'The vote window is closed; this power can no longer be played.' }
  }

  const ownerRosterId = userToRoster[ownerUserId]
  if (!ownerRosterId) {
    return { ok: false, status: 403, code: 'not_in_council', error: 'You are not an active player at this council.' }
  }

  // Idol expiry: invalid once we reach the final-N boundary.
  const activePlayerCount =
    (await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { activePlayerCount: true } }))?.activePlayerCount ??
    (await prisma.survivorPlayer.count({ where: { leagueId, playerState: 'active' } }))
  if (activePlayerCount <= settings.idolInvalidRemainingPlayers) {
    return { ok: false, status: 422, code: 'idol_expired', error: `Idols are invalid once ${settings.idolInvalidRemainingPlayers} players remain.` }
  }

  if (power === 'extra_vote' || power === 'vote_steal') {
    if (!isEligibleVoter(eligibility, ownerUserId)) {
      return { ok: false, status: 403, code: 'not_eligible_voter', error: 'Only an eligible voter can play an Extra Vote.' }
    }
    if (!extra.extraTargetUserId) {
      return { ok: false, status: 422, code: 'extra_target_required', error: 'Extra Vote requires a target.' }
    }
    if (!isEligibleTarget(eligibility, ownerUserId, extra.extraTargetUserId)) {
      return { ok: false, status: 422, code: 'not_eligible_target', error: 'That player cannot be voted for at this council.' }
    }
  }

  if (power === 'vote_steal') {
    const stolenUserId = extra.stolenVoterUserId
    if (!stolenUserId || stolenUserId === ownerUserId || !isEligibleVoter(eligibility, stolenUserId) ||
        !eligibility.targetUserIds.includes(stolenUserId)) {
      return { ok: false, status: 422, code: 'invalid_stolen_vote', error: 'Choose a non-immune tribemate who can vote at this council.' }
    }
    const alreadyVoted = await prisma.survivorVote.findFirst({ where: { councilId: council.id, voterRosterId: ownerRosterId }, select: { id: true } })
    if (!alreadyVoted) return { ok: false, status: 422, code: 'vote_first', error: 'Cast your own private vote before using Vote Steal.' }
    if (council.idolsPlayed.some(play => play.powerType === 'vote_steal' && play.stolenVoterUserId === stolenUserId)) {
      return { ok: false, status: 409, code: 'vote_already_taken', error: 'That manager\'s vote has already been taken.' }
    }
  }

  const idol = await prisma.survivorIdol.findFirst({
    where: { leagueId, currentOwnerUserId: ownerUserId, powerType: power, isUsed: false, status: 'hidden' },
    orderBy: { assignedAt: 'asc' },
    select: { id: true },
  })
  if (!idol) {
    // Idempotency: if the owner already played this power at this council, report it truthfully.
    const already = council.idolsPlayed.find((p) => p.playerUserId === ownerUserId && p.powerType === power)
    if (already) {
      return { ok: true, idolId: already.idolId, powerType: power, alreadyPlayed: true, councilId: council.id, message: 'Power already played at this council.' }
    }
    return { ok: false, status: 404, code: 'no_playable_idol', error: `You do not hold a playable ${power.replace('_', ' ')}.` }
  }

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

  const committed = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-idol:${council.id}`}, 0))::text`
    const freshCouncil = await tx.survivorTribalCouncil.findFirst({ where: { id: council.id, leagueId }, select: { status: true, isRevealed: true, idolsPlayed: true } })
    if (!freshCouncil || freshCouncil.isRevealed || !['voting_open', 'scheduled', ...(power === 'vote_shield' ? ['closed'] : [])].includes(freshCouncil.status)) return false
    const existing = Array.isArray(freshCouncil.idolsPlayed) ? freshCouncil.idolsPlayed as unknown as IdolPlayRecord[] : []
    if (power === 'vote_steal' && existing.some(play => play.powerType === 'vote_steal' && play.stolenVoterUserId === extra.stolenVoterUserId)) return false
    if (power === 'vote_steal' && !(await tx.survivorVote.findFirst({ where: { councilId: council.id, voterRosterId: ownerRosterId }, select: { id: true } }))) return false
    const consumed = await tx.survivorIdol.updateMany({ where: { id: idol.id, leagueId, currentOwnerUserId: ownerUserId, isUsed: false, status: 'hidden' }, data: { status: 'played', isUsed: true, usedAt: new Date(), usedAtCouncilId: council.id } })
    if (consumed.count !== 1) return false
    await tx.survivorTribalCouncil.update({ where: { id: council.id }, data: { idolsPlayed: [...existing, record] as unknown as Prisma.InputJsonValue } })
    await tx.survivorIdolLedgerEntry.create({ data: { leagueId, idolId: idol.id, eventType: 'played', fromRosterId: ownerRosterId,
      metadata: { councilId: council.id, powerType: power, ...(extraTargetRosterId ? { extraTargetRosterId } : {}), ...(extra.stolenVoterUserId ? { stolenVoterUserId: extra.stolenVoterUserId } : {}) } } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'idol', action: 'idol_played', actorUserId: ownerUserId,
      relatedEntityId: idol.id, relatedEntityType: 'idol', data: { powerType: power, councilId: council.id }, isVisibleToCommissioner: false, isVisibleToPublic: false } })
    return true
  })
  if (!committed) return { ok: false, status: 409, code: 'idol_state_changed', error: 'The council or idol changed. Refresh and try again.' }

  const message =
    power === 'vote_shield'
      ? 'Vote Shield played. Votes cast against you will not count when revealed.'
      : power === 'extra_vote'
        ? 'Extra Vote played. Your additional ballot will be counted at tally.'
        : power === 'vote_steal'
          ? 'Vote Steal played. Your target will learn their ballot was taken at the public read.'
          : 'Council Pass played. You are safe from being voted out at this council.'
  return { ok: true, idolId: idol.id, powerType: power, alreadyPlayed: false, councilId: council.id, message }
}

export function playVoteShield(leagueId: string, ownerUserId: string): Promise<IdolPlayOutcome> {
  return playPower(leagueId, ownerUserId, 'vote_shield')
}

export function playExtraVote(leagueId: string, ownerUserId: string, extraTargetUserId: string): Promise<IdolPlayOutcome> {
  return playPower(leagueId, ownerUserId, 'extra_vote', { extraTargetUserId })
}

export function playSkipTribal(leagueId: string, ownerUserId: string, opts: { forfeitsVote?: boolean } = {}): Promise<IdolPlayOutcome> {
  return playPower(leagueId, ownerUserId, 'skip_tribal', { forfeitsVote: opts.forfeitsVote })
}

export function playVoteSteal(leagueId: string, ownerUserId: string, stolenVoterUserId: string, extraTargetUserId: string): Promise<IdolPlayOutcome> {
  return playPower(leagueId, ownerUserId, 'vote_steal', { stolenVoterUserId, extraTargetUserId })
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
    alreadyPlayed: i.isUsed || i.status === 'played',
  }))
}
