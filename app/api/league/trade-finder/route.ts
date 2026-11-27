import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTradeFinder } from '@/lib/trade-intel/tradeFinderService'
import { createLeagueTradeGrader, gradeDeal } from '@/lib/decision-os/trade/leagueTradeGrader'
import { resolveCoreDepth } from '@/lib/core-app/corePaywall'

export const dynamic = 'force-dynamic'

/**
 * Trade finder: both-sides trade suggestions from real rosters, format-correct
 * market ADP, and counted manager behavior. Access mirrors /api/league/history;
 * Sleeper-only for now. No linked Sleeper account → linked:false honestly.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string; email?: string | null }
  } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  /*
   * The Trade Finder rule (AF Pro and AF Supreme — not AF Commissioner alone; owner 2026-11-27): the
   * `trade_finder` depth, the same key Partner Match reads. It was `trade_depth` (`af_intelligence`), which
   * opened this finder to Commissioner while Partner Match stayed locked. Refused before any league read.
   */
  const finderAccess = await resolveCoreDepth(userId, 'trade_finder', { email: session?.user?.email ?? null })
  if (!finderAccess.unlocked) {
    return NextResponse.json(
      {
        error: 'Premium feature',
        code: 'feature_not_entitled',
        message: `The trade finder is part of ${finderAccess.planName}.`,
        requiredPlan: finderAccess.planName,
        upgradePath: finderAccess.upgradePath,
      },
      { status: 403 },
    )
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, platform: true, platformLeagueId: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }

  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)
  if (!profile?.sleeperUserId) {
    return NextResponse.json({ supported: true as const, linked: false as const, finder: null })
  }

  /*
   * 🛑 THE GRADE ON EVERY PROPOSAL (2026-11-26). ONE grader for this league — membership was proven by
   * the query above, as `createLeagueTradeGrader` requires — reused across every candidate. A grader
   * that cannot load costs the letters (each proposal says why), never the finder.
   */
  const grader = createLeagueTradeGrader({ leagueId: league.id, userId }).catch(() => null) // loads while the finder reads rosters
  const finder = await getTradeFinder(league.platformLeagueId, profile.sleeperUserId, {
    grade: async (give, get) => gradeDeal(await grader, { give, get, viewerSide: true }),
  })
  if (!finder) {
    return NextResponse.json(
      { supported: true as const, linked: true as const, finder: null, error: 'Trade finder temporarily unavailable' },
      { status: 502 },
    )
  }
  return NextResponse.json({ supported: true as const, linked: true as const, finder })
}
