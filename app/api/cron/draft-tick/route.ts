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
import { startScheduledSurvivorDrafts } from '@/lib/survivor/startScheduledSurvivorDrafts'
import { reportSurvivorAutomationError } from '@/lib/survivor/survivorAutomationReporting'
import { startScheduledDynastyDrafts, startScheduledRedraftDrafts } from '@/lib/draft/startScheduledRedraftDrafts'
import { fillAutoDraftBoards, type FillAutoDraftBoardsSummary } from '@/lib/live-draft-engine/autoDraftFill'
import { processExpiredDispersalPicks, type ExpiredDispersalPicksSummary } from '@/lib/dispersal-draft/expiredDispersalPicks'

export const dynamic = 'force-dynamic'

/** Default per-tick league scan cap. The scanner clamps to [1, 200] regardless. */
const DEFAULT_MAX_LEAGUES = 40

function isEnabled(): boolean {
  return process.env.DRAFT_TICK_CRON_ENABLED?.trim().toLowerCase() === 'true'
}

function dispersalMeta(summary: ExpiredDispersalPicksSummary) {
  return { scanned: summary.scanned, advanced: summary.advanced, errors: summary.errors.slice(0, 10) }
}

function autoDraftsMeta(summary: FillAutoDraftBoardsSummary) {
  return { scanned: summary.scanned, filled: summary.filled, picks: summary.picks, completed: summary.completed, errors: summary.errors.slice(0, 10) }
}

