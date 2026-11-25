/**
 * ACCEPTING AND DECLINING A REDRAFT TRADE — the one implementation.
 *
 * Moved verbatim out of app/api/redraft/trade-votes/route.ts so that anything that answers a trade
 * offer (a manager through the route, and later Chimmy for a team it runs) goes through exactly the
 * same rules: move lock, Survivor rules, trade deadline, post-draft lock, multi-team acceptance,
 * integrity holds, the review window, notices and learning events. There must never be a second
 * accept path.
 *
 * WHO may act is the caller's job: the route checks the session user runs a team in the trade before
 * calling. These functions answer with a plain `{ status, body }` the route turns into its response.
 */
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { checkSurvivorTradeRules, type SurvivorTradeRuleCheck } from '@/lib/survivor/survivorTradeRuleHook'
import { holdRedraftProposalForCommissioner, survivorLeagueLanguage } from '@/lib/survivor/survivorTradeCheckHold'
import { governanceCopy } from '@/lib/survivor/survivorGovernanceCopy'
import { redeemSurvivorTradeBypass, survivorBypassSourceToRedeem } from '@/lib/survivor/survivorTradeRuleBypass'
import { recordRedraftTradeMarketEvent } from '@/lib/trade-market/redraftTradeMarketEvents'
import { recordTradeOutcomeForBothManagers } from '@/lib/ai-learning-system/recordTradeParticipants'
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
  upsertRedraftTradeDecision as upsertDecision,
  type ProposalWithAssets,
} from '@/lib/redraft/finalizeRedraftTrade'
import { reviewWindowEndsAt, tradeReviewWindowHours } from '@/lib/redraft/tradeReviewWindow'
import { assertSeasonTradeSettlement, readSeasonTradePolicy, SeasonTradeError } from '@/lib/tournament/seasonTradePolicy'
import { shouldHoldAcceptedTrade } from '@/lib/integrity/holdFlaggedTrades'
import { tradePartiesPendingAcceptance } from '@/lib/redraft/tradeParticipants'
import { notifyMultiTeamTradeParties } from '@/lib/redraft/multiTeamTradeNotices'

/** What a decision answers with: the HTTP status and JSON body the trade-votes route has always sent. */
export type TradeDecisionResult = { status: number; body: Record<string, unknown> }

function json(body: Record<string, unknown>, init?: { status?: number }): TradeDecisionResult {
  return { status: init?.status ?? 200, body }
}

export type PendingTradeProposal = Prisma.RedraftTradeProposalGetPayload<{ include: { votes: true; assets: true } }>

export type TradeDecisionInput = {
  /** The pending proposal, with votes and assets. Mutated as the route always did (`acceptedRosterIds`, `vetoMode`). */
  proposal: PendingTradeProposal
  /** Who is deciding. The caller has already checked they run a team that may accept or decline. */
  actorUserId: string
  reason?: string
  proposerOwnerId: string | undefined
  receiverOwnerId: string | undefined
  multiTeam: boolean
  /** Multi-team only: the non-proposer teams in the trade that the actor runs. */
  actingPartyRosterIds: string[]
  participantOwnerIds: Array<string | null | undefined>
}

/**
 * Settle, then spend the Survivor free-trade token the trade NEEDED (the hook's `bypassRequired`, read
 * before the assets moved). Never on a commissioner approval — that is the override
 * (`survivorBypassSourceToRedeem`). Idempotent per trade: the ref is `redraft:<proposalId>`, the same ref
 * the trade runtime spends under, and `redeemSurvivorTradeToken` spends once per ref. Never throws.
 */
export async function finalizeAndSpendSurvivorToken(
  survivor: { check: SurvivorTradeRuleCheck | null; commissionerApproved: boolean },
  ...args: Parameters<typeof finalizeRedraftTrade>
) {
  const r = await finalizeRedraftTrade(...args)
  if (!r.ok) return json({ error: r.error }, { status: r.status })
  const source = survivorBypassSourceToRedeem(survivor.check, { commissionerApproved: survivor.commissionerApproved })
  if (source && survivor.check?.ok) {
    await redeemSurvivorTradeBypass({ leagueId: args[0].leagueId, week: survivor.check.week ?? 0, tradeRef: `redraft:${args[0].id}`, source, actorUserId: args[3] ?? null })
  }
  return json({ proposal: r.proposal, resolved: true })
}

