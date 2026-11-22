import 'server-only'

import { prisma } from '@/lib/prisma'
import type { SurvivorAccessContext } from './survivorAccessControl'
import { loadCouncilContext, getLatestCouncil } from './survivorCouncilService'
import { getPlayableIdolsForUser } from './survivorIdolResolutionService'
import { gateRevealPayload, type PublicRevealStep } from './survivorRevealGate'

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
  /** When ballots are due (votesDueHoursBeforeCeremony); the deadline itself when no earlier time is set. */
  ballotsDueAt?: string | null
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
    /** True while the league lets a ballot be changed until votes close. */
    voteChangeAllowed?: boolean
  }
  /**
   * Public ballot sheet for the vote screen: who is at council, this week's score, and public
   * immunity only. Never another manager's ballot or any idol effect.
   */
  ballot?: {
    selfVotesAllowed: boolean
    candidates: Array<{ userId: string; rosterId: string; displayName: string; weekScore: number | null; isSelf: boolean; isImmune: boolean; canReceiveYourVote: boolean }>
  } | null
  /** Count-only progress for every viewer: "N of M managers have voted". No names, no targets. */
  votesIn?: { submittedCount: number; eligibleVoterCount: number } | null
  host: { eligibleVoterCount: number; submittedCount: number; missingVoteCount: number } | null
  revote: { candidates: Array<{ userId: string; displayName: string; firstRoundVotes: number }>; deadline: string; originalCouncilId: string | null } | null
  /** Gated read: only the steps released so far, and the verdict only once every step is out. */
  reveal: {
    revealSequence: PublicRevealStep[]
    countsByTargetName: Record<string, number>
    eliminatedName: string | null
    isTie: boolean
    tiePhase: string | null
    mode: 'one_at_a_time' | 'all_at_once'
    totalSteps: number
    visibleSteps: number
    complete: boolean
    nextStepAt: string | null
    exileEnabled: boolean
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
  ballot: null,
  votesIn: null,
  host: null,
  revote: null,
  reveal: null,
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

/** This week's public score per manager. Scores are public; a missing table or row reads as null. */
async function loadWeekScores(leagueId: string, week: number, userIds: string[]): Promise<Map<string, number>> {
  try {
    const rows = await prisma.survivorWeeklyScore.findMany({ where: { leagueId, week, userId: { in: userIds } }, select: { userId: true, finalScore: true } })
    return new Map(rows.map((row) => [row.userId, row.finalScore]))
  } catch {
    return new Map()
  }
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

  // Count-only progress while the ballot is open: every viewer sees "N of M managers have voted".
  // Counted over current eligible voters only, so nothing about who voted or for whom leaks.
  let votesIn: TribalCouncilView['votesIn'] = null
  if (!council.isRevealed && ['voting_open', 'closed', 'voting_closed', 'tie_pending'].includes(council.status)) {
    const eligibleVoterCount = eligibility.voterUserIds.length
    const counted = await prisma.survivorVote.count({ where: { councilId: council.id, doesNotCount: false, voterUserId: { in: eligibility.voterUserIds } } })
    votesIn = { submittedCount: Math.min(eligibleVoterCount, Number(counted) || 0), eligibleVoterCount }
  }

  const immune = new Set(ctx.immuneUserIds ?? [])
  const weekScores = await loadWeekScores(access.leagueId, council.week, scopePlayers.map((p) => p.userId))
  const ballot: TribalCouncilView['ballot'] = {
    selfVotesAllowed: Boolean(access.settings.selfVotesAllowed),
    candidates: scopePlayers.map((p) => ({
      userId: p.userId,
      rosterId: p.rosterId,
      displayName: p.displayName,
      weekScore: weekScores.get(p.userId) ?? null,
      isSelf: p.userId === userId,
      isImmune: immune.has(p.userId),
      canReceiveYourVote: eligibleTargetUserIds.includes(p.userId),
    })),
  }

  // Host operational view: missing-vote count only (no ballot contents), full hosts only.
  let host: TribalCouncilView['host'] = null
  if (isHostViewer) {
    const submittedCount = await prisma.survivorVote.count({ where: { councilId: council.id, doesNotCount: false } })
    const eligibleVoterCount = eligibility.voterUserIds.length
    host = { eligibleVoterCount, submittedCount, missingVoteCount: Math.max(0, eligibleVoterCount - submittedCount) }
  }

  // The scroll stays sealed for every client until the read, including non-playing hosts, and the
  // read itself is released step by step (see survivorRevealGate).
  let reveal: TribalCouncilView['reveal'] = null
  let readStarted = false
  if (council.isRevealed) {
    const [full, league] = await Promise.all([
      prisma.survivorTribalCouncil.findUnique({
        where: { id: council.id },
        select: { revealSequence: true, revealStartsAt: true, revealStep: true, eliminatedName: true, isTie: true, tiePhase: true },
      }),
      prisma.league.findUnique({ where: { id: access.leagueId }, select: { survivorRevealMode: true } }),
    ])
    const gate = gateRevealPayload({
      isRevealed: true,
      revealStartsAt: full?.revealStartsAt ?? null,
      revealStep: full?.revealStep ?? 0,
      revealSequence: full?.revealSequence,
      revealMode: league?.survivorRevealMode,
      eliminatedName: full?.eliminatedName ?? null,
      isTie: Boolean(full?.isTie),
      tiePhase: full?.tiePhase ?? null,
    })
    readStarted = gate.started
    if (gate.started) {
      const countsByTargetName: Record<string, number> = {}
      for (const s of gate.steps) {
        if (s.status === 'counts' && s.targetName) countsByTargetName[s.targetName] = (countsByTargetName[s.targetName] ?? 0) + 1
      }
      reveal = {
        revealSequence: gate.steps,
        countsByTargetName,
        eliminatedName: gate.eliminatedName,
        isTie: gate.isTie,
        tiePhase: gate.tiePhase,
        mode: gate.mode,
        totalSteps: gate.totalSteps ?? 0,
        visibleSteps: gate.visibleSteps,
        complete: gate.complete,
        nextStepAt: gate.nextStepAt,
        exileEnabled: access.settings.exileIslandEnabled !== false,
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
    // Ballots may be due before the ceremony (votesDueHoursBeforeCeremony); equal to the deadline when not.
    ballotsDueAt: iso(ctx.ballotsDueAt ?? council.voteDeadlineAt),
    isRevealed: readStarted,
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
      voteChangeAllowed: access.settings.voteChangePolicy !== 'first_valid_locks',
    },
    ballot,
    votesIn,
    host,
    revote,
    reveal,
  }
}
