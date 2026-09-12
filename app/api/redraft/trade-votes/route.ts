import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import {
  applyRedraftTradeCapTransfersInTransaction,
  refreshCapProjections,
  validateRedraftTradeCap,
  type RedraftTradeCapTransferResult,
} from '@/lib/idp/capEngine'
import { settleRedraftTradeAssets } from '@/lib/redraft/tradeSettlement'
import {
  captureRedraftRosterState,
  writeRedraftTradeExecutionSnapshot,
} from '@/lib/redraft/tradeExecutionSnapshot'
import { getPlatformEvents, EVENT } from '@/lib/events'
import { recordRedraftTradeMarketEvent, type RedraftMarketEventType } from '@/lib/trade-market/redraftTradeMarketEvents'
import { enqueueCollusionScan } from '@/lib/integrity/enqueueCollusionScan'
import { recordAfLearningEvent } from '@/lib/ai-learning-system/recordEvent'
import { recordTradeOutcomeForBothManagers } from '@/lib/ai-learning-system/recordTradeParticipants'
import { resolveLeagueSport } from '@/lib/ai-learning-system/resolveLeagueSport'

export const dynamic = 'force-dynamic'

type TradeAction =
  | 'accept'
  | 'reject'
  | 'cancel'
  | 'commissioner_approve'
  | 'commissioner_veto'
  | 'vote_approve'
  | 'vote_veto'

type TradeAssetRow = {
  fromRosterId: string
  toRosterId: string
  assetType: string
  playerId: string | null
  playerName: string | null
  pickSeason: number | null
  pickRound: number | null
  pickNumber: number | null
  metadata: unknown
}

type ProposalWithAssets = {
  id: string
  leagueId: string
  seasonId: string
  proposerRosterId: string
  receiverRosterId: string
  status: string
  vetoMode?: string | null
  vetoThreshold: number | null
  expiresAt: Date | null
  assets: TradeAssetRow[]
}

function mapLegacyOffers(assets: TradeAssetRow[], fromRosterId: string, toRosterId: string) {
  return assets
    .filter((a) => a.fromRosterId === fromRosterId && a.toRosterId === toRosterId)
    .map((a) => {
      if (a.assetType === 'player' && a.playerId) {
        return {
          playerId: a.playerId,
          playerName: a.playerName ?? null,
        }
      }
      return {
        assetType: a.assetType,
        pickSeason: a.pickSeason,
        pickRound: a.pickRound,
        pickNumber: a.pickNumber,
      }
    })
}

/**
 * Who executed the trade, for the snapshot's `executedByActorRole`.
 *
 * ⚠ PASSED EXPLICITLY, NOT DERIVED FROM `terminalEventType`. The first version of this derived the
 * role from that argument and could not work: there is no `vote_passed` market event, and the
 * league-vote path calls `finalizeAcceptedTrade` without a terminal type at all — so a trade voted
 * through by the league would have been recorded as an ordinary `user` accept. That is precisely
 * the governance blurring the execution-evidence ADR complains about.
 */
type SnapshotActorRole = 'user' | 'commissioner' | 'league_vote'

