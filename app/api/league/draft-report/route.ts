import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getDraftReport } from '@/lib/draft-intel/draftReportService'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Retro draft report cards (feature 5): every draft in the chain graded per
 * manager, initial + evolving. Access mirrors /api/league/history.
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

  const report = await getDraftReport(league.platformLeagueId)
  if (!report) {
    return NextResponse.json(
      { supported: true as const, report: null, error: 'Draft grading temporarily unavailable' },
      { status: 502 },
    )
  }
  return NextResponse.json({
    supported: true as const,
    viewerSleeperUserId: profile?.sleeperUserId ?? null,
    report,
  })
}
