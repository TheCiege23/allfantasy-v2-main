import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueMember } from '@/lib/league/league-access'
import type { TradeValueSnapshot } from '@/lib/trade-value/types'

export const dynamic = 'force-dynamic'

/** Read the proposal's captured value evidence without repricing or changing the trade. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ proposalId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { proposalId } = await ctx.params
  const proposal = await prisma.redraftTradeProposal.findUnique({
    where: { id: proposalId },
    select: {
      id: true, leagueId: true, seasonId: true, status: true, vetoMode: true,
      acceptedAt: true, createdAt: true,
      valueSnapshot: { select: { payload: true, grade: true, fairnessScore: true, confidenceScore: true, valueDifference: true } },
    },
  })
  if (!proposal) return NextResponse.json({ error: 'Trade proposal not found' }, { status: 404 })

  const gate = await assertLeagueMember(proposal.leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const league = await prisma.league.findUnique({
    where: { id: proposal.leagueId },
    select: {
      userId: true,
      teams: { where: { claimedByUserId: userId }, select: { isCommissioner: true, isCoCommissioner: true } },
    },
  })
  if (!league || (league.userId !== userId && !league.teams.some((team) => team.isCommissioner || team.isCoCommissioner))) {
    return NextResponse.json({ error: 'Commissioner or co-commissioner permission required' }, { status: 403 })
  }

  const captured = proposal.valueSnapshot?.payload as unknown as TradeValueSnapshot | null
  const capturedReview = captured?.commissionerReview
  const capturedGrade = captured?.grade
  const riskFlags = [
    ...(!capturedReview ? ['No captured value review is available for this proposal.'] : []),
    ...(captured?.coverage?.warnings ?? []),
    ...(capturedReview?.lopsided ? ['The captured values show a large difference between sides.'] : []),
    ...(capturedGrade?.insufficientData ? ['Some assets lack supported values; review the offer manually.'] : []),
  ]
  const events = await prisma.redraftTradeMarketEvent.findMany({
    where: { leagueId: proposal.leagueId, tradeProposalId: proposal.id },
    orderBy: { createdAt: 'asc' },
    take: 100,
    select: { eventType: true, statusAtEvent: true, createdAt: true, grade: true, fairnessScore: true },
  })

  return NextResponse.json({
    proposal: {
      id: proposal.id, leagueId: proposal.leagueId, seasonId: proposal.seasonId,
      status: proposal.status, vetoMode: proposal.vetoMode,
      acceptedAt: proposal.acceptedAt, createdAt: proposal.createdAt,
    },
    review: {
      summary: {
        fairnessScore: capturedReview ? capturedReview.fairnessScore : proposal.valueSnapshot?.fairnessScore ?? null,
        confidenceScore: capturedGrade?.confidenceScore ?? proposal.valueSnapshot?.confidenceScore ?? null,
        valueDifference: capturedGrade?.valueDifference ?? proposal.valueSnapshot?.valueDifference ?? null,
        grade: capturedGrade ? capturedGrade.grade : proposal.valueSnapshot?.grade ?? null,
        reviewRecommended: capturedReview?.reviewRecommended ?? true,
        similarValueRange: capturedReview?.similarValueRange ?? null,
      },
      riskFlags,
      marketContext: { eventCount: events.length, capturedAt: proposal.createdAt },
    },
    eventTrail: events,
  })
}
