import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadCouncilContext } from './survivorCouncilService'

/**
 * SURVIVOR VOTE TALLY (canonical Phase 3) — deterministic, no fabrication.
 *
 * Applies late-vote invalidation, Vote Shield blocks, Council Pass target safety, and Extra Vote
 * extra ballots; produces final counts, tie detection, a deterministic one-by-one reveal sequence,
 * and the eliminated candidate (only when there is a clean winner). Ties never auto-resolve — the
 * council enters `tie_pending` for a revote/commissioner tiebreak. Nothing is revealed to players
 * here; `revealCouncil` flips the public flag.
 */

export type BallotRevealStatus = 'counts' | 'late_does_not_count' | 'blocked_by_idol' | 'target_safe'

export interface RevealScroll {
  order: number
  targetUserId: string | null
  targetName: string | null
  status: BallotRevealStatus
  isExtraVote: boolean
}

export interface CouncilTally {
  councilId: string
  countsByTargetUserId: Record<string, number>
  countsByTargetName: Record<string, number>
  revealSequence: RevealScroll[]
  doesNotCountVoteIds: string[]
  blockedByIdol: boolean
  isTie: boolean
  tieUserIds: string[]
  tiePhase: 'commissioner_tiebreak_required' | null
  eliminatedUserId: string | null
  eliminatedName: string | null
  eliminatedRosterId: string | null
  totalBallots: number
}

export type TallyOutcome =
  | { ok: true; tally: CouncilTally; status: 'closed' | 'tie_pending' }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }

/**
 * Tally a closed council. Persists the reveal sequence + result on the council but does NOT reveal
 * (isRevealed stays false until `revealCouncil`). Idempotent: re-tallying recomputes from the same
 * ballots + idol plays.
 */
export async function tallyCouncil(leagueId: string, councilId: string): Promise<TallyOutcome> {
  const ctx = await loadCouncilContext(leagueId, councilId)
  if (!ctx) return { ok: false, status: 404, code: 'not_found', error: 'Council not found.' }
  const { council, settings, rosterToUser } = ctx
  if (council.status === 'cancelled') return { ok: false, status: 409, code: 'cancelled', error: 'Council was cancelled.' }
  if (council.status === 'scheduled' || council.status === 'voting_open') {
    return { ok: false, status: 409, code: 'window_open', error: 'Close the vote window before tallying.' }
  }

  const votes = await prisma.survivorVote.findMany({
    where: { councilId },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    select: { id: true, voterRosterId: true, targetRosterId: true, targetUserId: true, targetName: true, doesNotCount: true, isLateVote: true },
  })
  type VoteRow = { id: string; voterRosterId: string; targetRosterId: string; targetUserId: string | null; targetName: string | null; doesNotCount: boolean; isLateVote: boolean }
  const voteRows = votes as VoteRow[]

  const protectedRosters = new Set(
    council.idolsPlayed.filter((p) => p.powerType === 'vote_shield').map((p) => p.protectedRosterId ?? p.playerRosterId),
  )
  const safeRosters = new Set(council.idolsPlayed.filter((p) => p.powerType === 'skip_tribal').map((p) => p.playerRosterId))
  const extraBallots = council.idolsPlayed.filter((p) => p.powerType === 'extra_vote')

  const counts: Record<string, number> = {}
  const nameByUser: Record<string, string> = {}
  const doesNotCountVoteIds: string[] = []
  const scrolls: RevealScroll[] = []
  let order = 0
  let blockedByIdol = false

  function targetNameFor(userId: string | null, rosterId: string, fallback: string | null): string | null {
    if (userId) {
      const p = ctx!.scopePlayers.find((x) => x.userId === userId)
      if (p) return p.displayName
    }
    const byRoster = ctx!.scopePlayers.find((x) => x.rosterId === rosterId)
    return byRoster?.displayName ?? fallback
  }

  for (const v of voteRows) {
    const targetUserId = v.targetUserId ?? rosterToUser[v.targetRosterId] ?? null
    const targetName = targetNameFor(targetUserId, v.targetRosterId, v.targetName)
    let status: BallotRevealStatus = 'counts'
    if (v.doesNotCount || (v.isLateVote && !settings.lateVotesAllowed)) {
      status = 'late_does_not_count'
      doesNotCountVoteIds.push(v.id)
    } else if (protectedRosters.has(v.targetRosterId)) {
      status = 'blocked_by_idol'
      blockedByIdol = true
      doesNotCountVoteIds.push(v.id)
    } else if (safeRosters.has(v.targetRosterId)) {
      status = 'target_safe'
      doesNotCountVoteIds.push(v.id)
    } else if (targetUserId) {
      counts[targetUserId] = (counts[targetUserId] ?? 0) + 1
      if (targetName) nameByUser[targetUserId] = targetName
    }
    scrolls.push({ order: order++, targetUserId, targetName, status, isExtraVote: false })
  }

  // Extra Vote ballots — counted unless the extra target is protected/safe.
  for (const ev of extraBallots) {
    const targetRosterId = ev.extraTargetRosterId ?? ''
    const targetUserId = ev.extraTargetUserId ?? rosterToUser[targetRosterId] ?? null
    const targetName = targetNameFor(targetUserId, targetRosterId, null)
    let status: BallotRevealStatus = 'counts'
    if (protectedRosters.has(targetRosterId)) {
      status = 'blocked_by_idol'
      blockedByIdol = true
    } else if (safeRosters.has(targetRosterId)) {
      status = 'target_safe'
    } else if (targetUserId) {
      counts[targetUserId] = (counts[targetUserId] ?? 0) + 1
      if (targetName) nameByUser[targetUserId] = targetName
    }
    scrolls.push({ order: order++, targetUserId, targetName, status, isExtraVote: true })
  }

  const countsByTargetName: Record<string, number> = {}
  for (const [userId, n] of Object.entries(counts)) countsByTargetName[nameByUser[userId] ?? userId] = n

  const targets = Object.keys(counts)
  let isTie = false
  let tieUserIds: string[] = []
  let eliminatedUserId: string | null = null
  let eliminatedName: string | null = null
  let eliminatedRosterId: string | null = null

  if (targets.length > 0) {
    const max = Math.max(...Object.values(counts))
    const top = targets.filter((u) => counts[u] === max)
    if (top.length === 1) {
      eliminatedUserId = top[0]
      eliminatedName = nameByUser[eliminatedUserId] ?? null
      eliminatedRosterId = ctx.userToRoster[eliminatedUserId] ?? null
    } else {
      isTie = true
      tieUserIds = top
    }
  }

  const tally: CouncilTally = {
    councilId,
    countsByTargetUserId: counts,
    countsByTargetName,
    revealSequence: scrolls,
    doesNotCountVoteIds,
    blockedByIdol,
    isTie,
    tieUserIds,
    tiePhase: isTie ? 'commissioner_tiebreak_required' : null,
    eliminatedUserId,
    eliminatedName,
    eliminatedRosterId,
    totalBallots: scrolls.length,
  }

  await prisma.survivorTribalCouncil.update({
    where: { id: councilId },
    data: {
      doesNotCountVoteIds,
      revealSequence: scrolls as unknown as Prisma.InputJsonValue,
      isTie,
      tiePlayerIds: tieUserIds,
      tiePhase: isTie ? 'commissioner_tiebreak_required' : null,
      status: isTie ? 'tie_pending' : 'closed',
      eliminatedRosterId,
      eliminatedUserId,
      eliminatedName,
      tieBreakSeasonPoints: Prisma.JsonNull,
    },
  })

  await prisma.survivorAuditEntry.create({
    data: {
      leagueId,
      week: council.week,
      category: 'tribal',
      action: 'votes_tallied',
      relatedEntityId: councilId,
      relatedEntityType: 'council',
      data: { isTie, blockedByIdol, totalBallots: scrolls.length, eliminatedUserId },
      isVisibleToCommissioner: true,
      isVisibleToPublic: false,
    },
  })

  return { ok: true, tally, status: isTie ? 'tie_pending' : 'closed' }
}

