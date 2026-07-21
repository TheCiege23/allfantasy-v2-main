/**
 * GET /api/cron/live-score-tick — scheduled live-scoring tick (G11 Phase 3b).
 *
 * Drives the reusable live-scoring orchestrator for every active redraft season via
 * the real NFL provider: poll only active games, persist only changed stat lines,
 * rescore only affected matchups/standings, broadcast only affected entities over
 * SSE. Cron-auth protected + instrumented (SyncJobRun). Idempotent — an unchanged
 * poll does no writes. The 5-minute full score-sync remains as a reconciliation/
 * correction fallback.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { runLiveScoringForActiveSeasons } from '@/server/services/liveScoring/liveScoreRunner'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`, and
  // LEAGUE_CRON_SECRET is set in production — so a BARE call compares Vercel's
  // `Authorization: Bearer $CRON_SECRET` against the wrong variable and 401s. This route is
  // scheduled `*/2` and was doing exactly that: 60 invocations / 60 x 401 in a 2h production
  // sample, never once running. Naming CRON_SECRET explicitly is the same fix as #289.
  if (!requireCronAuth(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const report = await withSyncJobRun(
      { jobName: 'cron-live-score-tick', trigger: 'cron', provider: 'sleeper', sport: 'NFL' },
      async () => runLiveScoringForActiveSeasons(prisma),
      (r) => ({
        rowsRead: r.ticked,
        rowsUpdated: r.summaries.reduce((s, x) => s + x.affectedMatchups, 0),
        status: 'success',
        metadata: { seasonsTicked: r.ticked, seasonsPolled: r.polled },
      }),
    )
    return NextResponse.json({ ok: true, ...report, ranAt: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'live-score-tick failed' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
