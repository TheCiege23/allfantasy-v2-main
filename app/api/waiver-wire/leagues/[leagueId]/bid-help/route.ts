import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { requestedRosterIdFrom, resolveActingRoster } from '@/lib/league/viewerTeams'
import { getUserAfProStatus } from '@/lib/entitlements/afAccess'
import { upgradePathForPlan } from '@/lib/monetization/upgradeDestination'
import { suggestBidRange } from '@/lib/waivers/chimmyBidHelp'

/**
 * Chimmy bid help (AF Pro): a suggested FAAB range for the manager's next claim, read from this league's
 * own winning bids this season (lib/waivers/chimmyBidHelp.ts). Read-only; no provider call.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ leagueId: string }> }) {
  const { leagueId } = await props.params
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const acting = await resolveActingRoster(leagueId, userId, requestedRosterIdFrom(req))
  if (!acting.ok) return NextResponse.json({ error: 'Join this league to get bid help.' }, { status: 403 })

  if (!(await getUserAfProStatus(userId).catch(() => false))) {
    return NextResponse.json(
      { locked: true, requiredPlan: 'AF Pro', upgradeHref: upgradePathForPlan('af_pro', { feature: 'chimmy_bid_help' }) },
      { status: 402 },
    )
  }

  const since = new Date(Date.now() - 200 * 86_400_000)
  const [wins, roster, settings] = await Promise.all([
    prisma.waiverTransaction.findMany({
      where: { leagueId, faabSpent: { gt: 0 }, processedAt: { gte: since } },
      select: { faabSpent: true },
      orderBy: { processedAt: 'desc' },
      take: 300,
    }),
    prisma.roster.findUnique({ where: { id: acting.rosterId }, select: { faabRemaining: true } }),
    prisma.leagueWaiverSettings.findUnique({ where: { leagueId }, select: { waiverEngineConfig: true } }).catch(() => null),
  ])
  const minBid = Number((settings?.waiverEngineConfig as { faab_min_bid?: unknown } | null)?.faab_min_bid ?? 0) || 0
  const help = suggestBidRange({
    winningBids: wins.map((w) => Number(w.faabSpent ?? 0)),
    remainingBudget: roster?.faabRemaining ?? 0,
    minBid,
  })
  return NextResponse.json({ locked: false, ...help })
}
