import { acceptedCoOwnerRosterId } from '@/lib/team-coowners/access'
import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { hasLeagueCommissionerRights } from '@/lib/league/permissions'
import { assertLeagueMember } from '@/lib/league/league-access'
import { refreshCapProjections } from '@/lib/idp/capEngine'
import { evaluateNativeTradeReversalReadiness, reverseNativeTrade } from '@/lib/redraft/tradeReversal'
import { publishTradeReversalNotice } from '@/lib/trade-reversal/notice'
import { recordRedraftTradeMarketEvent } from '@/lib/trade-market/redraftTradeMarketEvents'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { recordTradeOutcomeForBothManagers } from '@/lib/ai-learning-system/recordTradeParticipants'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'
import { queueTradeStatusInDm } from '@/lib/chat-notifications/tradeOfferDm'
import { evaluateRedraftTradeDeadline, tradeDeadlinePassedMessage } from '@/lib/trade-deadline/tradeDeadlineWindow'
import {
  REDRAFT_MOVES_LOCKED_CODE,
  REDRAFT_MOVES_LOCKED_MESSAGE,
  REDRAFT_MOVES_LOCKED_STATUS,
  isRedraftLeagueMovesLocked,
} from '@/lib/redraft/tradeMoveLock'
import { postDraftRosterMoveRefusal } from '@/server/services/postDraftRosterLockService'
import {
  finalizeRedraftTrade,
  snapshotObject,
  upsertRedraftTradeDecision as upsertDecision,
  type ProposalWithAssets,
} from '@/lib/redraft/finalizeRedraftTrade'
import { reviewWindowEndsAt, reviewWindowEnded, tradeReviewWindowHours } from '@/lib/redraft/tradeReviewWindow'
import { shouldHoldAcceptedTrade } from '@/lib/integrity/holdFlaggedTrades'

export const dynamic = 'force-dynamic'

type TradeAction =
  | 'accept'
  | 'reject'
  | 'cancel'
  | 'commissioner_approve'
  | 'commissioner_veto'
  | 'vote_approve'
  | 'vote_veto'
  | 'commissioner_reverse_preflight'
  | 'commissioner_reverse'

async function finalizeAcceptedTrade(...args: Parameters<typeof finalizeRedraftTrade>) {
  const r = await finalizeRedraftTrade(...args)
  return r.ok ? NextResponse.json({ proposal: r.proposal, resolved: true }) : NextResponse.json({ error: r.error }, { status: r.status })
}

/** Owner, team commissioner / co-commissioner, or tournament co-commissioner (no team needed). */
function isCommissionerOrCo(leagueId: string, userId: string): Promise<boolean> {
  return hasLeagueCommissionerRights(leagueId, userId, 'trades')
}


/** A receipt id the client echoes back: kept only if it looks like one, never trusted as anything else. */
function reviewIdFrom(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : null
}

/**
 * 🛑 THE COMMISSIONER'S MOVE LOCK (`League.lockAllMoves`) — this route never read it, for any sport.
 *
 * Unlike the deadline, it binds at SETTLEMENT as well as at acceptance: a trade accepted before the lock may
 * not be approved or voted through while moves are frozen. Rejections and vetoes move nothing and stay open.
 * The code is the NFL trade runtime's `MOVE_LOCKED`. See lib/redraft/tradeMoveLock.ts.
 */
async function refuseIfMovesLocked(leagueId: string): Promise<NextResponse | null> {
  if (!(await isRedraftLeagueMovesLocked(leagueId))) return null
  return NextResponse.json(
    { error: REDRAFT_MOVES_LOCKED_MESSAGE, code: REDRAFT_MOVES_LOCKED_CODE },
    { status: REDRAFT_MOVES_LOCKED_STATUS },
  )
}

