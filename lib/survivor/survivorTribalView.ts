import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SurvivorAccessContext } from './survivorAccessControl'
import { loadCouncilContext, getLatestCouncil } from './survivorCouncilService'
import { getPlayableIdolsForUser } from './survivorIdolResolutionService'
import type { RevealScroll } from './survivorVoteTallyService'

/**
 * SURVIVOR TRIBAL COUNCIL VIEW (canonical Phase 3, privacy-aware).
 *
 * Builds the per-user council/vote/reveal slice of the Survivor state. It exposes only what the
 * acting user is allowed to see: their own ballot confirmation, their own eligible targets and
 * playable idols, the operational missing-vote count for full hosts only, and the public reveal
 * payload after reveal. It NEVER exposes other users' private ballots, hidden idol plays, or a
 * pre-reveal tally to a participating commissioner.
 */

export interface TribalCouncilView {
  active: boolean
  councilId: string | null
  status: string | null
  phase: string | null
  week: number | null
  attendingTribeId: string | null
  votingOpensAt: string | null
  votingDeadline: string | null
  isRevealed: boolean
  you: {
    isEligibleVoter: boolean
    hasVoted: boolean
    yourVoteTargetUserId: string | null
    yourVoteTargetName: string | null
    voteLocked: boolean
    voteLate: boolean
    voteDoesNotCount: boolean
    eligibleTargets: Array<{ userId: string; displayName: string }>
    playableIdols: Array<{ idolId: string; powerType: string; label: string; alreadyPlayed: boolean }>
    additionalVotes?: Array<{ idolId: string; targetName: string | null; locked: boolean }>
    isSafeFromVote: boolean
  }
  host: { eligibleVoterCount: number; submittedCount: number; missingVoteCount: number } | null
  revote: { candidates: Array<{ userId: string; displayName: string; firstRoundVotes: number }>; deadline: string; originalCouncilId: string | null } | null
  reveal: {
    revealSequence: RevealScroll[]
    countsByTargetName: Record<string, number>
    eliminatedName: string | null
    isTie: boolean
    tiePhase: string | null
  } | null
}

