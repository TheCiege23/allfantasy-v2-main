import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadCouncilContext } from './survivorCouncilService'
import { isEligibleTarget, isEligibleVoter } from './survivorBallotEligibility'

/**
 * SURVIVOR PRIVATE VOTE SUBMISSION (canonical Phase 3).
 *
 * Votes are submitted privately via the consolidated route — never in tribe chat, never publicly.
 * The confirmation returned to the voter reveals only their own ballot; no other ballots, tallies,
 * or targets of other voters are exposed. Eligibility, self-vote, window, late, and vote-change
 * policy are all enforced here.
 */

export type SubmitVoteOutcome =
  | {
      ok: true
      councilId: string
      locked: boolean
      late: boolean
      doesNotCount: boolean
      targetUserId: string
      targetName: string | null
      message: string
    }
  | { ok: false; status: 400 | 403 | 404 | 409 | 422; code: string; error: string }

export interface SubmitVoteOptions {
  /** Host override to accept a ballot after the deadline (still flagged late). */
  allowLateOverride?: boolean
}

/**
 * Submit (or change) a private ballot. `voterUserId` is the acting user; `targetUserId` is who they
 * vote out. First-valid-locks by default; `allow_until_close` permits changes while the window is
 * open. Late ballots are recorded as `does_not_count` unless late votes are allowed.
 */
export async function submitVote(
  leagueId: string,
  voterUserId: string,
  targetUserId: string,
  opts: SubmitVoteOptions = {},
): Promise<SubmitVoteOutcome> {
  return prisma.$transaction(async (tx): Promise<SubmitVoteOutcome> => {
    // Serialize ballot submission with close, pause, extension, and idol actions.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
    if (game?.pausedSnapshot != null) return { ok: false, status: 409, code: 'league_paused', error: 'The league is paused.' }
    const ctx = await loadCouncilContext(leagueId, undefined, tx)
    if (!ctx) return { ok: false, status: 404, code: 'no_active_council', error: 'No active Elimination Council.' }
    const { council, settings, eligibility, userToRoster } = ctx

    if (council.isRevealed || council.status === 'cancelled') {
      return { ok: false, status: 409, code: 'council_closed', error: 'This council is no longer accepting votes.' }
    }
    if (council.status === 'scheduled') {
      return { ok: false, status: 409, code: 'window_not_open', error: 'The vote window has not opened yet.' }
    }

    if (!isEligibleVoter(eligibility, voterUserId)) {
      return { ok: false, status: 403, code: 'not_eligible_voter', error: 'You are not eligible to vote at this council.' }
    }
    if (voterUserId === targetUserId && !settings.selfVotesAllowed) {
      return { ok: false, status: 422, code: 'self_vote_disallowed', error: 'Self-votes are not allowed.' }
    }
    if (!isEligibleTarget(eligibility, voterUserId, targetUserId)) {
      return { ok: false, status: 422, code: 'not_eligible_target', error: 'That player cannot be voted for at this council.' }
    }

    const now = new Date()
    const past = now.getTime() > council.voteDeadlineAt.getTime() || council.status === 'closed'
    if (council.phase === 'revote' && past) {
      return { ok: false, status: 409, code: 'revote_closed', error: 'The two-hour revote window has closed. Uncast ballots do not count.' }
    }
    const late = past
    if (late && !settings.lateVotesAllowed && !opts.allowLateOverride) {
      // Still record the ballot but flag it does-not-count — truthful, not silently dropped.
    }
    if (council.status !== 'voting_open' && !opts.allowLateOverride) {
      return { ok: false, status: 409, code: 'window_closed', error: 'The vote window is closed.' }
    }

    const voterRosterId = userToRoster[voterUserId]
    const targetRosterId = userToRoster[targetUserId]
    if (!voterRosterId || !targetRosterId) {
      return { ok: false, status: 400, code: 'roster_unresolved', error: 'Could not resolve voter/target roster.' }
    }

    const existing = await tx.survivorVote.findUnique({
      where: { councilId_voterRosterId: { councilId: council.id, voterRosterId } },
      select: { id: true, doesNotCount: true },
    })

    const firstValidLocks = settings.voteChangePolicy === 'first_valid_locks'
    if (existing && firstValidLocks && !existing.doesNotCount) {
      return { ok: false, status: 409, code: 'vote_locked', error: 'Your first valid vote is locked and cannot be changed.' }
    }

    const doesNotCount = late && !settings.lateVotesAllowed
    const target = ctx.scopePlayers.find((p) => p.userId === targetUserId)

    await tx.survivorVote.upsert({
      where: { councilId_voterRosterId: { councilId: council.id, voterRosterId } },
      create: {
        councilId: council.id,
        leagueId,
        voterRosterId,
        targetRosterId,
        voterUserId,
        targetUserId,
        targetName: target?.displayName ?? null,
        isLateVote: late,
        doesNotCount,
      },
      update: {
        targetRosterId,
        targetUserId,
        targetName: target?.displayName ?? null,
        isLateVote: late,
        doesNotCount,
        submittedAt: now,
      },
    })

    // Private audit: actor = voter so only the voter (and full hosts) can see it; not public.
    await tx.survivorAuditEntry.create({
      data: {
        leagueId,
        week: council.week,
        category: 'vote',
        action: 'vote_submitted',
        actorUserId: voterUserId,
        relatedEntityId: council.id,
        relatedEntityType: 'council',
        data: { late, doesNotCount, changed: Boolean(existing) },
        isVisibleToCommissioner: false,
        isVisibleToPublic: false,
      },
    })

    return {
      ok: true,
      councilId: council.id,
      locked: firstValidLocks && !doesNotCount,
      late,
      doesNotCount,
      targetUserId,
      targetName: target?.displayName ?? null,
      message: doesNotCount
        ? 'Vote received but recorded as Does Not Count (submitted after the deadline).'
        : firstValidLocks
          ? 'Vote received and locked.'
          : 'Vote received. You may change it until the window closes.',
    }
  })
}
