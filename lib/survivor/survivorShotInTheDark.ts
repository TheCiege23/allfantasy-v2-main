import 'server-only'

import { randomInt } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadCouncilContext, type IdolPlayRecord } from './survivorCouncilService'
import { isEligibleVoter } from './survivorBallotEligibility'

/**
 * SHOT IN THE DARK — once per season, an attending manager gives up their ballot for a one-in-six
 * chance that votes against them do not count. The roll happens when it is played and stays sealed
 * (not even the player is told) until the public read, where the Torch Ceremony announces it.
 */

export const SHOT_IN_THE_DARK_ODDS = 6

export type ShotInTheDarkOutcome =
  | { ok: true; councilId: string; message: string }
  | { ok: false; status: 403 | 404 | 409; code: string; error: string }

export async function playShotInTheDark(
  leagueId: string,
  userId: string,
  roll: () => number = () => randomInt(SHOT_IN_THE_DARK_ODDS),
): Promise<ShotInTheDarkOutcome> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<ShotInTheDarkOutcome> => {
    // Same lock as idol plays, so a ballot and a Shot in the Dark cannot race each other.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-idol:${leagueId}`}, 0))::text`
    const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
    if (game?.pausedSnapshot != null) return { ok: false, status: 409, code: 'league_paused', error: 'The league is paused.' }
    const ctx = await loadCouncilContext(leagueId, undefined, tx as typeof prisma)
    if (!ctx) return { ok: false, status: 404, code: 'no_active_council', error: 'No Elimination Council is open.' }
    const { council } = ctx
    if (council.isRevealed || council.status !== 'voting_open' || Date.now() > council.voteDeadlineAt.getTime()) {
      return { ok: false, status: 409, code: 'window_closed', error: 'Shot in the Dark can only be played while votes are open.' }
    }
    if (!isEligibleVoter(ctx.eligibility, userId)) {
      return { ok: false, status: 403, code: 'not_eligible_voter', error: 'Only a manager voting at this council can play Shot in the Dark.' }
    }
    const rosterId = ctx.userToRoster[userId]
    if (!rosterId) return { ok: false, status: 409, code: 'roster_unresolved', error: 'Could not resolve your roster.' }
    const ballot = await tx.survivorVote.findUnique({ where: { councilId_voterRosterId: { councilId: council.id, voterRosterId: rosterId } }, select: { id: true } })
    if (ballot) return { ok: false, status: 409, code: 'already_voted', error: 'Shot in the Dark replaces your vote, so it must be played before you vote.' }
    const used = await tx.survivorAuditEntry.findFirst({ where: { leagueId, action: 'shot_in_the_dark_played', targetUserId: userId }, select: { id: true } })
    if (used) return { ok: false, status: 409, code: 'already_used', error: 'You have already used your Shot in the Dark this season.' }

    const safe = roll() === 0
    const record: IdolPlayRecord = {
      idolId: `shot-in-the-dark:${userId}`,
      powerType: 'shot_in_the_dark',
      playerUserId: userId,
      playerRosterId: rosterId,
      ...(safe ? { protectedRosterId: rosterId } : {}),
      safe,
      playedAt: new Date().toISOString(),
    }
    await tx.survivorTribalCouncil.update({ where: { id: council.id }, data: { idolsPlayed: [...council.idolsPlayed, record] as unknown as Prisma.InputJsonValue } })
    // Sealed from everyone, the commissioner included, until the read.
    await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'vote', action: 'shot_in_the_dark_played', targetUserId: userId,
      relatedEntityId: council.id, relatedEntityType: 'council', data: { safe }, isVisibleToCommissioner: false, isVisibleToPublic: false } })
    return { ok: true, councilId: council.id, message: 'Your Shot in the Dark is sealed and your vote is given up. You will learn the result when the votes are read.' }
  }, { timeout: 30_000, maxWait: 10_000 })
}

/** One Torch Ceremony line per Shot in the Dark played at this council. */
export function shotInTheDarkAnnouncements(plays: unknown, nameFor: (userId: string) => string): string[] {
  if (!Array.isArray(plays)) return []
  return plays
    .filter((play): play is IdolPlayRecord => Boolean(play) && (play as IdolPlayRecord).powerType === 'shot_in_the_dark')
    .map(play => `${nameFor(play.playerUserId)} played their Shot in the Dark: ${play.safe ? 'SAFE. Votes against them do not count.' : 'not safe.'}`)
}