const EMPTY: TribalCouncilView = {
  active: false,
  councilId: null,
  status: null,
  phase: null,
  week: null,
  attendingTribeId: null,
  votingOpensAt: null,
  votingDeadline: null,
  isRevealed: false,
  you: {
    isEligibleVoter: false,
    hasVoted: false,
    yourVoteTargetUserId: null,
    yourVoteTargetName: null,
    voteLocked: false,
    voteLate: false,
    voteDoesNotCount: false,
    eligibleTargets: [],
    playableIdols: [],
    isSafeFromVote: false,
  },
  host: null,
  revote: null,
  reveal: null,
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

export async function buildTribalCouncilView(access: SurvivorAccessContext): Promise<TribalCouncilView> {
  // Prefer the active council; after reveal it leaves the active set, so fall back to the latest
  // council so players still see the reveal result until a new council opens.
  let ctx = await loadCouncilContext(access.leagueId)
  if (!ctx) {
    const latest = await getLatestCouncil(access.leagueId)
    if (latest) ctx = await loadCouncilContext(access.leagueId, latest.id)
  }
  if (!ctx) return EMPTY
  const { council, eligibility, scopePlayers, userToRoster } = ctx
  const userId = access.userId
  const isHostViewer = access.decisions.canSeeVoteTallyBeforeReveal

  // The acting user's own ballot only.
  const ownRosterId = userToRoster[userId]
  const ownVote = ownRosterId
    ? await prisma.survivorVote.findUnique({
        where: { councilId_voterRosterId: { councilId: council.id, voterRosterId: ownRosterId } },
        select: { targetUserId: true, targetName: true, doesNotCount: true, isLateVote: true },
      })
    : null

  const eligibleTargetUserIds = eligibility.targetsByVoter[userId] ?? []
  const nameByUser = new Map(scopePlayers.map((p) => [p.userId, p.displayName]))
  const eligibleTargets = eligibleTargetUserIds.map((u) => ({ userId: u, displayName: nameByUser.get(u) ?? u }))
  const isSafeFromVote = council.idolsPlayed.some((p) => p.powerType === 'skip_tribal' && p.playerUserId === userId)

  const playableIdols = await getPlayableIdolsForUser(access.leagueId, userId)

  let revote: TribalCouncilView['revote'] = null
  if (council.phase === 'revote') {
    const original = await prisma.survivorTribalCouncil.findFirst({
      where: { leagueId: access.leagueId, week: council.week, councilNumber: { lt: (await prisma.survivorTribalCouncil.findUnique({ where: { id: council.id }, select: { councilNumber: true } }))?.councilNumber ?? 1 }, isRevealed: true },
      orderBy: { councilNumber: 'desc' }, select: { id: true, revealSequence: true },
    })
    const firstScroll = Array.isArray(original?.revealSequence) ? original.revealSequence as Array<{ targetUserId?: string; status?: string }> : []
    revote = { candidates: council.tiePlayerIds.map(candidateId => ({ userId: candidateId, displayName: nameByUser.get(candidateId) ?? 'Manager', firstRoundVotes: firstScroll.filter(scroll => scroll.targetUserId === candidateId && scroll.status === 'counts').length })), deadline: council.voteDeadlineAt.toISOString(), originalCouncilId: original?.id ?? null }
  }

  // Host operational view: missing-vote count only (no ballot contents), full hosts only.
  let host: TribalCouncilView['host'] = null
  if (isHostViewer) {
    const submittedCount = await prisma.survivorVote.count({ where: { councilId: council.id, doesNotCount: false } })
    const eligibleVoterCount = eligibility.voterUserIds.length
    host = { eligibleVoterCount, submittedCount, missingVoteCount: Math.max(0, eligibleVoterCount - submittedCount) }
  }

  // The scroll stays sealed for every client until the read, including non-playing hosts.
  let reveal: TribalCouncilView['reveal'] = null
  if (council.isRevealed) {
    const full = await prisma.survivorTribalCouncil.findUnique({
      where: { id: council.id },
      select: { revealSequence: true, eliminatedName: true, isTie: true, tiePhase: true },
    })
    const seq = Array.isArray(full?.revealSequence) ? (full!.revealSequence as unknown as RevealScroll[]) : []
    if (seq.length > 0 || council.isRevealed) {
      const countsByTargetName: Record<string, number> = {}
      for (const s of seq) {
        if (s.status === 'counts' && s.targetName) countsByTargetName[s.targetName] = (countsByTargetName[s.targetName] ?? 0) + 1
      }
      reveal = {
        revealSequence: seq,
        countsByTargetName,
        eliminatedName: full?.eliminatedName ?? null,
        isTie: Boolean(full?.isTie),
        tiePhase: full?.tiePhase ?? null,
      }
    }
  }

  return {
    active: council.status !== 'cancelled',
    councilId: council.id,
    status: council.status,
    phase: council.phase,
    week: council.week,
    attendingTribeId: council.attendingTribeId,
    votingOpensAt: iso(council.votingOpensAt),
    votingDeadline: iso(council.votingDeadline ?? council.voteDeadlineAt),
    isRevealed: council.isRevealed,
    you: {
      isEligibleVoter: eligibility.voterUserIds.includes(userId),
      hasVoted: Boolean(ownVote),
      yourVoteTargetUserId: ownVote?.targetUserId ?? null,
      yourVoteTargetName: ownVote?.targetName ?? null,
      voteLocked: Boolean(ownVote) && !ownVote?.doesNotCount && access.settings.voteChangePolicy === 'first_valid_locks',
      voteLate: Boolean(ownVote?.isLateVote),
      voteDoesNotCount: Boolean(ownVote?.doesNotCount),
      eligibleTargets,
      playableIdols,
      additionalVotes: council.idolsPlayed.filter(p => p.playerUserId === userId && ['vote_steal', 'extra_vote'].includes(p.powerType)).map(p => ({ idolId: p.idolId, targetName: p.extraTargetUserId ? nameByUser.get(p.extraTargetUserId) ?? null : null, locked: Boolean(p.extraTargetUserId) && access.settings.voteChangePolicy === 'first_valid_locks' })),
      isSafeFromVote,
    },
    host,
    revote,
    reveal,
  }
}