async function finalizeAcceptedTrade(
  proposal: ProposalWithAssets,
  proposerOwnerId: string | undefined,
  receiverOwnerId: string | undefined,
  decidedByUserId: string,
  decisionReason?: string,
  terminalEventType: RedraftMarketEventType = 'proposal_accepted',
  executedByRole: SnapshotActorRole = 'user',
) {
  const failEvent = () =>
    recordRedraftTradeMarketEvent({
      leagueId: proposal.leagueId,
      seasonId: proposal.seasonId,
      tradeProposalId: proposal.id,
      eventType: 'trade_failed',
      actorUserId: decidedByUserId,
    })
  const proposerOffers = mapLegacyOffers(proposal.assets ?? [], proposal.proposerRosterId, proposal.receiverRosterId)
  const receiverOffers = mapLegacyOffers(proposal.assets ?? [], proposal.receiverRosterId, proposal.proposerRosterId)

  const cap = await validateRedraftTradeCap(
    proposal.leagueId,
    proposal.proposerRosterId,
    proposal.receiverRosterId,
    proposerOffers,
    receiverOffers,
  )
  if (!cap.ok) {
    await failEvent()
    return NextResponse.json({ error: cap.message }, { status: 409 })
  }

  // Settle the trade for real, in ONE transaction: claim the proposal, move the IDP salary records,
  // move RedraftRosterPlayer rows, transfer faabBalance. Either all of it happens or none of it does.
  //
  // 🛑 THE CAP TRANSFER USED TO RUN HERE, BEFORE THIS TRANSACTION OPENED, AND IT BROKE TWO WAYS.
  // `applyRedraftTradeCapTransfers` opens its own transaction, so the cap moves were atomic among
  // themselves and atomic with nothing else:
  //   - A settlement that then threw (bad ownership, insufficient FAAB) left the IDP cap saying the
  //     trade happened while the rosters said it had not. Nothing rolled the salary records back.
  //   - Worse, the claim that decides which of two racing finalizers wins lived in THIS transaction,
  //     below — so both racers ran the cap transfer first and moved salary TWICE, and the loser then
  //     returned 409 having already written.
  // Running it after the claim, on the same `tx`, closes both: the loser never reaches it, and a
  // later throw rolls it back with everything else.
  let updated
  let capTransfer: RedraftTradeCapTransferResult = { moved: 0, transactionIds: [] }
  try {
    updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Concurrency guard: atomically claim the proposal BEFORE moving any rosters.
      // A conditional update on status='pending' ensures only one of two racing
      // finalizers (double-click, vote-threshold vs. commissioner-approve) settles.
      const claimed = await tx.redraftTradeProposal.updateMany({
        where: { id: proposal.id, status: 'pending' },
        data: { status: 'accepted', acceptedAt: new Date(), processedAt: new Date() },
      })
      if (claimed.count === 0) {
        throw new Error('PROPOSAL_ALREADY_RESOLVED')
      }
      // ⚠ BEFORE-STATE IS READ HERE AND NOWHERE LATER. Inside one transaction these rows stop
      // being "before" the moment the settlement writes them, so the evidence has to be taken
      // after the claim (only the race winner gets this far) and before anything moves.
      const beforeState = await captureRedraftRosterState(tx, [
        proposal.proposerRosterId,
        proposal.receiverRosterId,
      ])
      capTransfer = await applyRedraftTradeCapTransfersInTransaction(
        tx,
        proposal.leagueId,
        proposal.proposerRosterId,
        proposal.receiverRosterId,
        proposerOffers,
        receiverOffers,
      )
      const settlement = await settleRedraftTradeAssets(tx, {
        proposerRosterId: proposal.proposerRosterId,
        receiverRosterId: proposal.receiverRosterId,
        assets: proposal.assets ?? [],
      })

      // IMMUTABLE EVIDENCE, WRITTEN WITH THE TRADE RATHER THAN AFTER IT.
      //
      // 🛑 `TradeExecutionSnapshot` had NO writer anywhere in this codebase — the model, its
      // `TradeReversal` counterpart and the documents describing both were all on main, and not one
      // row was ever created. A reversal had nothing to restore to.
      //
      // ⚠ This also MOVES the `TRADE_PROCESSED` emit into the transaction (same deterministic
      // idempotency key), because the snapshot's `eventId` is NOT NULL and unique: evidence that
      // points at an event which may never have been written is not evidence. The post-commit emit
      // below now sends only TRADE_ACCEPTED.
      await writeRedraftTradeExecutionSnapshot(tx, {
        proposalId: proposal.id,
        leagueId: proposal.leagueId,
        seasonId: proposal.seasonId,
        proposerRosterId: proposal.proposerRosterId,
        receiverRosterId: proposal.receiverRosterId,
        executedByActorId: decidedByUserId,
        executedByActorRole: executedByRole,
        governance: {
          vetoMode: proposal.vetoMode ?? null,
          vetoThreshold: proposal.vetoThreshold ?? null,
          terminalEventType,
          decisionReason: decisionReason ?? null,
        },
        validations: { idpCap: 'ok', capTransfersApplied: capTransfer.moved },
        assetSummary: {
          proposerOffers,
          receiverOffers,
          playersMoved: settlement.playersMoved,
          faabTransferred: settlement.faabTransferred,
          picksRecorded: settlement.picksRecorded,
        },
        sourceTransactionIds: capTransfer.transactionIds,
        beforeState,
        afterState: await captureRedraftRosterState(tx, [
          proposal.proposerRosterId,
          proposal.receiverRosterId,
        ]),
        executedAt: new Date(),
      })

      return tx.redraftTradeProposal.findUniqueOrThrow({ where: { id: proposal.id } })
    })
  } catch (e) {
    // Lost the race — another finalizer already settled this proposal. Do not
    // record a spurious failure or re-settle.
    if (e instanceof Error && e.message === 'PROPOSAL_ALREADY_RESOLVED') {
      return NextResponse.json({ error: 'Proposal already resolved' }, { status: 409 })
    }
    await failEvent()
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Trade settlement failed' },
      { status: 409 },
    )
  }
  await upsertDecision(proposal.id, 'accepted', decidedByUserId, decisionReason)

  // POST-COMMIT, and deliberately not inside the transaction above. `IDPCapProjection` is a derived
  // view; recomputing it from inside would publish projections for a settlement that can still roll
  // back. `applyRedraftTradeCapTransfers` — the non-transactional version this path used to call —
  // refreshed post-commit for the same reason, so omitting it here would silently regress projection
  // freshness on every redraft trade while the ledger stayed correct and nothing went red.
  //
  // Best-effort: the trade is already committed and a stale projection must not turn a settled trade
  // into an error response.
  if (capTransfer.moved > 0) {
    for (const rosterId of new Set([proposal.proposerRosterId, proposal.receiverRosterId])) {
      await refreshCapProjections(proposal.leagueId, rosterId).catch((e) =>
        console.error('[redraft/trade-votes] cap projection refresh failed', rosterId, e),
      )
    }
  }

  // G15.2b — best-effort emit (never throws; only the race-winning finalizer reaches here,
  // and deterministic keys dedupe → exactly one accepted+processed event per trade).
  {
    const events = getPlatformEvents()
    const ctx = {
      leagueId: proposal.leagueId,
      seasonId: proposal.seasonId,
      leagueConcept: 'redraft' as const,
      actor: { type: 'user' as const, id: decidedByUserId ?? null },
      source: 'route:trade-votes',
      subjects: [{ kind: 'trade', id: proposal.id }],
    }
    await events.emit(EVENT.TRADE_ACCEPTED, { ...ctx, idempotencyKey: `trade.accepted:${proposal.id}`, payload: { tradeId: proposal.id } })
    // ⚠ TRADE_PROCESSED IS NO LONGER EMITTED HERE. It moved into the settlement transaction, under
    // the SAME deterministic key, because `TradeExecutionSnapshot.eventId` is NOT NULL and unique —
    // the snapshot cannot reference an event that a best-effort post-commit emit might never write.
    // Re-adding it here would either duplicate the event or, worse, look like the only emit.
  }

  if (proposerOwnerId && receiverOwnerId) {
    void recordTradeOutcomeForBothManagers({
      leagueId: proposal.leagueId,
      eventType: 'trade_accepted',
      proposerUserId: proposerOwnerId,
      receiverUserId: receiverOwnerId,
      payload: { proposalId: proposal.id, source: 'redraft_trade_proposal' },
    })
  }

  if (proposerOwnerId && receiverOwnerId) {
    const legacy = await prisma.redraftLeagueTrade.create({
      data: {
        leagueId: proposal.leagueId,
        seasonId: proposal.seasonId,
        proposerId: proposerOwnerId,
        proposerRosterId: proposal.proposerRosterId,
        receiverId: receiverOwnerId,
        receiverRosterId: proposal.receiverRosterId,
        proposerOffers,
        receiverOffers,
        status: 'accepted',
        processedAt: new Date(),
        expiresAt: proposal.expiresAt ?? new Date(),
        notes: 'Normalized proposal accepted and mirrored for legacy integrity workflows',
      },
    })
    void enqueueCollusionScan(legacy.leagueId, legacy.id, [legacy.proposerRosterId, legacy.receiverRosterId]).catch((e) =>
      console.error('[redraft/trade-votes] enqueueCollusionScan failed', e),
    )
  }

  // Market ledger: terminal acceptance event + processed event (best-effort, idempotent).
  await recordRedraftTradeMarketEvent({
    leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
    eventType: terminalEventType, actorUserId: decidedByUserId,
  })
  await recordRedraftTradeMarketEvent({
    leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposal.id,
    eventType: 'trade_processed', actorUserId: decidedByUserId,
  })

  return NextResponse.json({ proposal: updated, resolved: true })
}

