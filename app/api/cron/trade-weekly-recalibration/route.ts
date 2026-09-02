/**
 * GET/POST /api/cron/trade-weekly-recalibration
 *
 * Vercel Cron schedule: weekly (see vercel.json). Disabled by default —
 * calls runScheduledWeeklyRecalibration(), which no-ops unless
 * TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED=true. See
 * docs/TRADE_LEARNING_CALIBRATED_B0_OWNERSHIP_ADR.md and
 * docs/DECISION_OS_CLOSED_LOOP_LEARNING_AUDIT.md §7 Step 0.
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runScheduledWeeklyRecalibration } from "@/lib/trade-engine/auto-recalibration"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs — renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 */
const JOB = "cron-trade-weekly-recalibration"

async function handle() {
  const startedAt = Date.now()
  try {
    /*
     * ⚠ THE HEARTBEAT RECORDS EVEN WHILE THE FLAG IS OFF, AND THAT IS THE WHOLE POINT.
     *
     * `runScheduledWeeklyRecalibration` no-ops with zero Prisma calls unless
     * TRADE_ENGINE_WEEKLY_RECALIBRATION_ENABLED is "true", so `TradeLearningStats` holding zero
     * rows is the CORRECT steady state, not a failure — the old NO_PROBE note read that empty
     * table as "this job has never produced output on any scheduler" and concluded it was broken.
     * It is not broken; it is switched off.
     *
     * Recording only on the enabled path would leave the probe reporting CONFIG ("no rows for
     * job_name") for as long as the flag stays off, which is indistinguishable from a dead
     * scheduler — the exact confusion this probe exists to remove. So the wrap sits OUTSIDE the
     * flag check: it answers "did the weekly cron fire", which is true and checkable either way.
     *
     * ⚠ A DISABLED FIRE IS `success`, NOT `failed`, and the distinction lives in `rowsSkipped`
     * plus the reason in `warnings`. The job did exactly what it is configured to do. Recording
     * a deliberate no-op as a failure would make the weekly run red for as long as the flag is
     * off, which is the "alarm that is always red" this monitor exists to avoid. `SyncJobOutcome`
     * admits only success/partial/failed, so there is no `skipped` to reach for here — the row
     * still says which happened, through the counts and the reason string.
     */
    const outcome = await withSyncJobRun(
      { jobName: JOB, trigger: "cron" },
      () => runScheduledWeeklyRecalibration(),
      (r) => ({
        rowsWritten: r.ran ? 1 : 0,
        rowsSkipped: r.ran ? 0 : 1,
        status: "success" as const,
        warnings: r.reason ? [r.reason] : undefined,
      }),
    )
    return NextResponse.json({
      ok: true,
      ran: outcome.ran,
      reason: outcome.reason,
      durationMs: Date.now() - startedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/trade-weekly-recalibration] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle()
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle()
}