export type RevealOutcome =
  | { ok: true; councilId: string; alreadyRevealed: boolean; revealSequence: RevealScroll[]; eliminatedUserId: string | null; eliminatedName: string | null; isTie: boolean }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }

/** Publish the public ceremony and reveal flag in one commit. Retries never announce twice. */
export async function revealCouncil(leagueId: string, councilId: string, actorUserId?: string): Promise<RevealOutcome> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<RevealOutcome> => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const council = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId } })
    if (!council) return { ok: false, status: 404, code: 'not_found', error: 'Council not found.' }
    const seq = Array.isArray(council.revealSequence) ? (council.revealSequence as unknown as RevealScroll[]) : []
    const result = { councilId, revealSequence: seq, eliminatedUserId: council.eliminatedUserId, eliminatedName: council.eliminatedName, isTie: council.isTie }
    if (council.isRevealed) return { ok: true, alreadyRevealed: true, ...result }
    if (!['closed', 'tie_pending', 'voting_closed'].includes(council.status) || seq.length === 0) {
      return { ok: false, status: 409, code: 'not_tallied', error: 'Close and tally the council before revealing.' }
    }
    const channel = await tx.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
    if (!channel) return { ok: false, status: 409, code: 'chat_missing', error: 'Restore league chat before publishing the Torch Ceremony.' }
    const ballots = seq.map((scroll, index) => `Ballot ${index + 1}: ${scroll.targetName ?? 'No eligible target'}${scroll.status === 'counts' ? '' : ' (does not count)'}.`).join('\n')
    const outcome = council.isTie ? 'The vote is tied. A tiebreak round is required; nobody is eliminated yet.' : `${council.eliminatedName ?? 'The selected manager'} has been voted off the main island.`
    await tx.survivorChatMessage.create({ data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
      contentType: 'host_announcement', content: `Torch Ceremony · Week ${council.week}\n${ballots}\n${outcome}` } })
    const now = new Date()
    await tx.survivorTribalCouncil.update({ where: { id: councilId }, data: { isRevealed: true, revealStartsAt: now, status: council.isTie ? 'tie_pending' : 'revealed' } })
    await tx.survivorGameState.updateMany({ where: { leagueId, activeCouncilId: councilId }, data: { tribalRevealAt: now } })
    await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'tribal', action: 'votes_revealed', actorUserId: actorUserId ?? null,
      relatedEntityId: councilId, relatedEntityType: 'council', data: { eliminatedUserId: council.eliminatedUserId, isTie: council.isTie }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    return { ok: true, alreadyRevealed: false, ...result }
  }, { timeout: 30_000, maxWait: 10_000 })
}
