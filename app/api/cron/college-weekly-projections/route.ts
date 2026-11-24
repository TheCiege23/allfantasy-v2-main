import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runCollegeProjectionRecheck } from '@/lib/af-projections/collegeRosterRecheck.cjs'
import { runNbaFantraxProjectionRecheck } from '@/lib/af-projections/nbaFantraxRecheck'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

type RunSummary = {
  sport: string
  week?: number
  checked?: number
  projected?: number
  outsideWeeklyWindow?: boolean
  failed?: boolean
  warnings?: number
}

type RecheckResult = { ok: boolean; runs: RunSummary[] }

/** Separate claims let the dispatcher retry one failed cohort without repeating a successful cohort. */
async function recheckOnce(now: Date, cohort: string, run: () => Promise<RecheckResult>) {
  const cacheKey = `af:${cohort}-weekly-recheck:hour:${now.toISOString().slice(0, 13)}`
  const claim = await prisma.sportsDataCache.createMany({
    data: [{ cacheKey, expiresAt: new Date(now.getTime() + 48 * 3600_000), data: { started: true } }],
    skipDuplicates: true,
  })
  if (!claim.count) return { ok: true, runs: [], skipped: true }
  try {
    const result = await run()
    if (!result.ok) await prisma.sportsDataCache.deleteMany({ where: { cacheKey } })
    return { ...result, skipped: false }
  } catch (error) {
    await prisma.sportsDataCache.deleteMany({ where: { cacheKey } })
    throw error
  }
}

async function checkCollege(): Promise<RecheckResult> {
  const runs = await withSyncJobRun(
    { jobName: 'cron-college-weekly-projections', trigger: 'cron' },
    runCollegeProjectionRecheck,
    runs => ({
      rowsRead: runs.reduce((n, r) => n + (r.checked ?? 0), 0),
      rowsWritten: runs.flatMap(r => r.writer ?? []).reduce((n, r) => n + r.written + (r.boxesWritten ?? 0), 0),
      errors: runs.flatMap(r => r.error ? [r.error] : []),
      warnings: runs.flatMap(r => r.warnings ?? []),
      metadata: { runs },
    }),
  )
  return {
    ok: runs.every(r => !r.error && !r.warnings?.length),
    runs: runs.map(r => ({
      sport: r.sport, week: r.week, checked: r.checked, projected: r.projected,
      outsideWeeklyWindow: r.weeklyWindow === false, failed: Boolean(r.error), warnings: r.warnings?.length ?? 0,
    })),
  }
}

async function checkNba(now: Date): Promise<RecheckResult> {
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
  return {
    ok: !run.warnings.length,
    runs: [{
      sport: run.sport, week: run.week, checked: run.checked, projected: run.projected,
      outsideWeeklyWindow: !run.weeklyWindow, failed: false, warnings: run.warnings.length,
    }],
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const [college, nba] = await Promise.all([
    recheckOnce(now, 'college', checkCollege).catch(() => ({ ok: false, skipped: false, runs: [{ sport: 'college', failed: true }] })),
    recheckOnce(now, 'nba-fantrax', () => checkNba(now)).catch(() => ({ ok: false, skipped: false, runs: [{ sport: 'NBA', failed: true }] })),
  ])
  if (college.skipped && nba.skipped) return NextResponse.json({ skipped: 'hour-already-claimed' })
  const ok = college.ok && nba.ok
  return NextResponse.json({ ok, runs: [...college.runs, ...nba.runs] }, { status: ok ? 200 : 503 })
}