export async function GET(request: NextRequest) {
  /*
   * ⚠ NAME `CRON_SECRET` EXPLICITLY. `requireCronAuth` resolves
   * `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`, and
   * LEAGUE_CRON_SECRET is set in production — so a BARE call compares Vercel's
   * `Authorization: Bearer $CRON_SECRET` against the wrong variable and 401s
   * every time. This route is scheduled `* * * * *`, so that was 1,440 failed
   * invocations a day. Same fix as #289 / #304 on the other cron routes.
   *
   * The 401 also fired BEFORE the DRAFT_TICK_CRON_ENABLED check below, so the
   * response could not distinguish "not authorised" from "deliberately inert".
   */
  if (!requireCronAuth(request, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const requestedMax = Number(new URL(request.url).searchParams.get('maxLeagues'))
  const maxLeagues = Number.isFinite(requestedMax) && requestedMax > 0 ? requestedMax : DEFAULT_MAX_LEAGUES

  try {
    /*
     * THE WRAP SPANS THE WHOLE TICK, NOT JUST AUTOPICK.
     *
     * It used to start at `processExpiredDraftPicks`, below the DRAFT_TICK_CRON_ENABLED
     * early-return — so the DEFAULT path (flag off) recorded nothing at all, and this job
     * looked identical whether it was running every minute or not running since March. The
     * freshness probe reads max(started_at) for this job_name, so the row has to be written
     * on every fire, disabled ones included. `withSyncJobRun` writes it before the body runs,
     * which also means a tick the platform kills at maxDuration — no user code runs after a
     * kill, so nothing ever closes the row — still leaves a usable started_at behind.
     */
    const tick = await withSyncJobRun(
      { jobName: 'cron-draft-tick', trigger: 'cron', sport: 'NFL' },
      async () => {
        /*
         * MIRRORING RUNS FIRST, AND OUTSIDE THE FLAG.
         *
         * DRAFT_TICK_CRON_ENABLED guards server-side AUTOPICK — picking on a manager's behalf,
         * which is a visible behavioural change to a live draft and correctly defaults off.
         * Mirroring an externally-hosted Sleeper draft makes no pick and writes nothing
         * upstream; it copies a board Sleeper already shows. Putting it behind the autopick
         * switch would leave every imported league's draft board empty for an unrelated reason.
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

        // A scheduled Survivor draft is an explicit league setting. Start it on
        // the server even when browser-driven autopick is disabled.
        const survivorStarts = await startScheduledSurvivorDrafts().catch((error) => {
          reportSurvivorAutomationError(error, { job: 'draft_start' })
          return {
            scanned: 0, started: 0, skipped: 0,
            errors: [{ leagueId: '', error: error instanceof Error ? error.message : String(error) }],
          }
        })

        // Same for a redraft league (NFL/NBA/NHL/MLB) whose commissioner turned on Autostart Draft:
        // the scheduled time is the commissioner's instruction, not a pick made on anyone's behalf.
        const redraftStarts = await startScheduledRedraftDrafts().catch((error) => ({
          scanned: 0, started: 0, skipped: 0, skips: [] as Array<{ leagueId: string; reason: string }>,
          errors: [{ leagueId: '', error: error instanceof Error ? error.message : String(error) }],
        }))
        // And a dynasty league (startup or rookie draft) whose commissioner turned on Autostart Draft,
        // including a rookie draft the calendar opened with "start it N days after it opens".
        const dynastyStarts = await startScheduledDynastyDrafts().catch((error) => ({
          scanned: 0, started: 0, skipped: 0, skips: [] as Array<{ leagueId: string; reason: string }>,
          errors: [{ leagueId: '', error: error instanceof Error ? error.message : String(error) }],
        }))
        // An auto draft is the commissioner's instruction that the computer drafts every seat, so
        // like a scheduled start it runs whether or not server-side autopick is enabled.
        const autoDrafts: FillAutoDraftBoardsSummary = await fillAutoDraftBoards({ maxLeagues: 10, budgetMs: 40_000 }).catch((error) => ({
          scanned: 0, filled: 0, picks: 0, completed: 0, outcomes: [],
          errors: [{ leagueId: '', message: error instanceof Error ? error.message : String(error) }],
        }))
        // A dispersal draft's clock (lib/dispersal-draft/expiredDispersalPicks.ts): its commissioner switched
        // "Auto-pick on timeout" on and set the clock, so like an auto draft it runs whatever the flag says.
        const dispersal: ExpiredDispersalPicksSummary = await processExpiredDispersalPicks({ maxDrafts: 25 }).catch((error) => ({
          scanned: 0, advanced: 0, errors: [{ draftId: '', error: error instanceof Error ? error.message : String(error) }],
        }))
        const startErrors = survivorStarts.errors.length + redraftStarts.errors.length + dynastyStarts.errors.length + autoDrafts.errors.length + dispersal.errors.length

        // Autopick is inert until deliberately enabled — see SAFETY above.
        if (!isEnabled()) return { disabled: true as const, mirror, survivorStarts, redraftStarts, dynastyStarts, autoDrafts, dispersal, startErrors, summary: null }

        return { disabled: false as const, mirror, survivorStarts, redraftStarts, dynastyStarts, autoDrafts, dispersal, startErrors, summary: await processExpiredDraftPicks({ maxLeagues }) }
      },
      (r) =>
        r.summary
          ? {
              rowsRead: r.summary.scanned,
              rowsWritten: r.summary.processed,
              rowsSkipped: r.summary.skipped,
              // A per-league autopick failure must not fail the whole tick — the next
              // tick retries that league. Surface it as a degraded run instead.
              status: r.summary.errors.length > 0 || r.startErrors > 0 ? 'partial' : 'success',
              metadata: {
                scanned: r.summary.scanned,
                processed: r.summary.processed,
                skipped: r.summary.skipped,
                errorCount: r.summary.errors.length,
                errors: r.summary.errors.slice(0, 10),
                survivorStarts: r.survivorStarts,
                redraftStarts: { ...r.redraftStarts, skips: r.redraftStarts.skips.slice(0, 10) },
                dynastyStarts: { ...r.dynastyStarts, skips: r.dynastyStarts.skips.slice(0, 10) },
                autoDrafts: autoDraftsMeta(r.autoDrafts),
                dispersal: dispersalMeta(r.dispersal),
              },
            }
          : // Deliberately inert, not broken. `success` keeps the run out of the failure
            // telemetry while the heartbeat still proves the scheduler fired.
            { status: r.startErrors > 0 ? 'partial' : 'success',
              metadata: {
                autopickDisabled: true,
                survivorStarts: r.survivorStarts,
                redraftStarts: { ...r.redraftStarts, skips: r.redraftStarts.skips.slice(0, 10) },
                dynastyStarts: { ...r.dynastyStarts, skips: r.dynastyStarts.skips.slice(0, 10) },
                autoDrafts: autoDraftsMeta(r.autoDrafts),
                dispersal: dispersalMeta(r.dispersal),
              } },
    )

    if (tick.disabled) {
      return NextResponse.json({
        ok: true,
        disabled: true,
        reason: 'DRAFT_TICK_CRON_ENABLED is not "true" — autopick skipped, mirror still ran',
        mirror: tick.mirror,
        survivorStarts: tick.survivorStarts,
        redraftStarts: tick.redraftStarts,
        dynastyStarts: tick.dynastyStarts,
        autoDrafts: autoDraftsMeta(tick.autoDrafts),
        dispersal: dispersalMeta(tick.dispersal),
        ranAt: new Date().toISOString(),
      })
    }

    return NextResponse.json({ ok: true, ...tick.summary, mirror: tick.mirror, survivorStarts: tick.survivorStarts, redraftStarts: tick.redraftStarts, dynastyStarts: tick.dynastyStarts, autoDrafts: autoDraftsMeta(tick.autoDrafts), dispersal: dispersalMeta(tick.dispersal), ranAt: new Date().toISOString() })
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
