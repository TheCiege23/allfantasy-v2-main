/**
 * Tribal council flow: open, vote, lock, tally, tie-break, scroll reveal metadata.
 */

import { prisma } from '@/lib/prisma'
import { createCouncil } from './SurvivorTribalCouncilService'
import { closeVoteWindow } from './survivorCouncilService'
import { revealCouncil, tallyCouncil } from './survivorVoteTallyService'
import { resolveAutonomousCouncil } from './survivorAutonomousCouncil'
import { finishCouncilReadIfComplete } from './survivorCouncilReadFinish'
import {
  submitVote as submitVoteCore,
  tallyVotes,
} from './SurvivorVoteEngine'
import { postHostMessage } from './hostEngine'
import { logSurvivorAuditEntry } from './auditEntry'
import { getEligibleRosterIdsForCouncil } from './SurvivorCouncilEligibility'
import { getWeeklyEffectState } from './SurvivorEffectEngine'

export type ScrollRevealStep =
  | { type: 'vote'; voterName: string; targetName: string }
  | { type: 'pause' }
  | { type: 'does_not_count'; voterName: string }
  | { type: 'elimination'; userName: string }
  | { type: 'idol_play'; powerLabel: string }

export type ScrollRevealSequence = ScrollRevealStep[]

export type TallyResult =
  | { eliminated: string | null; isTie: false; tiedUserIds?: undefined }
  | { isTie: true; tiedUserIds: string[]; eliminated?: undefined }

export async function openTribalCouncil(
  leagueId: string,
  week: number,
  tribeId: string | null,
  deadline: Date,
): Promise<{ id: string }> {
  const phase = tribeId ? 'pre_merge' : 'merge'
  const created = await createCouncil(leagueId, week, phase, tribeId, deadline)
  if (!created.ok || !created.councilId) throw new Error(created.error ?? 'Could not open council')

  await prisma.survivorTribalCouncil.update({
    where: { id: created.councilId },
    data: {
      status: 'voting_open',
      votingOpensAt: new Date(),
      votingDeadline: deadline,
    },
  })

  await postHostMessage(
    leagueId,
    'tribal_announcement',
    { week, tribeId, deadline: deadline.toISOString() },
    'league_chat',
    tribeId ?? undefined,
  ).catch(() => {})

  await logSurvivorAuditEntry({
    leagueId,
    week,
    category: 'tribal',
    action: 'TRIBAL_OPENED',
    targetTribeId: tribeId ?? null,
    relatedEntityId: created.councilId,
    relatedEntityType: 'council',
    data: { councilId: created.councilId, tribeId, week, deadline: deadline.toISOString() },
    isVisibleToPublic: true,
  })

  return { id: created.councilId }
}

export async function submitVote(
  councilId: string,
  voterUserId: string,
  targetUserId: string,
  rosterPair?: { voterRosterId: string; targetRosterId: string },
): Promise<{ id: string }> {
  const council = await prisma.survivorTribalCouncil.findUnique({ where: { id: councilId } })
  if (!council || council.status !== 'voting_open') {
    throw new Error('Voting is not open for this council')
  }
  if (council.votingDeadline && new Date() > council.votingDeadline) {
    throw new Error('Vote deadline passed')
  }

  if (!rosterPair) {
    throw new Error('Roster mapping required — link user to redraft roster for this league')
  }

  // One ballot per voter per council (double_vote idol needs ledger + tally support for a second counting vote).
  const prior = await prisma.survivorVote.findUnique({
    where: { councilId_voterRosterId: { councilId, voterRosterId: rosterPair.voterRosterId } },
  })
  if (prior && !prior.isDoubleVote) {
    const err = new Error('409_CONFLICT: A vote was already recorded for this council.')
    throw err
  }

  const out = await submitVoteCore(councilId, rosterPair.voterRosterId, rosterPair.targetRosterId)
  if (!out.ok) throw new Error(out.error ?? 'Vote rejected')

  const vote = await prisma.survivorVote.findUnique({
    where: { councilId_voterRosterId: { councilId, voterRosterId: rosterPair.voterRosterId } },
  })
  if (vote) {
    await prisma.survivorVote.update({
      where: { id: vote.id },
      data: {
        voterUserId,
        targetUserId,
        leagueId: council.leagueId,
        submittedAt: new Date(),
      },
    })
  }

  const saved = await prisma.survivorVote.findUnique({
    where: { councilId_voterRosterId: { councilId, voterRosterId: rosterPair.voterRosterId } },
  })
  if (!saved?.id) throw new Error('Vote not persisted')

  await logSurvivorAuditEntry({
    leagueId: council.leagueId,
    week: council.week,
    category: 'vote',
    action: 'VOTE_SUBMITTED',
    actorUserId: voterUserId,
    targetUserId,
    relatedEntityId: saved.id,
    relatedEntityType: 'vote',
    data: {
      voteId: saved.id,
      councilId,
      submittedAt: new Date().toISOString(),
      voterUserId,
      targetUserId,
    },
    isVisibleToPublic: false,
  })

  return { id: saved.id }
}

export type LockVotingOutcome =
  | { ok: true; readOpened: boolean; complete: boolean }
  | { ok: false; code: string; error: string }

/**
 * Close voting and open the public read the canonical way: close the window (late-vote policy), tally
 * into a server-ordered reveal sequence, publish the read (revealStartsAt), then finish it — verdict in
 * league chat and the elimination — only once the last ballot has been released. Before that nothing
 * names the voted-out manager; the automation tick or reveal_next finishes the read later.
 */