/** Record the commissioner review a decision was made with (design step 6: "decision logged"). */
async function noteCommissionerReview(proposalId: string, extra: Record<string, unknown>) {
  const existing = await prisma.redraftTradeDecision.findFirst({ where: { proposalId } }).catch(() => null)
  if (!existing) return
  await prisma.redraftTradeDecision
    .update({ where: { proposalId }, data: { snapshot: { ...snapshotObject(existing.snapshot), ...extra } as Prisma.InputJsonValue } })
    .catch(() => undefined)
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { proposalId?: string; action?: TradeAction; reason?: string; reviewId?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const proposalId = body.proposalId?.trim()
  const action = body.action
  if (!proposalId || !action) {
    return NextResponse.json({ error: 'proposalId and action required' }, { status: 400 })
  }

  const proposal = await prisma.redraftTradeProposal.findFirst({
    where: { id: proposalId },
    include: { votes: true, assets: true },
  })
  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })

  const gate = await assertLeagueMember(proposal.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  /*
   * REVERSAL, AND WHY IT SITS ABOVE THE `pending` CHECK BELOW.
   *
   * Every other action here acts on a proposal still awaiting a decision, so this route refuses any
   * non-pending proposal before it even reads the action. A reversal is the one action that targets
   * an ACCEPTED proposal — placed below that check, it could never run at all.
   *
   * Commissioner permission is computed here rather than reused: `isCommissioner` further down is
   * only evaluated after the pending and expiry checks, which a reversal never reaches.
   *
   * ⚠ This route has no certified game-evidence lock, unlike the generic process route. None is
   * invented here; if redraft settlement ever gains one, reversal must sit behind it too.
   */
  if (action === 'commissioner_reverse_preflight' || action === 'commissioner_reverse') {
    if (!(await isCommissionerOrCo(proposal.leagueId, userId))) {
      return NextResponse.json({ error: 'Commissioner access required' }, { status: 403 })
    }

    if (action === 'commissioner_reverse_preflight') {
      const readiness = await evaluateNativeTradeReversalReadiness(prisma, proposal.id)
      return NextResponse.json({ readiness })
    }

    const reason = String(body.reason ?? '').trim()
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required to reverse a trade.' }, { status: 400 })
    }

    let result
    try {
      result = await reverseNativeTrade({
        proposalId: proposal.id,
        actorUserId: userId,
        // The gate above already refused anyone who is not a commissioner or co-commissioner.
        actorRole: 'commissioner',
        reason,
      })
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Trade reversal failed', code: 'REVERSAL_FAILED' },
        { status: 409 },
      )
    }
    if (!result.ok) {
      return NextResponse.json(
        { error: 'Trade cannot be reversed', code: 'REVERSAL_BLOCKED', readiness: result.readiness },
        { status: 409 },
      )
    }

    // POST-COMMIT, same reason as settlement: IDPCapProjection is derived, and refreshing it inside
    // the transaction would publish projections for a reversal that could still roll back.
    if (result.capRecordsRestored > 0) {
      for (const rosterId of new Set(result.rosterIds)) {
        await refreshCapProjections(proposal.leagueId, rosterId).catch((e) =>
          console.error('[redraft/trade-votes] cap projection refresh after reversal failed', rosterId, e),
        )
      }
    }
    // POST-COMMIT AND BEST-EFFORT, after the projection refresh. The reversal has already committed; a
    // notice that fails must not turn it into an error response.
    await publishTradeReversalNotice({
      leagueId: proposal.leagueId,
      tradeId: proposal.id,
      noticeKey: result.noticeKey,
      engine: 'native',
      actorUserId: userId,
    }).catch((e) => console.error('[redraft/trade-votes] reversal notice failed', proposal.id, e))

    // `result` already carries `ok: true`; spreading it after a literal `ok` is a duplicate key (TS2783).
    return NextResponse.json(result)
  }

  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: 'Proposal is not pending', proposal }, { status: 409 })
  }

  /*
   * AN ACCEPTED TRADE PAST ITS REVIEW WINDOW IS GOING THROUGH (lib/redraft/tradeReviewWindow.ts).
   *
   * 🛑 THIS BRANCH USED TO EXPIRE IT. Below, any pending proposal past `expiresAt` is expired on the
   * next click — which, for a trade both managers had agreed to, meant a late veto vote or even an idle
   * click killed it. The window closing with no veto is the decision; the hourly sweep executes it. Until
   * then the commissioner may still approve (it settles now) — nothing else may change the outcome.
   */
  if (reviewWindowEnded(proposal, Date.now())) {
    if (action !== 'commissioner_approve') {
      return NextResponse.json(
        { error: 'The review window has ended with no veto. This trade is going through.', code: 'REVIEW_WINDOW_ENDED' },
        { status: 409 },
      )
    }
  } else if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) {
    const expired = await prisma.redraftTradeProposal.update({
      where: { id: proposal.id },
      data: { status: 'expired' },
    })
    await upsertDecision(proposal.id, 'expired', userId, 'Proposal expired before action')
    await recordRedraftTradeMarketEvent({
      leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
      eventType: 'proposal_expired', actorUserId: userId,
    })
    const expiredProposer = await prisma.redraftRoster.findFirst({
      where: { id: proposal.proposerRosterId },
      select: { ownerId: true },
    })
    const expiredProposerOwnerId = expiredProposer?.ownerId
    if (expiredProposerOwnerId) {
      void resolveLeagueSport(proposal.leagueId).then((sport) =>
        recordAfLearningEvent({
          eventType: 'trade_expired',
          sport,
          leagueId: proposal.leagueId,
          userId: expiredProposerOwnerId,
          source: 'redraft_trade_proposal',
          payload: { proposalId: proposal.id },
        }),
      )
    }
    queueTradeStatusInDm({ source: 'redraft', tradeId: proposal.id, status: 'expired' })
    return NextResponse.json({ proposal: expired, resolved: true })
  }

  const seasonRosters = await prisma.redraftRoster.findMany({
    where: { seasonId: proposal.seasonId },
    select: { id: true, ownerId: true },
  })
  const rosterById = new Map(seasonRosters.map((r) => [r.id, r]))
  const proposerOwnerId = rosterById.get(proposal.proposerRosterId)?.ownerId
  const receiverOwnerId = rosterById.get(proposal.receiverRosterId)?.ownerId
  const coOwnerRosterId = await acceptedCoOwnerRosterId(proposal.leagueId, userId)
  const coOwnerRoster = coOwnerRosterId ? await prisma.roster.findFirst({
    where: { id: coOwnerRosterId, leagueId: proposal.leagueId }, select: { redraftRosterId: true },
  }) : null
  const coOwnerRedraftId = coOwnerRoster?.redraftRosterId ?? null
  const isProposerOwner = proposerOwnerId === userId || proposal.proposerRosterId === coOwnerRedraftId
  const isReceiverOwner = receiverOwnerId === userId || proposal.receiverRosterId === coOwnerRedraftId
  const isCommissioner = await isCommissionerOrCo(proposal.leagueId, userId)

  if (action === 'cancel') {
    if (!isProposerOwner) {
      return NextResponse.json({ error: 'Only proposer can cancel' }, { status: 403 })
    }
    const cancelled = await prisma.redraftTradeProposal.update({
      where: { id: proposal.id },
      data: { status: 'cancelled', cancelledAt: new Date(), processedAt: new Date() },
    })
    await upsertDecision(proposal.id, 'cancelled', userId, body.reason)
    await recordRedraftTradeMarketEvent({
      leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
      eventType: 'proposal_canceled', actorUserId: userId,
    })
    if (proposerOwnerId) {
      void resolveLeagueSport(proposal.leagueId).then((sport) =>
        recordAfLearningEvent({
          eventType: 'trade_cancelled',
          sport,
          leagueId: proposal.leagueId,
          userId: proposerOwnerId,
          source: 'redraft_trade_proposal',
          payload: { proposalId: proposal.id },
        }),
      )
    }
    queueTradeStatusInDm({ source: 'redraft', tradeId: proposal.id, status: 'cancelled', actorUserId: userId })
    return NextResponse.json({ proposal: cancelled, resolved: true })
  }

  if (action === 'accept' || action === 'reject') {
    if (!isReceiverOwner) {
      return NextResponse.json({ error: 'Only receiver can accept/reject' }, { status: 403 })
    }
    if (action === 'accept') {
      /*
       * 🛑 ACCEPTANCE IS NOT APPROVAL. THIS SETTLED THE TRADE REGARDLESS OF `vetoMode`.
       *
       * `finalizeAcceptedTrade` moves players, FAAB and IDP cap. Calling it straight from the
       * receiver's accept meant a league that had configured commissioner review or a league vote
       * got neither: the trade executed the moment the receiver clicked accept, and the review
       * system it had turned on was decoration. A commissioner could veto only something that had
       * already happened.
       *
       * Only `no_veto` may settle here. Every other mode records the acceptance and waits.
       *
       * ⚠ STATUS DELIBERATELY STAYS `pending`, AND `acceptedAt` CARRIES THE STATE INSTEAD.
       * `finalizeAcceptedTrade` claims the row with `updateMany({ where: { status: 'pending' } })`
       * — that conditional claim is what stops two settlements racing. Inventing an
       * `accepted_pending_review` status would break the claim and would also hide the proposal
       * from any caller listing `?status=pending`, which is how the receiver's own screen finds
       * it. `acceptedAt` already exists on the model and means exactly this.
       */
      if (proposal.acceptedAt) {
        return NextResponse.json(
          { error: 'This trade has already been accepted and is awaiting review.' },
          { status: 409 },
        )
      }

      // The move lock first, as the trade runtime orders it ahead of the deadline.
      const lockedAtAccept = await refuseIfMovesLocked(proposal.leagueId)
      if (lockedAtAccept) return lockedAtAccept

      /*
       * 🛑 THE DEADLINE BINDS AT ACCEPTANCE, AND THIS PATH NEVER CHECKED IT. A proposal made before the
       * deadline could be accepted — and, under `no_veto`, settled — any week after it.
       *
       * ⚠ ONLY HERE, NOT AT SETTLEMENT. Commissioner approval and a league vote both require
       * `acceptedAt`, which only this gate writes, so a trade accepted before the deadline may finish
       * its review after it — what Sleeper and ESPN do. See lib/trade-deadline/tradeDeadlineWindow.ts.
       */
      const deadline = await evaluateRedraftTradeDeadline(proposal.leagueId)
      if (deadline.passed) {
        return NextResponse.json(
          { error: tradeDeadlinePassedMessage(deadline), code: 'TRADE_DEADLINE_PASSED' },
          { status: 409 },
        )
      }

      // Post-draft roster lock: an offer made before the draft ended cannot settle during it.
      // After the existing refusals (already accepted, deadline) so their behaviour is unchanged.
      const postDraftLock = await postDraftRosterMoveRefusal(proposal.leagueId, 'trade')
      if (postDraftLock) {
        return NextResponse.json(
          { error: postDraftLock.error, code: postDraftLock.code, unlocksAt: postDraftLock.unlocksAt },
          { status: postDraftLock.status },
        )
      }

      /*
       * "Hold flagged trades" (lib/integrity/holdFlaggedTrades.ts): checked now, before anything
       * settles. A flagged trade becomes a commissioner-review trade whatever the league's mode, and
       * the review sweep will not auto-pass it while its flag is open — the commissioner decides.
       */
      const holdLeague = await prisma.league.findUnique({ where: { id: proposal.leagueId }, select: { settings: true } })
      const held = await shouldHoldAcceptedTrade({
        leagueId: proposal.leagueId,
        settings: holdLeague?.settings,
        ref: { kind: 'redraft', proposalId: proposal.id },
      })
      if (held && proposal.vetoMode !== 'commissioner') {
        await prisma.redraftTradeProposal.updateMany({
          where: { id: proposal.id, status: 'pending', acceptedAt: null },
          data: { vetoMode: 'commissioner' },
        })
        proposal.vetoMode = 'commissioner'
      }

      if (proposal.vetoMode === 'no_veto') {
        return finalizeAcceptedTrade(proposal as ProposalWithAssets, proposerOwnerId, receiverOwnerId, userId, body.reason, 'proposal_accepted')
      }

      /*
       * Conditional on BOTH the status and `acceptedAt` being unset, so two simultaneous accepts
       * cannot both record one — the same reason the settlement claim is conditional.
       */
      /*
       * Acceptance opens the review window: `expiresAt` stops being the offer's deadline and becomes the
       * review's end. When it passes with no veto the sweep executes the trade (lib/redraft/tradeReviewWindowSweep.ts).
       */
      const acceptedAt = new Date()
      const windowLeague = await prisma.league.findUnique({ where: { id: proposal.leagueId }, select: { tradeReviewHours: true } })
      const claimedAccept = await prisma.redraftTradeProposal.updateMany({
        where: { id: proposal.id, status: 'pending', acceptedAt: null },
        data: { acceptedAt, expiresAt: reviewWindowEndsAt(acceptedAt, tradeReviewWindowHours(windowLeague?.tradeReviewHours)) },
      })
      if (claimedAccept.count === 0) {
        return NextResponse.json({ error: 'This trade is no longer awaiting your acceptance.' }, { status: 409 })
      }

      const awaitingReview = await prisma.redraftTradeProposal.findUnique({ where: { id: proposal.id } })
      /*
       * `accepted` is the RECEIVER'S decision, and it is true the moment he makes it — the
       * decision record captures who decided what, not whether the trade has settled. Settlement
       * records itself separately via the market event and the status claim.
       */
      await upsertDecision(proposal.id, 'accepted', userId, body.reason)
      await recordRedraftTradeMarketEvent({
        leagueId: proposal.leagueId,
        seasonId: proposal.seasonId,
        tradeProposalId: proposal.id,
        eventType: 'proposal_accepted',
        actorUserId: userId,
      })
      /*
       * `resolved: false` is the honest answer and the field callers already branch on: the
       * receiver has acted, the trade has NOT executed. Naming what it waits on lets the UI say
       * so instead of implying the deal is done.
       */
      queueTradeStatusInDm({
        source: 'redraft',
        tradeId: proposal.id,
        status: 'accepted',
        actorUserId: userId,
        detail: held
          ? 'The league integrity check flagged it, so it is held until the commissioner approves or vetoes it.'
          : proposal.vetoMode === 'league_vote'
            ? 'It goes to a league vote, and goes through when the review window ends unless the league vetoes it.'
            : 'It goes to commissioner review, and goes through when the review window ends unless the commissioner vetoes it.',
      })
      return NextResponse.json({
        proposal: awaitingReview,
        resolved: false,
        awaitingReview: proposal.vetoMode === 'league_vote' ? 'league_vote' : 'commissioner',
      })
    }

    const updated = await prisma.redraftTradeProposal.update({
      where: { id: proposal.id },
      data: { status: 'rejected', rejectedAt: new Date(), processedAt: new Date() },
    })
    await upsertDecision(proposal.id, 'rejected', userId, body.reason)
    await recordRedraftTradeMarketEvent({
      leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
      eventType: 'proposal_rejected', actorUserId: userId,
    })
    void recordTradeOutcomeForBothManagers({
      leagueId: proposal.leagueId,
      eventType: 'trade_rejected',
      proposerUserId: proposerOwnerId,
      receiverUserId: receiverOwnerId,
      payload: { proposalId: proposal.id, source: 'redraft_trade_proposal' },
    })
    queueTradeStatusInDm({ source: 'redraft', tradeId: proposal.id, status: 'rejected', actorUserId: userId })
    return NextResponse.json({ proposal: updated, resolved: true })
  }

  if (action === 'commissioner_approve' || action === 'commissioner_veto') {
    if (!isCommissioner) {
      return NextResponse.json({ error: 'Commissioner action required' }, { status: 403 })
    }
    if (action === 'commissioner_approve') {
      /*
       * 🛑 A COMMISSIONER MAY APPROVE A TRADE. HE MAY NOT MAKE IT ON THE RECEIVER'S BEHALF.
       *
       * This settled a proposal that was merely `pending`, so a commissioner could execute an
       * offer the other manager had never seen, let alone agreed to. Approval is the SECOND gate;
       * the receiver's acceptance is the first, and `acceptedAt` is what records it.
       */
      if (!proposal.acceptedAt) {
        return NextResponse.json(
          { error: 'The receiving manager has not accepted this trade yet — there is nothing to approve.' },
          { status: 409 },
        )
      }
      /*
       * ⚠ AND ONLY WHERE COMMISSIONER REVIEW IS THE CONFIGURED MODE. Approving a `league_vote`
       * trade by hand bypasses the vote exactly the way accept used to bypass review.
       */
      if (proposal.vetoMode !== 'commissioner') {
        return NextResponse.json(
          { error: `This league resolves trades by ${proposal.vetoMode}, not commissioner approval.` },
          { status: 409 },
        )
      }
      const lockedAtApproval = await refuseIfMovesLocked(proposal.leagueId)
      if (lockedAtApproval) return lockedAtApproval
      const approved = await finalizeAcceptedTrade(proposal as ProposalWithAssets, proposerOwnerId, receiverOwnerId, userId, body.reason, 'commissioner_approved', 'commissioner')
      await noteCommissionerReview(proposal.id, { commissionerDecision: 'approve', reviewId: reviewIdFrom(body.reviewId) })
      return approved
    }

    const updated = await prisma.redraftTradeProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'vetoed',
        processedAt: new Date(),
      },
    })
    await upsertDecision(proposal.id, 'vetoed', userId, body.reason, { commissionerDecision: 'veto', reviewId: reviewIdFrom(body.reviewId) })
    await recordRedraftTradeMarketEvent({
      leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
      eventType: 'commissioner_vetoed', actorUserId: userId,
    })
    void recordTradeOutcomeForBothManagers({
      leagueId: proposal.leagueId,
      eventType: 'trade_vetoed',
      proposerUserId: proposerOwnerId,
      receiverUserId: receiverOwnerId,
      payload: { proposalId: proposal.id, source: 'redraft_trade_proposal' },
    })
    queueTradeStatusInDm({ source: 'redraft', tradeId: proposal.id, status: 'vetoed', detail: 'The commissioner made the call.' })
    return NextResponse.json({ proposal: updated, resolved: true })
  }

  if (action === 'vote_approve' || action === 'vote_veto') {
    if (proposal.vetoMode !== 'league_vote') {
      return NextResponse.json({ error: 'League vote mode not enabled for this proposal' }, { status: 409 })
    }
    /*
     * 🛑 A LEAGUE CANNOT VOTE A TRADE THROUGH THAT NOBODY AGREED TO.
     *
     * Votes were accepted while the proposal was still `pending`, and reaching the approval
     * threshold calls `finalizeAcceptedTrade` — so a league could execute an offer the receiving
     * manager had never accepted, or had been about to reject. The vote decides whether an agreed
     * trade STANDS; it is not a substitute for the agreement.
     */
    if (!proposal.acceptedAt) {
      return NextResponse.json(
        { error: 'Voting opens once the receiving manager accepts this trade.' },
        { status: 409 },
      )
    }
    if (isProposerOwner || isReceiverOwner) {
      return NextResponse.json({ error: 'Trade parties cannot vote on their own proposal' }, { status: 403 })
    }

    // An approve vote can be the one that settles the trade, so it is refused before it is recorded. A veto
    // vote moves nothing and stays open.
    if (action === 'vote_approve') {
      const lockedAtVote = await refuseIfMovesLocked(proposal.leagueId)
      if (lockedAtVote) return lockedAtVote
    }

    const voteValue = action === 'vote_approve' ? 'approve' : 'veto'
    const voterRoster = seasonRosters.find((r) => r.ownerId === userId || r.id === coOwnerRedraftId)
    const existingVote = await prisma.redraftTradeVote.findFirst({
      where: { proposalId: proposal.id, rosterId: voterRoster?.id },
    })
    if (!voterRoster) {
      return NextResponse.json({ error: 'No roster found for voter in this season' }, { status: 403 })
    }

    if (existingVote) {
      await prisma.redraftTradeVote.update({
        where: { proposalId_rosterId: { proposalId: proposal.id, rosterId: voterRoster.id } },
        data: { vote: voteValue, reason: body.reason?.trim() || null },
      })
    } else {
      await prisma.redraftTradeVote.create({
        data: {
          id: crypto.randomUUID(),
          proposalId: proposal.id,
          rosterId: voterRoster.id,
          vote: voteValue,
          reason: body.reason?.trim() || null,
        },
      })
    }

    const votes = await prisma.redraftTradeVote.findMany({ where: { proposalId: proposal.id } })
    const approveCount = votes.filter((v) => v.vote === 'approve').length
    const vetoCount = votes.filter((v) => v.vote === 'veto').length
    const threshold = proposal.vetoThreshold ?? 4

    // One ledger row per voter (updated on revote via the idempotency key).
    await recordRedraftTradeMarketEvent({
      leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
      eventType: 'league_vote_cast', actorUserId: userId, idempotencySuffix: voterRoster.id,
      voteDirection: voteValue, voteCounts: { approve: approveCount, veto: vetoCount, threshold },
    })

    if (vetoCount >= threshold) {
      const updated = await prisma.redraftTradeProposal.update({
        where: { id: proposal.id },
        data: { status: 'vetoed', processedAt: new Date() },
      })
      await upsertDecision(proposal.id, 'vetoed', userId, `League vote veto threshold reached (${vetoCount}/${threshold})`)
      await recordRedraftTradeMarketEvent({
        leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
        eventType: 'proposal_vetoed', actorUserId: userId,
        voteCounts: { approve: approveCount, veto: vetoCount, threshold },
      })
      void recordTradeOutcomeForBothManagers({
        leagueId: proposal.leagueId,
        eventType: 'trade_vetoed',
        proposerUserId: proposerOwnerId,
        receiverUserId: receiverOwnerId,
        payload: { proposalId: proposal.id, source: 'redraft_trade_vote' },
      })
      queueTradeStatusInDm({ source: 'redraft', tradeId: proposal.id, status: 'vetoed', detail: `${vetoCount} of ${threshold} veto votes were in.` })
      return NextResponse.json({ proposal: updated, resolved: true, approveCount, vetoCount, threshold })
    }

    if (approveCount >= threshold) {
      const accepted = await finalizeAcceptedTrade(
        proposal as ProposalWithAssets,
        proposerOwnerId,
        receiverOwnerId,
        userId,
        `League vote approval threshold reached (${approveCount}/${threshold})`,
        'proposal_accepted',
        'league_vote',
      )
      if (!accepted.ok) return accepted
      const payload = (await accepted.json()) as { proposal: unknown; resolved: boolean }
      return NextResponse.json({ ...payload, approveCount, vetoCount, threshold })
    }

    const fresh = await prisma.redraftTradeProposal.findFirst({
      where: { id: proposal.id },
      include: { votes: true, decision: true },
    })
    return NextResponse.json({
      proposal: fresh,
      resolved: false,
      approveCount,
      vetoCount,
      threshold,
    })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
