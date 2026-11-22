import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { runNbaFantraxProjectionRecheck } from '@/lib/af-projections/nbaFantraxRecheck'
import { prisma } from '@/lib/prisma'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const now = new Date()
  // Railway and the backup dispatcher can deliver the same scheduled hour.
  const cacheKey = 'af:nba-fantrax-weekly-recheck:hour:' + now.toISOString().slice(0, 13)
  const claim = await prisma.sportsDataCache.createMany({
    data: [{ cacheKey, expiresAt: new Date(now.getTime() + 48 * 3600_000), data: { started: true } }],
    skipDuplicates: true,
  })
  if (!claim.count) return NextResponse.json({ skipped: 'hour-already-claimed' })

  try {
    const run = await withSyncJobRun(
      { jobName: 'cron-nba-fantrax-weekly-projections', trigger: 'cron', sport: 'NBA', provider: 'nba_official_live' },
      () => runNbaFantraxProjectionRecheck(now),
      run => ({
        rowsRead: run.checked,
        rowsWritten: run.writer[0].seasonLinesWritten + run.writer[0].written,
        warnings: run.warnings,
        metadata: { run },
      }),
    )
    const ok = !run.warnings.length
    if (!ok) await prisma.sportsDataCache.deleteMany({ where: { cacheKey } })
    return NextResponse.json({ ok, checked: run.checked, linked: run.linked, week: run.week, projected: run.projected,
      activeVerified: run.activeVerified, written: run.writer[0].written, outsideWeeklyWindow: !run.weeklyWindow,
      warnings: run.warnings.length }, { status: ok ? 200 : 503 })
  } catch {
    await prisma.sportsDataCache.deleteMany({ where: { cacheKey } })
    return NextResponse.json({ error: 'NBA projection recheck failed' }, { status: 503 })
  }
}
