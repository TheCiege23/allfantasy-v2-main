import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import { applyRedraftTradeCapTransfers, validateRedraftTradeCap } from '@/lib/idp/capEngine'
import { settleRedraftTradeAssets } from '@/lib/redraft/tradeSettlement'
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

async function finalizeAcceptedTrade(
  proposal: ProposalWithAssets,
  proposerOwnerId: string | undefined,
  receiverOwnerId: string | undefined,
  decidedByUserId: string,
  decisionReason?: string,
  terminalEventType: RedraftMarketEventType = 'proposal_accepted',
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

  try {
    await applyRedraftTradeCapTransfers(
      proposal.leagueId,
      proposal.proposerRosterId,
      proposal.receiverRosterId,
      proposerOffers,
      receiverOffers,
    )
  } catch (e) {
    console.error('[redraft/trade-votes] IDP cap transfer failed', e)
    await failEvent()
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Cap transfer failed' },
      { status: 409 },
    )
  }

  // Settle the trade for real: move RedraftRosterPlayer rows + transfer faabBalance atomically with
  // the status flip. (IDP salary records were moved above; this handles the standard redraft roster.)
  let updated
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
      await settleRedraftTradeAssets(tx, {
        proposerRosterId: proposal.proposerRosterId,
        receiverRosterId: proposal.receiverRosterId,
        assets: proposal.assets ?? [],
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
    await events.emit(EVENT.TRADE_PROCESSED, { ...ctx, idempotencyKey: `trade.processed:${proposal.id}`, payload: { tradeId: proposal.id } })
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
      return finalizeAcceptedTrade(proposal as ProposalWithAssets, proposerOwnerId, receiverOwnerId, userId, body.reason, 'proposal_accepted')
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
      return finalizeAcceptedTrade(proposal as ProposalWithAssets, proposerOwnerId, receiverOwnerId, userId, body.reason, 'commissioner_approved')
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