import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  detectAndNotifyAll,
  detectAndNotifyLeague,
} from '@/lib/trade-intel/tradeNotifyService'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Trade-completion sweep (cron, every 30 min via vercel.json):
 *  - Cron mode: `Authorization: Bearer ${CRON_SECRET}` → sweeps every imported
 *    Sleeper league, detects newly completed trades, emails instant grades.
 *  - Manual mode: a signed-in league member may pass ?leagueId=<AF league id>
 *    to run the check for THEIR league right now ("check for new trades").
 *
 * First run per league bootstraps the seen-set silently — no retro spam.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  const cronSecret = process.env.CRON_SECRET?.trim()
  const isCron = Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`

  if (isCron) {
    const results = await withSyncJobRun(
      { jobName: 'cron-trade-grade-notify', trigger: 'cron' },
      () => detectAndNotifyAll(),
      (rs) => ({
        rowsRead: rs.length,
        rowsWritten: rs.reduce((a, r) => a + r.emailsSent, 0),
        errors: rs.filter((r) => r.error).map((r) => `${r.sleeperLeagueId}: ${r.error}`),
        metadata: { newTrades: rs.reduce((a, r) => a + r.newTrades, 0), bootstrapped: rs.filter((r) => r.bootstrap).length },
      }),
    )
    return NextResponse.json({
      mode: 'cron' as const,
      leagues: results.length,
      newTrades: results.reduce((a, r) => a + r.newTrades, 0),
      emailsSent: results.reduce((a, r) => a + r.emailsSent, 0),
      bootstrapped: results.filter((r) => r.bootstrap).length,
      errors: results.filter((r) => r.error).map((r) => ({ league: r.sleeperLeagueId, error: r.error })),
    })
  }

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

  const result = await detectAndNotifyLeague(league.platformLeagueId)
  return NextResponse.json({ mode: 'manual' as const, ...result })
}
