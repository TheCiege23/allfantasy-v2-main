import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runCollegeProjectionRecheck } from '@/lib/af-projections/collegeRosterRecheck.cjs'
import { runNbaFantraxProjectionRecheck } from '@/lib/af-projections/nbaFantraxRecheck'
import { redactAndCap } from '@/lib/security/redactSecrets'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type RecheckRun = {
  sport: string
  week?: number
  checked?: number
  projected?: number
  weeklyWindow?: boolean
  error?: string
  warnings?: string[]
  writer?: Array<{ written: number; boxesWritten?: number; seasonLinesWritten?: number }>
}

function recheckError(error: unknown) {
  return redactAndCap(error instanceof Error ? error.message : 'Projection recheck failed', 500)
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Railway and the backup dispatcher can deliver the same scheduled hour.
  const hour = new Date().toISOString().slice(0, 13)
  const cacheKey = 'af:college-weekly-recheck:hour:' + hour
  const claim = await prisma.sportsDataCache.createMany({
    data: [{ cacheKey, expiresAt: new Date(Date.now() + 48 * 3600_000), data: { started: true } }],
    skipDuplicates: true,
  })
  if (!claim.count) return NextResponse.json({ skipped: 'hour-already-claimed' })

  try {
    const runs = await withSyncJobRun(
      { jobName: 'cron-college-weekly-projections', trigger: 'cron' },
      async (): Promise<RecheckRun[]> => {
        const [college, nba] = await Promise.all([
          runCollegeProjectionRecheck().catch(error => [{ sport: 'college', error: recheckError(error) }]),
          runNbaFantraxProjectionRecheck().catch(error => ({
            sport: 'NBA', error: recheckError(error),
          })),
        ])
        return [...college, nba]
      },
      runs => ({
        rowsRead: runs.reduce((n, r) => n + (r.checked ?? 0), 0),
        rowsWritten: runs.flatMap(r => r.writer ?? []).reduce((total, write) =>
          total + write.written + (write.boxesWritten ?? 0) + (write.seasonLinesWritten ?? 0), 0),
        errors: runs.flatMap(r => r.error ? [r.error] : []),
        warnings: runs.flatMap(r => r.warnings ?? []),
        metadata: { runs },
      }),
    )
    const ok = runs.every(r => !r.error && !r.warnings?.length)
    if (!ok) await prisma.sportsDataCache.delete({ where: { cacheKey } })
    return NextResponse.json({ ok, runs: runs.map(r => ({
      sport: r.sport, week: r.week, checked: r.checked, projected: r.projected,
      outsideWeeklyWindow: r.weeklyWindow === false, failed: Boolean(r.error), warnings: r.warnings?.length ?? 0,
    })) }, { status: ok ? 200 : 503 })
  } catch (err) {
    await prisma.sportsDataCache.deleteMany({ where: { cacheKey } })
    throw err
  }
}