async function isCommissionerOrCo(leagueId: string, userId: string): Promise<boolean> {
  const league = await prisma.league.findFirst({
    where: { id: leagueId },
    select: {
      userId: true,
      teams: {
        where: { claimedByUserId: userId },
        select: { isCommissioner: true, isCoCommissioner: true },
      },
    },
  })
  if (!league) return false
  if (league.userId === userId) return true
  return league.teams.some((t) => t.isCommissioner || t.isCoCommissioner)
}

async function upsertDecision(
  proposalId: string,
  decision: 'accepted' | 'rejected' | 'vetoed' | 'cancelled' | 'expired' | 'processed',
  decidedByUserId: string,
  decisionReason?: string,
) {
  const existing = await prisma.redraftTradeDecision.findFirst({ where: { proposalId } })
  if (existing) {
    return prisma.redraftTradeDecision.update({
      where: { proposalId },
      data: {
        decision,
        decidedByUserId,
        decisionReason: decisionReason ?? null,
      },
    })
  }

  return prisma.redraftTradeDecision.create({
    data: {
      id: crypto.randomUUID(),
      proposalId,
      decision,
      decidedByUserId,
      decisionReason: decisionReason ?? null,
      snapshot: {},
    },
  })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { proposalId?: string; action?: TradeAction; reason?: string }
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

  if (proposal.status !== 'pending') {
    return NextResponse.json({ error: 'Proposal is not pending', proposal }, { status: 409 })
  }

  if (proposal.expiresAt && proposal.expiresAt.getTime() < Date.now()) {
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
    return NextResponse.json({ proposal: expired, resolved: true })
  }

  const seasonRosters = await prisma.redraftRoster.findMany({
    where: { seasonId: proposal.seasonId },
    select: { id: true, ownerId: true },
  })
  const rosterById = new Map(seasonRosters.map((r) => [r.id, r]))
  const proposerOwnerId = rosterById.get(proposal.proposerRosterId)?.ownerId
  const receiverOwnerId = rosterById.get(proposal.receiverRosterId)?.ownerId
  const isProposerOwner = proposerOwnerId === userId
  const isReceiverOwner = receiverOwnerId === userId
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

      if (proposal.vetoMode === 'no_veto') {
        return finalizeAcceptedTrade(proposal as ProposalWithAssets, proposerOwnerId, receiverOwnerId, userId, body.reason, 'proposal_accepted')
      }

      /*
       * Conditional on BOTH the status and `acceptedAt` being unset, so two simultaneous accepts
       * cannot both record one — the same reason the settlement claim is conditional.
       */
      const claimedAccept = await prisma.redraftTradeProposal.updateMany({
        where: { id: proposal.id, status: 'pending', acceptedAt: null },
        data: { acceptedAt: new Date() },
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
      return finalizeAcceptedTrade(proposal as ProposalWithAssets, proposerOwnerId, receiverOwnerId, userId, body.reason, 'commissioner_approved', 'commissioner')
    }

    const updated = await prisma.redraftTradeProposal.update({
      where: { id: proposal.id },
      data: {
        status: 'vetoed',
        processedAt: new Date(),
      },
    })
    await upsertDecision(proposal.id, 'vetoed', userId, body.reason)
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

    const voteValue = action === 'vote_approve' ? 'approve' : 'veto'
    const existingVote = await prisma.redraftTradeVote.findFirst({
      where: { proposalId: proposal.id, rosterId: seasonRosters.find((r) => r.ownerId === userId)?.id },
    })
    const voterRoster = seasonRosters.find((r) => r.ownerId === userId)
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