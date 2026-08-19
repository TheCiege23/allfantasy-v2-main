/**
 * GET /api/cron/draft-tick — server-authoritative draft advancement.
 *
 * Scans for in-progress snake/linear drafts whose pick timer has expired and
 * auto-picks for them (queue-first, then best-available), via the already-tested
 * `processExpiredDraftPicks` scanner.
 *
 * WHY THIS EXISTS: before this route, `processExpiredDraftPicks` had zero
 * production callers. Draft advancement was driven entirely by a connected
 * browser — `runAutomationTicksThrottled` off the live-sync poll, plus the
 * client-initiated `autopick-expired` route. If every manager closed their tab,
 * an expired timer never fired and a slow/overnight draft stalled indefinitely.
 * This makes the server the one that moves the draft forward.
 *
 * SAFETY: gated behind `DRAFT_TICK_CRON_ENABLED`, which defaults to OFF. Enabling
 * server-side autopick is a visible behavioural change to live drafts, so
 * deploying this route is inert until someone deliberately flips the flag. When
 * disabled it returns 200 (not an error) so the schedule stays green and does not
 * generate false failure telemetry.
 *
 * Cron-auth protected + instrumented (SyncJobRun), matching `live-score-tick`.
 * Idempotent: a draft with no expired timer is skipped and does no writes.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { processExpiredDraftPicks } from '@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks'
import { mirrorActiveSleeperDrafts } from '@/lib/draft/mirrorActiveSleeperDrafts'

export const dynamic = 'force-dynamic'

/** Default per-tick league scan cap. The scanner clamps to [1, 200] regardless. */
const DEFAULT_MAX_LEAGUES = 40

function isEnabled(): boolean {
  return process.env.DRAFT_TICK_CRON_ENABLED?.trim().toLowerCase() === 'true'
}

export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /*
   * MIRRORING RUNS FIRST, AND OUTSIDE THE FLAG.
   *
   * DRAFT_TICK_CRON_ENABLED guards server-side AUTOPICK — picking on a manager's behalf,
   * which is a visible behavioural change to a live draft and correctly defaults off.
   * Mirroring an externally-hosted Sleeper draft makes no pick and writes nothing upstream;
   * it copies a board Sleeper already shows. Putting it behind the autopick switch would
   * leave every imported league's draft board empty for an unrelated reason.
   *
   * `syncDraftFromSleeper` had zero callers before this — the same failure the autopick
   * scanner had, and the reason this route exists at all.
   *
   * Failure is contained: a mirror problem must not stop autopick from advancing a draft.
   */
  let mirror: Awaited<ReturnType<typeof mirrorActiveSleeperDrafts>> | { error: string } | null = null
  try {
    mirror = await mirrorActiveSleeperDrafts({ maxDrafts: 40 })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[cron/draft-tick] sleeper mirror failed:', message)
    mirror = { error: message.slice(0, 200) }
  }

  // Autopick is inert until deliberately enabled — see SAFETY above.
  if (!isEnabled()) {
    return NextResponse.json({
      ok: true,
      disabled: true,
      reason: 'DRAFT_TICK_CRON_ENABLED is not "true" — autopick skipped, mirror still ran',
      mirror,
      ranAt: new Date().toISOString(),
    })
  }

  const requestedMax = Number(new URL(request.url).searchParams.get('maxLeagues'))
  const maxLeagues = Number.isFinite(requestedMax) && requestedMax > 0 ? requestedMax : DEFAULT_MAX_LEAGUES

  try {
    const summary = await withSyncJobRun(
      { jobName: 'cron-draft-tick', trigger: 'cron', sport: 'NFL' },
      async () => processExpiredDraftPicks({ maxLeagues }),
      (r) => ({
        rowsRead: r.scanned,
        rowsWritten: r.processed,
        rowsSkipped: r.skipped,
        // A per-league autopick failure must not fail the whole tick — the next
        // tick retries that league. Surface it as a degraded run instead.
        status: r.errors.length > 0 ? 'partial' : 'success',
        metadata: {
          scanned: r.scanned,
          processed: r.processed,
          skipped: r.skipped,
          errorCount: r.errors.length,
          errors: r.errors.slice(0, 10),
        },
      }),
    )

    return NextResponse.json({ ok: true, ...summary, mirror, ranAt: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'draft-tick failed' },
      { status: 500 },
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
