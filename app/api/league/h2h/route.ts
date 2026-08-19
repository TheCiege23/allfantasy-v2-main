import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getLeagueH2H } from '@/lib/league-history/sleeperH2HService'
import { getImportedLeagueH2H } from '@/lib/league-history/importedFactsH2HService'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // first build syncs every week of every season

/**
 * Head-to-head deep sync for the Legacy tab: manager-vs-manager records and
 * scoring profiles across the whole league chain. Access mirrors
 * /api/league/history; Sleeper-only for now.
 */
export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) {
    return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 })
  }

  const league = await prisma.league.findFirst({
    where: {
      id: leagueId,
      OR: [{ userId: userId }, { teams: { some: { claimedByUserId: userId } } }],
    },
    select: { id: true, platform: true, platformLeagueId: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    // Imported leagues (Yahoo/ESPN/…): compute the SAME aggregation from the
    // matchup facts the historical backfill persisted. Falls back to the
    // honest unsupported card only when no facts exist for this league.
    const factsH2H = await getImportedLeagueH2H(league.id)
    if (factsH2H) {
      return NextResponse.json({
        supported: true as const,
        viewerSleeperUserId: null,
        h2h: factsH2H,
      })
    }
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }

  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)

  const h2h = await getLeagueH2H(league.platformLeagueId)
  if (!h2h) {
    return NextResponse.json(
      { supported: true as const, h2h: null, error: 'Head-to-head sync temporarily unavailable' },
      { status: 502 },
    )
  }

  return NextResponse.json({
    supported: true as const,
    viewerSleeperUserId: profile?.sleeperUserId ?? null,
    h2h,
  })
}