/**
 * 🛑 THE COMMISSIONER'S MOVE LOCK (`League.lockAllMoves`) — this route never read it, for any sport.
 *
 * Unlike the deadline, it binds at SETTLEMENT as well as at acceptance: a trade accepted before the lock may
 * not be approved or voted through while moves are frozen. Rejections and vetoes move nothing and stay open.
 * The code is the NFL trade runtime's `MOVE_LOCKED`. See lib/redraft/tradeMoveLock.ts.
 */
export async function refuseIfMovesLocked(leagueId: string): Promise<TradeDecisionResult | null> {
  if (!(await isRedraftLeagueMovesLocked(leagueId))) return null
  return json(
    { error: REDRAFT_MOVES_LOCKED_MESSAGE, code: REDRAFT_MOVES_LOCKED_CODE },
    { status: REDRAFT_MOVES_LOCKED_STATUS },
  )
}

/**
 * Survivor trade rules (lib/survivor/survivorTradeRuleHook.ts): bound when a trade is accepted and when
 * an approve vote could settle it, like the move lock. A commissioner's approval is the override, as it
 * is for the deadline in the trade runtime. One league read and out for every non-Survivor league.
 */
export async function refuseIfSurvivorTradeRules(proposal: {
  leagueId: string
  proposerRosterId: string
  receiverRosterId: string
  assets: Array<{ assetType: string; playerId: string | null; playerName: string | null; fromRosterId: string; toRosterId: string }>
}): Promise<{ refusal: TradeDecisionResult | null; check: SurvivorTradeRuleCheck }> {
  const check = await checkSurvivorTradeRules({
    leagueId: proposal.leagueId,
    rosterIds: [proposal.proposerRosterId, proposal.receiverRosterId, ...proposal.assets.flatMap((a) => [a.fromRosterId, a.toRosterId])],
    rosterIdSpace: 'redraft',
    players: proposal.assets.filter((a) => a.assetType === 'player' && a.playerId).map((a) => ({ playerId: String(a.playerId), playerName: a.playerName, fromRosterId: a.fromRosterId })),
  })
  // The check is kept so the settlement can spend a free-trade token the trade needed.
  return { refusal: check.ok ? null : json({ error: check.message, code: check.code }, { status: check.status }), check }
}

/**
 * The same check, also reporting a HOLD: the check could not run and the commissioner chose "hold it"
 * (lib/survivor/survivorTradeCheckHold.ts). A held trade is sent to commissioner approval, never refused.
 */
export async function survivorTradeRuleOutcome(
  proposal: Parameters<typeof refuseIfSurvivorTradeRules>[0],
): Promise<{ refusal: TradeDecisionResult | null; hold: boolean; check: SurvivorTradeRuleCheck }> {
  // One check: the refusal, the hold, and the check itself (kept so the settlement can spend a token).
  const { refusal, check } = await refuseIfSurvivorTradeRules(proposal)
  return { refusal, hold: !refusal && check.ok && Boolean(check.holdForCommissioner), check }
}