export async function lockVoting(councilId: string): Promise<LockVotingOutcome> {
  const council = await prisma.survivorTribalCouncil.findUnique({ where: { id: councilId } })
  if (!council) throw new Error('Council not found')
  const { leagueId } = council

  if (!council.isRevealed) {
    const votes = await prisma.survivorVote.findMany({ where: { councilId } })
    const lateVotes = votes.filter((v) => v.isLateVote).length
    await logSurvivorAuditEntry({
      leagueId,
      week: council.week,
      category: 'vote',
      action: 'VOTE_LOCKED',
      relatedEntityId: councilId,
      relatedEntityType: 'council',
      data: { councilId, totalVotes: votes.length, lateVotes },
      isVisibleToPublic: false,
    })
    await processIdolPlays(councilId)

    const closed = await closeVoteWindow(leagueId, councilId)
    if (!closed.ok) return { ok: false, code: closed.code, error: closed.error }
    const latest = await prisma.survivorTribalCouncil.findUnique({ where: { id: councilId }, select: { revealSequence: true, eliminatedUserId: true } })
    if (!latest?.eliminatedUserId && (!Array.isArray(latest?.revealSequence) || latest.revealSequence.length === 0)) {
      const tallied = await tallyCouncil(leagueId, councilId)
      if (!tallied.ok) return { ok: false, code: tallied.code, error: tallied.error }
    }
    await resolveAutonomousCouncil(leagueId, councilId)
    const revealed = await revealCouncil(leagueId, councilId)
    // Closed and tallied but still sealed (e.g. league chat missing): a host publishes it later.
    if (!revealed.ok) return { ok: false, code: revealed.code, error: revealed.error }
  }

  const finished = await finishCouncilReadIfComplete(leagueId, councilId)
  if (!finished.ok) return { ok: false, code: finished.code, error: finished.error }
  return { ok: true, readOpened: true, complete: finished.complete }
}

export async function processIdolPlays(councilId: string): Promise<void> {
  const playedIdols = await prisma.survivorIdol.findMany({
    where: { usedAtCouncilId: councilId, isUsed: true, powerCategory: 'immunity' },
    select: { id: true, currentOwnerUserId: true, powerType: true },
  })
  if (!playedIdols.length) return

  for (const idol of playedIdols) {
    if (!idol.currentOwnerUserId) continue
    // Void all votes targeting the idol holder
    const votes = await prisma.survivorVote.findMany({
      where: { councilId, targetUserId: idol.currentOwnerUserId, doesNotCount: false },
    })
    for (const vote of votes) {
      await prisma.survivorVote.update({
        where: { id: vote.id },
        data: { doesNotCount: true, nullifiedBy: idol.id },
      })
    }
  }
}

export async function tallyVotesForCouncil(councilId: string): Promise<TallyResult> {
  const tally = await tallyVotes(councilId)
  const entries = Object.entries(tally.votesByTarget).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return { eliminated: null, isTie: false }
  const top = entries[0]![1]
  const tied = entries.filter(([, c]) => c === top).map(([id]) => id)
  if (tied.length > 1) return { isTie: true, tiedUserIds: tied }
  return { eliminated: tied[0] ?? null, isTie: false }
}

export async function handleTie(_councilId: string, _tiedUserIds: string[]): Promise<void> {
  // Commissioner / rocks / fire-making — wired in fairness + commissioner routes.
}

export async function eliminatePlayer(_councilId: string, _userId: string): Promise<void> {
  // Elimination runs through finishCouncilReadIfComplete once the council read is complete.
}

/**
 * Players eligible to draw rocks: attending council, not immune this week, not part of the active tie block.
 */
export async function getRocksEligibleRosterIds(
  councilId: string,
  tiedRosterIds: string[],
): Promise<string[]> {
  const council = await prisma.survivorTribalCouncil.findUnique({
    where: { id: councilId },
    select: { leagueId: true, week: true },
  })
  if (!council) return []

  const league = await prisma.league.findUnique({
    where: { id: council.leagueId },
    select: { survivorRocksEnabled: true },
  })
  if (league?.survivorRocksEnabled === false) return []

  const weekly = await getWeeklyEffectState(council.leagueId, council.week)
  const attending = await getEligibleRosterIdsForCouncil(councilId)
  const tied = new Set(tiedRosterIds)
  return attending.filter((rid) => !weekly.protectedRosterIds.has(rid) && !tied.has(rid))
}

export async function buildScrollRevealSequence(councilId: string): Promise<ScrollRevealSequence> {
  const votes = await prisma.survivorVote.findMany({ where: { councilId } })
  const seq: ScrollRevealSequence = []
  for (const v of votes) {
    if (v.doesNotCount) {
      seq.push({ type: 'does_not_count', voterName: v.voterName ?? v.voterRosterId })
    } else {
      seq.push({
        type: 'vote',
        voterName: v.voterName ?? v.voterRosterId,
        targetName: v.targetName ?? v.targetRosterId,
      })
    }
    if (seq.length % 3 === 0) seq.push({ type: 'pause' })
  }

  await prisma.survivorTribalCouncil.update({
    where: { id: councilId },
    data: { revealSequence: seq as object, isRevealed: false },
  })
  return seq
}
