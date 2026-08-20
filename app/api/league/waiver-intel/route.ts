import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getWaiverIntel } from '@/lib/waiver-intel/waiverIntelService'

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // first build scans every season's waiver claims

/** FAAB bid intelligence: league bid history + value-anchored suggestions. */
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

  const profile = await prisma.userProfile
    .findUnique({ where: { userId }, select: { sleeperUserId: true } })
    .catch(() => null)

  const intel = await getWaiverIntel(league.platformLeagueId, profile?.sleeperUserId ?? null)
  if (!intel) {
    return NextResponse.json(
      { supported: true as const, intel: null, error: 'Waiver intelligence temporarily unavailable' },
      { status: 502 },
    )
  }
  return NextResponse.json({ supported: true as const, intel })
}
