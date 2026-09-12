import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import {
  detectAndNotifyAll,
  detectAndNotifyLeague,
} from '@/lib/trade-intel/tradeNotifyService'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import {
  processDueScheduledTrades,
  type ScheduledTradeSweepResult,
} from '@/lib/automation/jobs/trades/processDueScheduledTrades'

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
    // DELAYED TRADES, SWEPT HERE BECAUSE NOTHING ELSE SWEEPS THEM.
    //
    // A league with `processingDelayHours > 0` parks an accepted trade at `status: 'scheduled'`
    // and waits for someone to press "process" again after the due time. Nothing did. This is the
    // scheduled caller that makes `processDueScheduledTrades` real — see that file's header.
    //
    // ⚠ IT RIDES AN EXISTING ROUTE ON PURPOSE. The standing instruction is that no new API route
    // gets added (the repo sits against a hard route ceiling), so new scheduled work is folded
    // into a route that is already built and already declared in `cron-schedule.json` — this one,
    // every 30 minutes. Delays are configured in HOURS, so 30-minute granularity is not the
    // limiting factor.
    //
    // ⚠ GUARDED SO IT CAN NEVER TAKE THE HOST DOWN. Trade grading is this route's job; a sweep
    // failure must not cost the league its grade emails. It gets its OWN `sync_job_runs` identity
    // so a freshness probe can judge it on its own output rather than inheriting the host's
    // heartbeat — a passenger job that reports the driver's health is not reporting anything.
    let scheduledTrades: ScheduledTradeSweepResult & { error?: string } = {
      due: 0,
      processed: 0,
      failures: [],
    }
    try {
      scheduledTrades = await withSyncJobRun(
        { jobName: 'cron-scheduled-trade-processor', trigger: 'cron' },
        () => processDueScheduledTrades(),
        (r) => ({
          rowsRead: r.due,
          rowsWritten: r.processed,
          errors: r.failures.map((f) => `${f.tradeId}: ${f.error}`),
        }),
      )
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error('[cron/trade-grade-notify] scheduled trade sweep failed', e)
      scheduledTrades = { due: 0, processed: 0, failures: [], error }
    }

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
      scheduledTrades,
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
