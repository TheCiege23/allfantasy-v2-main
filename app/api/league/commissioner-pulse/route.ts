import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computeCommissionerPulse } from '@/lib/league-intel/commissionerPulseService'

export const dynamic = 'force-dynamic'

/**
 * Commissioner pulse for ONE league — thin wrapper over the shared
 * commissionerPulseService (also used by the dashboard's league-health
 * leaderboard, so both surfaces always agree).
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
    select: { platform: true, platformLeagueId: true },
  })
  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
  if (league.platform !== 'sleeper' || !league.platformLeagueId) {
    return NextResponse.json({ supported: false as const, platform: league.platform })
  }

  const pulse = await computeCommissionerPulse(league.platformLeagueId)
  if (!pulse) {
    return NextResponse.json(
      { supported: true as const, pulse: null, error: 'League feed temporarily unavailable' },
      { status: 502 },
    )
  }
  return NextResponse.json({ supported: true as const, pulse })
}