/** A team in the trade accepts it. Settles only under `no_veto`; otherwise opens the review window. */
export async function acceptRedraftTrade(input: TradeDecisionInput): Promise<TradeDecisionResult> {
  const { proposal, actorUserId: userId, proposerOwnerId, receiverOwnerId, multiTeam, actingPartyRosterIds, participantOwnerIds } = input
  const body = { reason: input.reason }
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
    return json(
      { error: 'This trade has already been accepted and is awaiting review.' },
      { status: 409 },
    )
  }

  // The move lock first, as the trade runtime orders it ahead of the deadline.
  const lockedAtAccept = await refuseIfMovesLocked(proposal.leagueId)
  if (lockedAtAccept) return lockedAtAccept
  const survivorAtAccept = await survivorTradeRuleOutcome(proposal)
  if (survivorAtAccept.refusal) return survivorAtAccept.refusal
  const survivorHeld = survivorAtAccept.hold

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
    return json(
      { error: tradeDeadlinePassedMessage(deadline), code: 'TRADE_DEADLINE_PASSED' },
      { status: 409 },
    )
  }

  // Post-draft roster lock: an offer made before the draft ended cannot settle during it.
  // After the existing refusals (already accepted, deadline) so their behaviour is unchanged.
  const postDraftLock = await postDraftRosterMoveRefusal(proposal.leagueId, 'trade')
  if (postDraftLock) {
    return json(
      { error: postDraftLock.error, code: postDraftLock.code, unlocksAt: postDraftLock.unlocksAt },
      { status: postDraftLock.status },
    )
  }

  /*
   * 🛑 A MULTI-TEAM TRADE IS AGREED ONLY WHEN EVERY TEAM HAS ACCEPTED IT.
   *
   * Each acceptance is recorded on its own, conditionally: still `pending`, still not agreed
   * (`acceptedAt` null — the field the whole review flow reads as "the trade is agreed"), and this
   * team not already in the list. Until the last team accepts, nothing below runs — no hold check,
   * no settlement, no review window — and `acceptedAt` stays unset, so neither a commissioner nor
   * a league vote nor the review sweep can act on it. The LAST acceptance falls through to exactly
   * the flow a two-team trade's receiver gets.
   *
   * ⚠ Two last teams accepting at once both see "all accepted" and both reach that flow. Its own
   * claims decide: settlement claims `status = 'pending'`, the review window claims
   * `acceptedAt: null`, so one of them proceeds and the other gets a 409.
   */
  if (multiTeam) {
    const already = new Set(proposal.acceptedRosterIds ?? [])
    const mine = actingPartyRosterIds.filter((id) => !already.has(id))
    if (mine.length === 0) {
      return json(
        { error: 'You have already accepted this trade. It is waiting on the other teams.' },
        { status: 409 },
      )
    }
    for (const rosterId of mine) {
      await prisma.redraftTradeProposal.updateMany({
        where: { id: proposal.id, status: 'pending', acceptedAt: null, NOT: { acceptedRosterIds: { has: rosterId } } },
        data: { acceptedRosterIds: { push: rosterId } },
      })
    }
    const afterAccept = await prisma.redraftTradeProposal.findUnique({ where: { id: proposal.id } })
    if (!afterAccept || afterAccept.status !== 'pending' || afterAccept.acceptedAt) {
      return json({ error: 'This trade is no longer awaiting your acceptance.' }, { status: 409 })
    }
    proposal.acceptedRosterIds = afterAccept.acceptedRosterIds ?? []
    const stillPending = tradePartiesPendingAcceptance(proposal)
    if (stillPending.length > 0) {
      return json({
        proposal: afterAccept,
        resolved: false,
        awaitingAcceptance: stillPending,
        acceptedRosterIds: proposal.acceptedRosterIds,
      })
    }
    // Every team has accepted: from here on this is the agreed trade, exactly as for two teams.
    notifyMultiTeamTradeParties({
      proposalId: proposal.id,
      leagueId: proposal.leagueId,
      userIds: participantOwnerIds,
      actorUserId: userId,
      key: 'all_accepted',
      title: 'Trade accepted by every team',
      // Neutral on purpose: settlement or review is decided below, and either can still refuse.
      body: 'Every team accepted the multi-team trade. Open it to see where it stands.',
    })
  }

  /*
   * "Hold flagged trades" (lib/integrity/holdFlaggedTrades.ts): checked now, before anything
   * settles. A flagged trade becomes a commissioner-review trade whatever the league's mode, and
   * the review sweep will not auto-pass it while its flag is open — the commissioner decides.
   */
  const holdLeague = await prisma.league.findUnique({ where: { id: proposal.leagueId }, select: { settings: true } })
  const held = survivorHeld || await shouldHoldAcceptedTrade({
    leagueId: proposal.leagueId,
    settings: holdLeague?.settings,
    ref: { kind: 'redraft', proposalId: proposal.id },
  })
  // Survivor "hold it for the commissioner": also marked, so the review-window sweep leaves it alone.
  if (survivorHeld) await holdRedraftProposalForCommissioner({ leagueId: proposal.leagueId, proposalId: proposal.id, actorUserId: userId })
  if (held && proposal.vetoMode !== 'commissioner') {
    await prisma.redraftTradeProposal.updateMany({
      where: { id: proposal.id, status: 'pending', acceptedAt: null },
      data: { vetoMode: 'commissioner' },
    })
    proposal.vetoMode = 'commissioner'
  }

  if (proposal.vetoMode === 'no_veto') {
    return finalizeAndSpendSurvivorToken({ check: survivorAtAccept.check, commissionerApproved: false }, proposal as ProposalWithAssets, proposerOwnerId, receiverOwnerId, userId, body.reason, 'proposal_accepted')
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
  const windowLeague = await prisma.league.findUnique({ where: { id: proposal.leagueId }, select: { tradeReviewHours: true, leagueVariant: true } })
  const claim = { id: proposal.id, status: 'pending', acceptedAt: null }
  const claimedAccept = windowLeague?.leagueVariant === 'season_tournament'
    ? await prisma.$transaction(async tx => {
      const policy = await readSeasonTradePolicy(tx, proposal.leagueId, true)
      if (!policy) throw new SeasonTradeError('Tournament trades are unavailable.')
      const decisionAt = new Date()
      assertSeasonTradeSettlement(policy, proposal, decisionAt)
      return tx.redraftTradeProposal.updateMany({ where: claim, data: {
        acceptedAt: decisionAt, expiresAt: new Date(Math.min(policy.cutAt, decisionAt.getTime() + policy.reviewMs)),
      } })
    }).catch(error => {
      if (error instanceof SeasonTradeError) return { error: error.message }
      throw error
    })
    : await prisma.redraftTradeProposal.updateMany({ where: claim,
      data: { acceptedAt, expiresAt: reviewWindowEndsAt(acceptedAt, tradeReviewWindowHours(windowLeague?.tradeReviewHours)) },
    })
  if ('error' in claimedAccept) return json({ error: claimedAccept.error }, { status: 409 })
  if (claimedAccept.count === 0) {
    return json({ error: 'This trade is no longer awaiting your acceptance.' }, { status: 409 })
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
    detail: survivorHeld
      ? governanceCopy(await survivorLeagueLanguage(proposal.leagueId)).tradeHeldForCommissioner
      : held
      ? 'The league integrity check flagged it, so it is held until the commissioner approves or vetoes it.'
      : proposal.vetoMode === 'league_vote'
        ? 'It goes to a league vote, and goes through when the review window ends unless the league vetoes it.'
        : 'It goes to commissioner review, and goes through when the review window ends unless the commissioner vetoes it.',
  })
  return json({
    proposal: awaitingReview,
    resolved: false,
    awaitingReview: proposal.vetoMode === 'league_vote' ? 'league_vote' : 'commissioner',
  })
}

/** A team in the trade declines it, which ends it for every team. */
export async function rejectRedraftTrade(input: TradeDecisionInput): Promise<TradeDecisionResult> {
  const { proposal, actorUserId: userId, proposerOwnerId, receiverOwnerId, multiTeam, participantOwnerIds } = input
  const body = { reason: input.reason }
  const updated = await prisma.redraftTradeProposal.update({
    where: { id: proposal.id },
    data: { status: 'rejected', rejectedAt: new Date(), processedAt: new Date() },
  })
  await upsertDecision(proposal.id, 'rejected', userId, body.reason)
  // Any one team declining ends a multi-team trade for all of them; they hear it here (no DM card).
  if (multiTeam) {
    notifyMultiTeamTradeParties({
      proposalId: proposal.id,
      leagueId: proposal.leagueId,
      userIds: participantOwnerIds,
      actorUserId: userId,
      key: 'rejected',
      title: 'Trade declined',
      body: 'A team declined the multi-team trade, so it will not go through.',
    })
  }
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
  return json({ proposal: updated, resolved: true })
}
