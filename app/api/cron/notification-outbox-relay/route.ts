/**
 * GET/POST /api/cron/notification-outbox-relay
 *
 * Drains `notification_outbox` — the consumer that `lib/automation/notifications.ts` has been
 * promising since it was written ("Twilio / Resend dispatch reads from this table in a later
 * worker") and that never existed. See lib/notifications/outboxRelay.ts for the full account.
 *
 * Scheduled every 5 minutes in cron-schedule.json, matching `/api/cron/waivers` — the job that
 * produces most of this queue's volume. A waiver result that arrives 5 minutes late is fine; one
 * that never arrives is what this fixes.
 *
 * Query params:
 *   limit   — rows per pass (default 100, max 500)
 *   dryRun  — count what is due without dispatching or recording a heartbeat
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { relayNotificationOutbox } from "@/lib/notifications/outboxRelay"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs — renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 */
const JOB = "cron-notification-outbox-relay"

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") === "1"
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw && /^\d{1,3}$/.test(limitRaw) ? Number(limitRaw) : undefined

  const startedAt = Date.now()

  try {
    const run = () => relayNotificationOutbox({ limit, dryRun })

    /*
     * A dry run records NOTHING, deliberately: the freshness probe matches on job_name alone, so a
     * row written by a hand-issued smoke test would be indistinguishable from a scheduled fire and
     * could hide a dead scheduler. Same reasoning as `cron/compute-projections`.
     */
    const result = dryRun
      ? await run()
      : await withSyncJobRun({ jobName: JOB, trigger: "cron" }, run, (r) => ({
          rowsRead: r.claimed,
          rowsWritten: r.sent,
          rowsSkipped: r.skipped + r.retried,
          /*
           * PARTIAL, not success, when anything exhausted its retries. A relay that reports
           * success while dropping mail on the floor is the same class of lie this whole worker
           * exists to end.
           */
          status: r.failed > 0 ? ("partial" as const) : ("success" as const),
        }))

    return NextResponse.json({
      ok: true,
      dryRun,
      ...result,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/notification-outbox-relay] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return handle(req)
}
