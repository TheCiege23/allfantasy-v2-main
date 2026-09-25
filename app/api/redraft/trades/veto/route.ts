import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { recordTradeOutcomeForBothManagers } from '@/lib/ai-learning-system/recordTradeParticipants'
import { recordRedraftTradeMarketEvent } from '@/lib/trade-market/redraftTradeMarketEvents'
import { queueTradeStatusInDm } from '@/lib/chat-notifications/tradeOfferDm'

export const dynamic = 'force-dynamic'

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
  return (league.teams as { isCommissioner: boolean; isCoCommissioner: boolean }[]).some(
    (t) => t.isCommissioner || t.isCoCommissioner,
  )
}

/**
 * POST /api/redraft/trades/veto
 * Body: { proposalId: string; reason?: string }
 *
 * Dedicated commissioner-only endpoint for vetoing a pending RedraftTradeProposal.
 * Applies the same veto logic as POST /api/redraft/trade-votes with
 * action: 'commissioner_veto', but surfaces commissioner permission as the only
 * gate — no action field required.
 *
 * Only operates on canonical RedraftTradeProposal records. Legacy RedraftLeagueTrade
 * IDs are rejected with 404 (they never exist in the proposals table).
 */
export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { proposalId?: string; reason?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const proposalId = body.proposalId?.trim()
  if (!proposalId) return NextResponse.json({ error: 'proposalId required' }, { status: 400 })

  // Load the canonical proposal — legacy RedraftLeagueTrade IDs return 404 here
  const proposal = await prisma.redraftTradeProposal.findUnique({
    where: { id: proposalId },
    include: { assets: true },
  })
  if (!proposal) {
    return NextResponse.json(
      {
        error: 'Trade proposal not found. This endpoint only accepts canonical RedraftTradeProposal IDs.',
      },
      { status: 404 },
    )
  }

  // Commissioner gate — checked before status so the error is clear
  const commissioner = await isCommissionerOrCo(proposal.leagueId, userId)
  if (!commissioner) {
    return NextResponse.json(
      { error: 'Commissioner or co-commissioner permission required' },
      { status: 403 },
    )
  }

  // Only pending proposals can be vetoed
  if (proposal.status !== 'pending') {
    return NextResponse.json(
      {
        error: `Cannot veto: proposal status is '${proposal.status}'. Only pending proposals can be vetoed.`,
        currentStatus: proposal.status,
      },
      { status: 409 },
    )
  }

  // Mark vetoed
  const vetoed = await prisma.redraftTradeProposal.update({
    where: { id: proposalId },
    data: { status: 'vetoed', processedAt: new Date() },
  })

  // Audit decision record (upsert pattern matching trade-votes/route.ts)
  const existingDecision = await prisma.redraftTradeDecision.findFirst({ where: { proposalId } })
  if (existingDecision) {
    await prisma.redraftTradeDecision.update({
      where: { proposalId },
      data: {
        decision: 'vetoed',
        decidedByUserId: userId,
        decisionReason: body.reason ?? null,
      },
    })
  } else {
    await prisma.redraftTradeDecision.create({
      data: {
        id: crypto.randomUUID(),
        proposalId,
        decision: 'vetoed',
        decidedByUserId: userId,
        decisionReason: body.reason ?? null,
        snapshot: {},
      },
    })
  }

  // Learning events for both managers
  const seasonRosters = await prisma.redraftRoster.findMany({
    where: { seasonId: proposal.seasonId },
    select: { id: true, ownerId: true },
  })
  const rosterById = new Map(seasonRosters.map((r) => [r.id, r]))
  const proposerOwnerId = rosterById.get(proposal.proposerRosterId)?.ownerId
  const receiverOwnerId = rosterById.get(proposal.receiverRosterId)?.ownerId

  void recordTradeOutcomeForBothManagers({
    leagueId: proposal.leagueId,
    eventType: 'trade_vetoed',
    proposerUserId: proposerOwnerId,
    receiverUserId: receiverOwnerId,
    payload: { proposalId, source: 'commissioner_veto_route' },
  })

  await recordRedraftTradeMarketEvent({
    leagueId: proposal.leagueId, seasonId: proposal.seasonId, tradeProposalId: proposalId,
    eventType: 'commissioner_vetoed', actorUserId: userId,
  })

  // The ruling, under the offer card in the two managers' DM. Fire-and-forget; no-op when there is no card.
  queueTradeStatusInDm({ source: 'redraft', tradeId: proposalId, status: 'vetoed', detail: 'The commissioner made the call.' })

  return NextResponse.json({
    proposalId: vetoed.id,
    leagueId: vetoed.leagueId,
    status: vetoed.status,
    vetoedBy: userId,
    reason: body.reason ?? null,
  })
}
