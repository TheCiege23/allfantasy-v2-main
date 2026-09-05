import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { requireCronAuth } from '../_auth'
import { reapAllAbandonedRuns } from '@/lib/production-health/syncJobRunTelemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * GET /api/cron/reap-sync-runs
 *
 * Marks `SyncJobRun` rows stuck in `running` as `failed`, across every job name.
 *
 * WHY THIS EXISTS. `withSyncJobRun` already reaps abandoned rows, but only for the job that is
 * firing, at the moment it fires. So a job self-heals exactly as long as it keeps running — and
 * the job that stopped running is the one whose telemetry is worth trusting. Its last row stays
 * `running` forever, and `computeJobHealth` checks `runningTooLong` BEFORE its freshness
 * branches, so the deadest job on the board reports amber "appears stuck" instead of escalating
 * to red. Worse, for the first `stuckAfterH` (2h) after each fire it reports healthy outright, so
 * a job that dies nightly looks green every morning.
 *
 * This sweep restores the normal failed → very-stale escalation for jobs that will never fire
 * again. It is the piece that could not be built while the repo sat at Vercel's 2048-route
 * ceiling under a standing no-new-routes rule; production moved to Railway on 2026-09-02 and the
 * rule was retired on 2026-09-05.
 *
 * DELIBERATELY NOT WRAPPED IN `withSyncJobRun`. The reaper is the thing that cleans up orphaned
 * `running` rows; instrumenting it would let it create the exact row it exists to remove, and a
 * reaper that can orphan itself is worse than no reaper. Its observability is this response body
 * and the GitHub Actions run log instead.
 */
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const { available, reaped, cutoff } = await reapAllAbandonedRuns()

  // `reaped: 0` is ambiguous on its own — it reads the same for "nothing was stale" and "the
  // model was unreachable". Report which, so a silently blind sweep cannot pass for a clean one.
  if (!available) {
    return NextResponse.json(
      {
        ok: false,
        reaped: 0,
        cutoff,
        error: 'sync-job telemetry unavailable — the sweep could not run, this is NOT a clean zero',
      },
      { status: 503 },
    )
  }

  return NextResponse.json({ ok: true, reaped, cutoff })
}
