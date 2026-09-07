import { NextResponse, type NextRequest } from 'next/server'
import { requireAdminOrBearer } from '@/lib/adminAuth'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'
import { rollPostseason, rollSeasonWeeks } from '@/lib/season-week/rollSeasonWeek'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * CONDITIONAL, and unusually so: a week boundary is a WEEKLY event, so the
 * healthy result for roughly 167 of every 168 hourly runs is "advanced 0". A
 * freshness probe on `redraft_seasons.updatedAt` would therefore read stale
 * exactly when this job is working. Only the scheduled GET records a run; the
 * admin POST must not, or a manual invocation masks a dead scheduler.
 */
const JOB = 'cron-season-week-roll'

/**
 * Advance every running league past a finished real-world week.
 *
 * 🛑 THIS IS THE MISSING CALLER, NOT NEW MACHINERY. `advance_week` and its guards
 * have been correct and unreachable since they were written; measured 2026-09-07,
 * all 246 seasons in production sit at `currentWeek = 1` because nothing invokes
 * them. Everything downstream — playoff bracket generation, which fires on the
 * `regular_season_complete` transition, and therefore the whole postseason and
 * offseason chain — has never run for the same reason.
 *
 * ⚠ DELIBERATELY NOT PUT BEHIND AN ENABLE FLAG, and that is a decision rather
 * than an omission. `app/api/cron/draft-tick` is the cautionary case in this
 * repo: it is scheduled every minute and its autopick half has been inert since
 * it shipped because `DRAFT_TICK_CRON_ENABLED` was never set anywhere but a
 * test. A flag that defaults off on a job whose entire purpose is to stop things
 * silently not happening reproduces the bug it is meant to prevent. The safety
 * here is structural instead:
 *
 *   - the scope is native leagues only (`engineSeasonScope`), which today is 4
 *     seasons, all the owner's own test leagues;
 *   - the runtime's own guards still apply — an unfinalized matchup refuses the
 *     advance and is reported, never overridden;
 *   - it is self-limiting: advancing increments `currentWeek`, so the next tick
 *     holds on `SLATE_IN_PROGRESS`. It cannot run away.
 *
 * `?dryRun=1` decides and reports without writing, for inspecting a run before
 * trusting it.
 */
async function run(options: { dryRun: boolean; limit?: number }) {
  // Both phases in one job, in this order. A league that advances out of its
  // final regular week lands on `regular_season_complete` with a bracket
  // already generated; running the postseason pass immediately after means it
  // is picked up on the same tick rather than an hour later.
  const regular = await rollSeasonWeeks({ dryRun: options.dryRun, limit: options.limit })
  const postseason = await rollPostseason({ dryRun: options.dryRun, limit: options.limit })
  return { ok: true as const, dryRun: options.dryRun, ...regular, postseason }
}

function readOptions(request: Request): { dryRun: boolean; limit?: number } {
  const url = new URL(request.url)
  const limitRaw = Number(url.searchParams.get('limit'))
  return {
    dryRun: url.searchParams.get('dryRun') === '1',
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : undefined,
  }
}

/** Admin/manual path. Uninstrumented on purpose — see the JOB comment. */
export async function POST(request: Request) {
  const gate = await requireAdminOrBearer(request)
  if (!gate.ok) return gate.res
  return NextResponse.json(await run(readOptions(request)))
}

export async function GET(request: Request) {
  // Name CRON_SECRET explicitly. `requireCronAuth` otherwise resolves
  // LEAGUE_CRON_SECRET first, which IS set in prod, so a bare call compares the
  // scheduler's `Bearer $CRON_SECRET` against the wrong variable and 401s — the
  // failure that left 13 other routes silently dead.
  if (!requireCronAuth(request as unknown as NextRequest, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const options = readOptions(request)

  // The row is written before the body runs, so an hour that legitimately
  // advances nothing — and a run the platform kills at maxDuration, which
  // executes no user code afterwards — still leaves a usable started_at.
  const out = await withSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    () => run(options),
    (r) => ({
      rowsWritten:
        r.advanced + r.postseason.generated + r.postseason.advanced + r.postseason.finalized,
      rowsRead: r.considered + r.postseason.considered,
      // A refusal is a degraded run, not a dead one: the sweep worked and a
      // league needs a human. Reporting it as success hides exactly the case
      // this job exists to surface.
      status: r.failed > 0 ? 'partial' : 'success',
      metadata: {
        considered: r.considered,
        advanced: r.advanced,
        held: r.held,
        failed: r.failed,
        postseason: {
          considered: r.postseason.considered,
          generated: r.postseason.generated,
          advanced: r.postseason.advanced,
          finalized: r.postseason.finalized,
          held: r.postseason.held,
        },
        holdReasons: r.outcomes.reduce<Record<string, number>>((acc, o) => {
          if (o.plan.action === 'hold') acc[o.plan.reason] = (acc[o.plan.reason] ?? 0) + 1
          return acc
        }, {}),
      },
    }),
  )
  return NextResponse.json(out)
}
