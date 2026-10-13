import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getSleeperLeagueHistory } from '@/lib/league-history/sleeperLeagueHistoryService'
import { loadAllTimeStandings } from '@/lib/league/allTimeStandingsServer'

export const dynamic = 'force-dynamic'

/**
 * League history for the Legacy tab (slice 3). Access rules mirror
 * /api/league/trades-panel: the viewer must own the canonical League row or
 * have a claimed team in it. Sleeper-imported leagues get the full chain
 * payload; other platforms return supported:false honestly (their history
 * ingestion is a later slice, not a pretend-empty).
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
    select: { id: true, platform: true, platformLeagueId: true, name: true },
  })
  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 })
  }

  /*
   * The History tab reads `seasons` and `allTimeStandings`, and this route sent neither — so the tab's
   * season list and all-time table were empty on every league. Both come from Postgres for every
   * platform; the Sleeper chain below is extra, not a precondition.
   */
  const [seasons, allTimeStandings] = await Promise.all([
    prisma.leagueSeason.findMany({ where: { leagueId }, orderBy: { season: 'desc' } }),
    loadAllTimeStandings(leagueId).catch(() => []),
  ])

  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return NextResponse.json({ supported: false as const, platform: league.platform, seasons, allTimeStandings })
  }

  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)

  const history = await getSleeperLeagueHistory(league.platformLeagueId)
  if (!history) {
    // The stored seasons and standings still stand when the Sleeper chain is unavailable.
    return NextResponse.json({ supported: true as const, history: null, error: 'History temporarily unavailable', seasons, allTimeStandings })
  }

  return NextResponse.json({
    supported: true as const,
    viewerSleeperUserId: profile?.sleeperUserId ?? null,
    history,
    seasons,
    allTimeStandings,
  })
}
