import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadCouncilContext, type IdolPlayRecord } from './survivorCouncilService'
import { isEligibleTarget, isEligibleVoter } from './survivorBallotEligibility'

/**
 * SURVIVOR IDOL RESOLUTION (canonical Phase 3) — makes the seeded idols meaningful.
 *
 * Playable powers this phase:
 *  - vote_shield  → all votes cast against the holder are disqualified at tally (blocked_by_idol).
 *  - extra_vote   → the holder casts one extra valid ballot (stored in council.idolsPlayed; the
 *                   SurvivorVote unique(councilId,voterRosterId) constraint means the extra ballot
 *                   is not a second SurvivorVote row but an applied-at-tally record).
 *  - skip_tribal  → the holder becomes an ineligible target this council (optionally forfeits vote).
 *
 * Triple Steal / Auto Waiver Pickup are NOT resolved here (inventory-only). All plays are one-time
 * use, recorded in the council, ledger, and a hidden (non-public) audit entry. The play stays
 * hidden from other players until reveal; only the owner (and full hosts) see it pre-reveal.
 */

export type IdolPlayOutcome =
  | { ok: true; idolId: string; powerType: string; alreadyPlayed: boolean; councilId: string; message: string }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422; code: string; error: string }

type PlayablePower = 'vote_shield' | 'extra_vote' | 'skip_tribal'

async function appendIdolPlay(councilId: string, record: IdolPlayRecord): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const council = await tx.survivorTribalCouncil.findUnique({ where: { id: councilId }, select: { idolsPlayed: true } })
    const current = Array.isArray(council?.idolsPlayed) ? (council!.idolsPlayed as unknown as IdolPlayRecord[]) : []
    await tx.survivorTribalCouncil.update({
      where: { id: councilId },
      data: { idolsPlayed: [...current, record] as unknown as Prisma.InputJsonValue },
    })
  })
}

async function playPower(
  leagueId: string,
  ownerUserId: string,
  power: PlayablePower,
  extra: { extraTargetUserId?: string; forfeitsVote?: boolean } = {},
): Promise<IdolPlayOutcome> {
  const ctx = await loadCouncilContext(leagueId)
  if (!ctx) return { ok: false, status: 404, code: 'no_active_council', error: 'No active Elimination Council.' }
  const { council, settings, eligibility, userToRoster } = ctx

  if (council.isRevealed || council.status === 'cancelled') {
    return { ok: false, status: 409, code: 'council_closed', error: 'Idols can no longer be played at this council.' }
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

  if (power === 'extra_vote') {
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
    ...(power === 'extra_vote' ? { extraTargetUserId: extra.extraTargetUserId, extraTargetRosterId } : {}),
    ...(power === 'skip_tribal' ? { forfeitsVote: Boolean(extra.forfeitsVote) } : {}),
    playedAt: new Date().toISOString(),
  }

  await appendIdolPlay(council.id, record)
  await prisma.survivorIdol.update({
    where: { id: idol.id },
    data: { status: 'played', isUsed: true, usedAt: new Date(), usedAtCouncilId: council.id },
  })
  await prisma.survivorIdolLedgerEntry.create({
    data: {
      leagueId,
      idolId: idol.id,
      eventType: 'played',
      fromRosterId: ownerRosterId,
      metadata: { councilId: council.id, powerType: power, ...(extraTargetRosterId ? { extraTargetRosterId } : {}) },
    },
  })
  // Hidden audit: actor = owner, not public — the play is secret until reveal.
  await prisma.survivorAuditEntry.create({
    data: {
      leagueId,
      week: council.week,
      category: 'idol',
      action: 'idol_played',
      actorUserId: ownerUserId,
      relatedEntityId: idol.id,
      relatedEntityType: 'idol',
      data: { powerType: power, councilId: council.id },
      isVisibleToCommissioner: false,
      isVisibleToPublic: false,
    },
  })

  const message =
    power === 'vote_shield'
      ? 'Vote Shield played. Votes cast against you will not count when revealed.'
      : power === 'extra_vote'
        ? 'Extra Vote played. Your additional ballot will be counted at tally.'
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

/** Powers the given user can currently play at the active council (owner-only view). */
export async function getPlayableIdolsForUser(
  leagueId: string,
  userId: string,
): Promise<Array<{ idolId: string; powerType: string; label: string; alreadyPlayed: boolean }>> {
  const ctx = await loadCouncilContext(leagueId)
  if (!ctx || ctx.council.isRevealed || ctx.council.status === 'cancelled') return []
  const idols = await prisma.survivorIdol.findMany({
    where: { leagueId, currentOwnerUserId: userId, powerType: { in: ['vote_shield', 'extra_vote', 'skip_tribal'] } },
    select: { id: true, powerType: true, powerLabel: true, isUsed: true, status: true },
  })
  return (idols as Array<{ id: string; powerType: string; powerLabel: string | null; isUsed: boolean; status: string }>).map((i) => ({
    idolId: i.id,
    powerType: i.powerType,
    label: i.powerLabel ?? i.powerType,
    alreadyPlayed: i.isUsed || i.status === 'played',
  }))
}
