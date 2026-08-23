import { NextResponse, type NextRequest } from 'next/server'
import { processWaiverWindow } from '@/lib/redraft/waiverEngine'
import { prisma } from '@/lib/prisma'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * This job is CONDITIONAL: with no active/drafting season there is no waiver window to
 * process, so redraft_waiver_claims can sit untouched for months while the schedule is
 * perfectly healthy. Only the SCHEDULED GET records a run — POST is the admin path.
 */
const JOB = 'cron-redraft-waiver-process'

// This branch added its own cron GET here; #284 landed an equivalent one further down
// (kept), so both would have exported `GET` from the same module. Dropped this copy —
// main's is the shipped, reviewed version and does the same work inline.
// `runWaiverProcessing()` stays: POST still calls it.

export async function POST(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res

  return runWaiverProcessing()
}

/**
 * The actual work, as plain data. GET and POST ran byte-identical copies of this inline; it is
 * one function now so the cron path can be wrapped in telemetry without the two drifting.
 */
async function processDueWaiverWindows() {
  const seasons = await prisma.redraftSeason.findMany({
    where: { status: { in: ['active', 'drafting'] } },
    take: 20,
  })
  const results: { seasonId: string; processed: unknown[] }[] = []
  for (const s of seasons) {
    const processed = await processWaiverWindow(s.leagueId, s.id)
    results.push({ seasonId: s.id, processed })
  }
  return { results }
}

async function runWaiverProcessing() {
  return NextResponse.json(await processDueWaiverWindows())
}

/**
 * Vercel Cron issues a GET (`vercel.json`: "0 * * * *"), but this route only exported POST,
 * so every hourly run returned 405 and no waiver window was ever processed on schedule.
 *
 * POST keeps its existing `requireAdminOrBearer` gate untouched. GET is gated on
 * `requireCronAuth`, which is what Vercel's scheduler actually presents — and which already
 * accepts BRACKET_ADMIN_SECRET/ADMIN_PASSWORD, so this adds only the cron secrets.
 */
export async function GET(request: Request) {
  // Name CRON_SECRET explicitly, matching #289 — a bare call resolves LEAGUE_CRON_SECRET
  // first (it IS set in prod) and 401s against Vercel's `Bearer $CRON_SECRET`.
  if (!requireCronAuth(request as unknown as NextRequest, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  /*
   * The row is written before the body runs, so an hour with no active season — or a run the
   * platform kills at maxDuration, which executes no user code afterwards and so never closes
   * the row — still leaves a usable started_at for the freshness probe.
   */
  const out = await withSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    () => processDueWaiverWindows(),
    (r) => ({
      rowsRead: r.results.length,
      metadata: { seasonsProcessed: r.results.length },
    }),
  )
  return NextResponse.json(out)
}
