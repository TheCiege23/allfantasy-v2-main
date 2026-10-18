import 'server-only'

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { loadCouncilContext } from './survivorCouncilService'
import { getCouncilShots } from './survivorShotInTheDark'
import { isCouncilReadComplete } from './survivorRevealGate'

/**
 * SURVIVOR VOTE TALLY (canonical Phase 3) — deterministic, no fabrication.
 *
 * Applies late-vote invalidation, Vote Shield blocks, Council Pass target safety, and Extra Vote
 * extra ballots; produces final counts, tie detection, a deterministic one-by-one reveal sequence,
 * and the eliminated candidate (only when there is a clean winner). Ties never auto-resolve — the
 * council enters `tie_pending` for a revote/commissioner tiebreak. Nothing is revealed to players
 * here; `revealCouncil` flips the public flag.
 */

export type BallotRevealStatus = 'counts' | 'late_does_not_count' | 'forfeited_by_shot' | 'blocked_by_idol' | 'blocked_by_shot' | 'target_safe' | 'taken_by_vote_steal'

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
  tiePhase: 'revote_required' | 'season_points_decided' | 'commissioner_tiebreak_required' | null
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
  if (council.isRevealed) return { ok: false, status: 409, code: 'already_revealed', error: 'The public read has already started.' }
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
  const councilShots = await getCouncilShots(leagueId, councilId)
  const shotUsers = new Set(councilShots.map(shot => shot.userId))
  const shotVoterRosters = new Set([...shotUsers].map(userId => ctx.userToRoster[userId]).filter((id): id is string => Boolean(id)))
  const shotProtectedRosters = new Set(
    councilShots.filter(shot => shot.success)
      .map(shot => ctx.userToRoster[shot.userId]).filter((id): id is string => Boolean(id)),
  )
  const safeRosters = new Set(ctx.scopePlayers.filter(player => !ctx.eligibility.targetUserIds.includes(player.userId)).map(player => player.rosterId))
  const extraBallots = council.idolsPlayed.filter((p) => (p.powerType === 'extra_vote' || p.powerType === 'vote_steal') && p.extraTargetUserId && !shotUsers.has(p.playerUserId))
  const stolenVoterRosters = new Set(council.idolsPlayed.filter((p) => p.powerType === 'vote_steal').map((p) => p.stolenVoterRosterId))

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
    if (shotVoterRosters.has(v.voterRosterId)) {
      status = 'forfeited_by_shot'
      doesNotCountVoteIds.push(v.id)
    } else if (stolenVoterRosters.has(v.voterRosterId)) {
      status = 'taken_by_vote_steal'
      doesNotCountVoteIds.push(v.id)
    } else if (v.doesNotCount || (v.isLateVote && (council.phase === 'revote' || !settings.lateVotesAllowed))) {
      status = 'late_does_not_count'
      doesNotCountVoteIds.push(v.id)
    } else if (protectedRosters.has(v.targetRosterId)) {
      status = 'blocked_by_idol'
      blockedByIdol = true
      doesNotCountVoteIds.push(v.id)
    } else if (shotProtectedRosters.has(v.targetRosterId)) {
      status = 'blocked_by_shot'
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
    } else if (shotProtectedRosters.has(targetRosterId)) {
      status = 'blocked_by_shot'
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

  let tiePhase: CouncilTally['tiePhase'] = isTie ? 'revote_required' : null
  let tieBreakSeasonPoints: Prisma.InputJsonValue | typeof Prisma.JsonNull = Prisma.JsonNull
  if (council.phase === 'revote' && targets.length === 0) {
    isTie = true
    tieUserIds = council.tiePlayerIds
  }
  if (isTie && (council.phase === 'revote' || settings.tieRule === 'season_points_only')) {
    const candidates = council.phase === 'revote' ? council.tiePlayerIds : tieUserIds
    const scoreRows = await prisma.survivorWeeklyScore.findMany({
      where: { leagueId, userId: { in: candidates }, week: { lte: council.week }, isFinalized: true },
      select: { userId: true, finalScore: true },
    })
    const totals = Object.fromEntries(candidates.map(userId => [userId, 0])) as Record<string, number>
    const seen = new Set<string>()
    for (const row of scoreRows) { totals[row.userId] += row.finalScore; seen.add(row.userId) }
    if (candidates.some(userId => !seen.has(userId))) {
      return { ok: false, status: 409, code: 'season_points_unavailable', error: 'Finalized season points are required before resolving this tie.' }
    }
    const lowest = Math.min(...candidates.map(userId => totals[userId]))
    const bottom = candidates.filter(userId => totals[userId] === lowest)
    tieBreakSeasonPoints = { totals, lowest, candidates } as Prisma.InputJsonValue
    if (bottom.length === 1) {
      eliminatedUserId = bottom[0]
      eliminatedRosterId = ctx.userToRoster[bottom[0]] ?? null
      eliminatedName = ctx.scopePlayers.find(player => player.userId === bottom[0])?.displayName ?? null
      isTie = false
      tiePhase = 'season_points_decided'
    } else {
      tieUserIds = bottom
      tiePhase = 'commissioner_tiebreak_required'
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
    tiePhase,
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
      tiePhase,
      status: isTie ? 'tie_pending' : 'closed',
      eliminatedRosterId,
      eliminatedUserId,
      eliminatedName,
      tieBreakSeasonPoints,
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

type CouncilRow = NonNullable<Awaited<ReturnType<Prisma.TransactionClient['survivorTribalCouncil']['findFirst']>>>

export const COUNCIL_VERDICT_ACTION = 'council_verdict_published'

/**
 * The verdict half of the ceremony: the ballot list and outcome in league chat, and the revote when the
 * vote is tied. It runs only once the read is complete (survivorRevealGate), so chat never runs ahead of
 * the scroll. Idempotent by audit marker; call inside a league-locked transaction.
 */
async function publishVerdictInTx(tx: Prisma.TransactionClient, leagueId: string, council: CouncilRow, now: Date): Promise<boolean> {
  const done = await tx.survivorAuditEntry.findFirst({ where: { leagueId, action: COUNCIL_VERDICT_ACTION, relatedEntityId: council.id }, select: { id: true } })
  if (done) return false
  const seq = Array.isArray(council.revealSequence) ? (council.revealSequence as unknown as RevealScroll[]) : []
  const channel = await tx.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
  const shotRows = await tx.survivorAuditEntry.findMany({ where: { leagueId, relatedEntityId: council.id, action: 'shot_in_the_dark_played' }, select: { actorUserId: true, data: true }, orderBy: { createdAt: 'asc' } })
  const shotNames = shotRows.length ? await tx.survivorPlayer.findMany({ where: { leagueId, userId: { in: shotRows.map(row => row.actorUserId).filter((id): id is string => Boolean(id)) } }, select: { userId: true, displayName: true } }) : []
  const names = new Map(shotNames.map(player => [player.userId, player.displayName]))
  const shotAnnouncement = shotRows.map(row => {
    const safe = row.data && typeof row.data === 'object' && !Array.isArray(row.data) && (row.data as Record<string, unknown>).success === true
    return `Shot in the Dark: ${names.get(row.actorUserId ?? '') ?? 'A manager'} drew ${safe ? 'Safe' : 'Not Safe'} and forfeited their vote.`
  }).join('\n')
  const ballots = seq.length ? seq.map((scroll, index) => `Ballot ${index + 1}: ${scroll.targetName ?? 'No eligible target'}${scroll.status === 'counts' ? '' : scroll.status === 'taken_by_vote_steal' ? ' (Taken — does not count)' : scroll.status === 'blocked_by_shot' ? ' (blocked by Shot in the Dark)' : scroll.status === 'forfeited_by_shot' ? ' (forfeited by Shot in the Dark)' : ' (does not count)'}.`).join('\n') : 'No ballots were cast.'
  const opensRevote = council.isTie && council.tiePhase === 'revote_required' && council.phase !== 'revote'
  const outcome = council.isTie ? opensRevote ? 'The vote is tied. Eligible managers have two hours to revote for the tied managers. Nobody leaves yet.' : 'The vote remains tied. An independent commissioner must decide the exact season-points tie.' : `${council.eliminatedName ?? 'The selected manager'} has been voted off the main island.${council.tiePhase === 'season_points_decided' ? ' The tiebreak used finalized season points.' : ''}`
  if (channel) {
    await tx.survivorChatMessage.create({ data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
      contentType: 'host_announcement', content: `Torch Ceremony · Week ${council.week}\n${shotAnnouncement ? `${shotAnnouncement}\n` : ''}${ballots}\n${outcome}` } })
  }
  if (opensRevote) {
    const deadline = new Date(now.getTime() + 2 * 60 * 60 * 1000)
    const revote = await tx.survivorTribalCouncil.create({
      data: { leagueId, configId: council.configId, week: council.week, councilNumber: council.councilNumber + 1, phase: 'revote', attendingTribeId: council.attendingTribeId,
        status: 'voting_open', votingOpensAt: now, votingDeadline: deadline, voteDeadlineAt: deadline, tiePlayerIds: council.tiePlayerIds, auditLog: { originalCouncilId: council.id } },
      select: { id: true },
    })
    await tx.survivorGameState.updateMany({ where: { leagueId, activeCouncilId: council.id }, data: { activeCouncilId: revote.id, tribalDeadline: deadline, tribalRevealAt: now, needsTribalLock: true } })
    const eligible = await tx.survivorPlayer.findMany({ where: { leagueId, playerState: 'active', ...(council.attendingTribeId ? { tribeId: council.attendingTribeId } : {}) }, select: { userId: true } })
    for (const player of eligible.filter(player => !council.tiePlayerIds.includes(player.userId))) {
      await tx.platformNotification.create({ data: { userId: player.userId, type: 'survivor:revote_open', title: 'A revote is open', body: 'You have two hours to message @Chimmy. Only tied managers are eligible targets.', severity: 'high', productType: 'sports', meta: { leagueId, councilId: revote.id, deepLinkPath: `/survivor/${leagueId}/tribal` } } })
    }
    await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'tribal', action: 'revote_opened', relatedEntityId: revote.id, relatedEntityType: 'council', data: { originalCouncilId: council.id, deadline: deadline.toISOString(), tiedCount: council.tiePlayerIds.length }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
  }
  await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'tribal', action: COUNCIL_VERDICT_ACTION,
    relatedEntityId: council.id, relatedEntityType: 'council', data: { eliminatedUserId: council.eliminatedUserId, isTie: council.isTie }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
  return true
}

export type VerdictOutcome =
  | { ok: true; complete: false }
  | { ok: true; complete: true; published: boolean; isTie: boolean; eliminatedUserId: string | null }
  | { ok: false; status: 404; code: string; error: string }

/** Publish the verdict once the last ballot has been released. Safe to call repeatedly (cron, reveal_next). */
export async function publishCouncilVerdictIfComplete(leagueId: string, councilId: string, now: Date = new Date()): Promise<VerdictOutcome> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<VerdictOutcome> => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const council = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId } })
    if (!council) return { ok: false, status: 404, code: 'not_found', error: 'Council not found.' }
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { survivorRevealMode: true } })
    if (!isCouncilReadComplete(council, league?.survivorRevealMode, now)) return { ok: true, complete: false }
    const published = await publishVerdictInTx(tx, leagueId, council, now)
    return { ok: true, complete: true, published, isTie: council.isTie, eliminatedUserId: council.eliminatedUserId }
  }, { timeout: 30_000, maxWait: 10_000 })
}

