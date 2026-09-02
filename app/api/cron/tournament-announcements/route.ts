import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { postDueTournamentAnnouncements } from '@/lib/tournament/postDueAnnouncements'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

/**
 * Post tournament announcements whose scheduled time has arrived.
 *
 * 🛑 WITHOUT THIS, "SCHEDULE" MEANS "SAVE AND FORGET". `sendTournamentBroadcast`
 * writes a scheduled message as an unposted `TournamentAnnouncement` with its
 * time — a row, not a timer. Until something sweeps those rows, a commissioner
 * who schedules the redraft notice for Tuesday gets nothing sent on Tuesday.
 *
 * ⚠ THE SCHEDULE IS NOT REGISTERED BY THIS FILE, and the note that used to sit
 * here was out of date in a way that mattered. It said the schedules "live in
 * the Vercel dashboard"; they do not, and Vercel executes none of them. The
 * registry is `cron-schedule.json`, and two GitHub Actions workflows read it at
 * run time — `cron-slow-tier.yml` for hourly-or-slower jobs, which is this one
 * at `0 * * * *`. So this endpoint IS scheduled, and has been.
 *
 * ⚠ A SLOW-TIER JOB NEEDS ITS SCHEDULE LISTED IN THAT WORKFLOW'S `on.schedule`
 * BLOCK TOO. `0 * * * *` is already there. Adding a cron on a NEW expression
 * without adding the trigger leaves it declared and never fired —
 * `scripts/cron-budget-check.mjs` fails the PR and names the line to add.
 *
 * ⚠ `CRON_SECRET` IS NAMED EXPLICITLY. A bare `requireCronAuth(req)` checks
 * `LEAGUE_CRON_SECRET` first and 401s whenever that variable holds something
 * else, which is what took several crons down in production — see the note in
 * `/api/cron/import-players`.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs — renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 */
const JOB = 'cron-tournament-announcements'

async function handle(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  /* A dry run reports what WOULD post. Useful the first time this is wired up,
     when the cost of being wrong is a message to a few hundred people. */
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const limit = Number(url.searchParams.get('limit'))

  const run = () =>
    postDueTournamentAnnouncements({
      dryRun,
      limit: Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : undefined,
    })

  /*
   * The heartbeat `scripts/cron-freshness-check.mjs` reads for this job. It records on every
   * SCHEDULED fire including the no-work ones, which is the whole point: posting nothing is the
   * ordinary outcome between broadcasts, so "did this run" is the only question an output probe
   * could not answer without sitting red for weeks.
   *
   * A dry run records NOTHING, deliberately — the probe matches on job_name alone, so a row
   * written by a hand-issued smoke test would be indistinguishable from a scheduled fire and
   * could hide a dead scheduler. Same reasoning as `cron/notification-outbox-relay`.
   */
  const result = dryRun
    ? await run()
    : await withSyncJobRun({ jobName: JOB, trigger: 'cron' }, run, (r) => ({
        rowsRead: r.due,
        rowsWritten: r.posted,
        rowsSkipped: r.skipped.length,
        /*
         * PARTIAL when anything was due and skipped. A sweep that reports success while leaving
         * a commissioner's scheduled notice unsent is the failure this route exists to end.
         */
        status: r.skipped.length > 0 ? ('partial' as const) : ('success' as const),
      }))

  return NextResponse.json(result)
}

export const GET = handle
export const POST = handle
