import { NextRequest, NextResponse } from 'next/server'
import { isLeagueEntryFeeProcessingEnabled } from '@/lib/monetization/leagueEntryFeeKillSwitch'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueRole } from '@/lib/league/permissions'
import { getOrCreateLeagueFinance, resolveSeasonForLeague } from '@/lib/league-finance/leagueFinanceService'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> },
) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leagueId } = await ctx.params
  const role = await getLeagueRole(leagueId, userId)
  if (!role) {
    return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })
  }

  const finance = await getOrCreateLeagueFinance(leagueId)
  if (!finance) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  const season = await resolveSeasonForLeague(leagueId)
  const myDues = await prisma.leagueDues.findUnique({
    where: {
      leagueId_userId_season: { leagueId, userId, season },
    },
  })

  const isCommish = role === 'commissioner' || role === 'co_commissioner'

  const allDues = isCommish
    ? await prisma.leagueDues.findMany({
        where: { leagueId, season },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          userId: true,
          season: true,
          amountDueCents: true,
          amountPaidCents: true,
          status: true,
          paymentProvider: true,
          paidAt: true,
          rosterId: true,
        },
      })
    : null

  const payouts = await prisma.payoutRequest.findMany({
    where: isCommish ? { leagueId } : { leagueId, requestedByUserId: userId },
    orderBy: { createdAt: 'desc' },
    take: isCommish ? 50 : 20,
    select: {
      id: true,
      requestedByUserId: true,
      amountCents: true,
      currency: true,
      status: true,
      recipientNote: true,
      freezeReason: true,
      frozenAt: true,
      paidAt: true,
      createdAt: true,
    },
  })

  const audit = isCommish
    ? await prisma.financeAuditEvent.findMany({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
        take: 40,
        select: {
          id: true,
          eventType: true,
          entityType: true,
          entityId: true,
          payload: true,
          createdAt: true,
          actorUserId: true,
        },
      })
    : null

  return NextResponse.json({
    // False: AllFantasy holds no league money; the Finance tab shows the dues tracker instead of payment actions.
    moneyHoldingEnabled: isLeagueEntryFeeProcessingEnabled(),
    finance,
    season,
    myDues,
    allDues,
    payouts,
    audit,
    role,
  })
}
