import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildImportProgressView } from '@/lib/import/importProgressView'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await ctx.params
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
    }

    const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const appUserId = session.user.id
    const appUser = await prisma.appUser.findUnique({
      where: { id: appUserId },
      select: { legacyUserId: true },
    })

    const job = await prisma.legacyImportJob.findFirst({
      where: {
        id: jobId,
        OR: [
          { appUserId },
          ...(appUser?.legacyUserId ? [{ userId: appUser.legacyUserId }] : []),
        ],
      },
    })

    if (!job) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const seasons = await prisma.importJobSeason.findMany({
      where: { jobId },
      orderBy: { season: 'asc' },
      select: {
        season: true,
        status: true,
        leagueCount: true,
        wins: true,
        losses: true,
        championships: true,
        playoffApps: true,
        rankAfter: true,
        levelAfter: true,
        xpEarned: true,
      },
    })

    const progressView = buildImportProgressView({
      status: job.status,
      progress: job.progress,
      currentSeason: job.currentSeason,
      totalSeasons: job.totalSeasons,
      seasonsCompleted: job.seasonsCompleted,
      seasonStatuses: seasons.map((season) => season.status),
    })

    return NextResponse.json({
      status: job.status,
      progress: job.progress ?? 0,
      ...progressView,
      currentSeason: job.currentSeason,
      seasonsCompleted: job.seasonsCompleted ?? 0,
      totalSeasons: job.totalSeasons ?? 0,
      totalLeaguesSaved: job.totalLeaguesSaved ?? 0,
      lastRankTier: job.lastRankTier,
      lastRankLevel: job.lastRankLevel,
      lastXpTotal: job.lastXpTotal ?? 0,
      completedAt: job.completedAt,
      seasons: seasons.map((s) => ({
        ...s,
        leagueCount: s.leagueCount ?? 0,
        wins: s.wins ?? 0,
        losses: s.losses ?? 0,
        championships: s.championships ?? 0,
        playoffApps: s.playoffApps ?? 0,
        xpEarned: s.xpEarned ?? 0,
      })),
    })
  } catch (err: unknown) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[import/progress] error:', e.message, e.stack)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