/**
 * Open the public read. Nothing that names a ballot or the outcome is published here unless the read is
 * already complete (all-at-once pacing): league chat gets a spoiler-free opener, and the verdict follows
 * through publishCouncilVerdictIfComplete when the last step is released. Retries never announce twice.
 */
export async function revealCouncil(leagueId: string, councilId: string, actorUserId?: string): Promise<RevealOutcome> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient): Promise<RevealOutcome> => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`survivor-setup:${leagueId}`}, 0))::text`
    const game = await tx.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
    if (game?.pausedSnapshot != null) return { ok: false, status: 409, code: 'league_paused', error: 'The league is paused.' }
    const council = await tx.survivorTribalCouncil.findFirst({ where: { id: councilId, leagueId } })
    if (!council) return { ok: false, status: 404, code: 'not_found', error: 'Council not found.' }
    const seq = Array.isArray(council.revealSequence) ? (council.revealSequence as unknown as RevealScroll[]) : []
    const result = { councilId, revealSequence: seq, eliminatedUserId: council.eliminatedUserId, eliminatedName: council.eliminatedName, isTie: council.isTie }
    if (council.isRevealed) return { ok: true, alreadyRevealed: true, ...result }
    const emptyButResolvedRevote = council.phase === 'revote' && (Boolean(council.eliminatedUserId) || council.tiePhase === 'commissioner_tiebreak_required')
    if (!['closed', 'tie_pending', 'voting_closed'].includes(council.status) || (seq.length === 0 && !emptyButResolvedRevote && !(council.tiePhase === 'system_score_fallback' && council.eliminatedUserId))) {
      return { ok: false, status: 409, code: 'not_tallied', error: 'Close and tally the council before revealing.' }
    }
    const channel = await tx.survivorChatChannel.findFirst({ where: { leagueId, channelType: 'league', isArchived: false }, select: { id: true } })
    if (!channel) return { ok: false, status: 409, code: 'chat_missing', error: 'Restore league chat before publishing the Torch Ceremony.' }
    await tx.survivorChatMessage.create({ data: { leagueId, channelId: channel.id, channelType: 'league', senderUserId: 'survivor-host-chimmy', senderName: 'Chimmy', senderIsHost: true, isSystemMessage: true,
      contentType: 'host_announcement', content: `Torch Ceremony · Week ${council.week}\nThe votes are in and the scroll is open. Read along on the Tribal Council page.` } })
    const now = new Date()
    await tx.survivorTribalCouncil.update({ where: { id: councilId }, data: { isRevealed: true, revealStartsAt: now, status: council.isTie ? 'tie_pending' : 'revealed' } })
    // The existing notification worker delivers this after the public read commits.
    // The idempotent reveal gate also prevents duplicate notifications on retries.
    await tx.survivorNotification.create({ data: {
      leagueId, type: 'council_read', recipientRole: 'all', title: 'The scroll is being read',
      body: `Week ${council.week} Council is ready to view.`, deepLinkPath: `/survivor/${leagueId}/tribal`,
      urgency: 'high', isSpoilerSafe: true, scheduledFor: now, status: 'pending',
    } })
    const opensRevote = council.isTie && council.tiePhase === 'revote_required' && council.phase !== 'revote'
    if (!opensRevote) await tx.survivorGameState.updateMany({ where: { leagueId, activeCouncilId: councilId }, data: { tribalRevealAt: now } })
    // No outcome in this entry: it is public, and the read has only just started.
    await tx.survivorAuditEntry.create({ data: { leagueId, week: council.week, category: 'tribal', action: 'votes_revealed', actorUserId: actorUserId ?? null,
      relatedEntityId: councilId, relatedEntityType: 'council', data: { ballots: seq.length }, isVisibleToCommissioner: true, isVisibleToPublic: true } })
    const league = await tx.league.findUnique({ where: { id: leagueId }, select: { survivorRevealMode: true } })
    const openedRow = { ...council, isRevealed: true, revealStartsAt: now }
    if (isCouncilReadComplete(openedRow, league?.survivorRevealMode, now)) await publishVerdictInTx(tx, leagueId, openedRow, now)
    return { ok: true, alreadyRevealed: false, ...result }
  }, { timeout: 30_000, maxWait: 10_000 })
}
