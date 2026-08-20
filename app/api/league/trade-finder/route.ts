import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getTradeFinder } from '@/lib/trade-intel/tradeFinderService'

export const dynamic = 'force-dynamic'

/**
 * Trade finder: both-sides trade suggestions from real rosters, format-correct
 * market ADP, and counted manager behavior. Access mirrors /api/league/history;
 * Sleeper-only for now. No linked Sleeper account → linked:false honestly.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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

  const finder = await getTradeFinder(league.platformLeagueId, profile.sleeperUserId)
  if (!finder) {
    return NextResponse.json(
      { supported: true as const, linked: true as const, finder: null, error: 'Trade finder temporarily unavailable' },
      { status: 502 },
    )
  }
  return NextResponse.json({ supported: true as const, linked: true as const, finder })
}
