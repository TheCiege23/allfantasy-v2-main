/**
 * GET|POST /api/cron/legacy-import-drain
 *
 * Server-side backstop for the /af-legacy guest import.
 *
 * The import is normally advanced by a CLIENT pump: while the /af-legacy tab is mounted it
 * polls import/status every ~3s and each poll fires GET /api/legacy/worker/run, which processes
 * ONE season step. If the tab navigates away or closes mid-import, nothing advances the job and it
 * stalls partway. Neither guest-import nor the import route triggers processing, and no other cron
 * drains the queue.
 *
 * This cron drains queued|running legacyImportJob rows using the SAME per-step path as
 * worker/run (runLegacyImportStep), oldest-first, looping step-by-step until the queue is empty or
 * a wall-clock budget is hit. It does NOT replace the client pump — it is a backstop, so a job
 * finishes whether or not a tab stays open. Scheduled every minute in vercel.json.
 *
 * Per-step model is preserved so a single serverless invocation stays short.
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runLegacyImportStep } from "@/lib/legacy-import"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * This job is CONDITIONAL: it only has work when a guest has queued an import, so the queue is
 * empty on the overwhelming majority of its once-a-minute fires and LegacyImportJob can be
 * weeks old while the drain is perfectly healthy. The empty-queue runs are exactly the ones
 * that must still record a row.
 */
const JOB = "cron-legacy-import-drain"

// Leave headroom under maxDuration so the function returns cleanly rather than being killed
// mid-step by the platform timeout.
const TIME_BUDGET_MS = 50_000
// Hard cap so a persistently-failing job (each step re-queues it) can never spin forever within
// one invocation. A real import is bounded by MIN_YEAR..CURRENT_YEAR season steps.
const MAX_STEPS = 400

/** The drain itself, as plain data, so the scheduled path can be wrapped in telemetry. */
async function drain() {
  const startedAt = Date.now()
  let steps = 0
  let jobsAdvanced = 0
  let jobsCompleted = 0
  const seenBlocked = new Set<string>()

  while (Date.now() - startedAt < TIME_BUDGET_MS && steps < MAX_STEPS) {
    const job = await prisma.legacyImportJob.findFirst({
      where: { status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, sleeperUserId: true } } },
    })

    if (!job) break // queue drained

    // A job whose LegacyUser is gone can never progress — fail it so it leaves the queue,
    // exactly as worker/run does, otherwise findFirst would return it forever.
    if (!job.user) {
      await prisma.legacyImportJob.update({
        where: { id: job.id },
        data: { status: "failed", progress: 100, completedAt: new Date(), error: "LegacyUser not found" },
      })
      continue
    }

    try {
      const result = await runLegacyImportStep(job.id, job.user.id, job.user.sleeperUserId)
      steps += 1
      jobsAdvanced += 1
      if (result.done) jobsCompleted += 1
    } catch (e) {
      // Mark failed (matches worker/run) so it exits the queue and the loop can proceed to the
      // next job rather than re-selecting this one every iteration.
      const message = e instanceof Error ? e.message : String(e)
      await prisma.legacyImportJob.update({
        where: { id: job.id },
        data: { status: "failed", completedAt: new Date(), error: message.slice(0, 240) },
      }).catch(() => {})
      seenBlocked.add(job.id)
      steps += 1
    }
  }

  return {
    ok: true,
    steps,
    jobsCompleted,
    failed: seenBlocked.size,
    hitTimeBudget: Date.now() - startedAt >= TIME_BUDGET_MS,
    hitStepCap: steps >= MAX_STEPS,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  /*
   * The row lands before the drain starts, so the (usual) empty-queue minute still records a
   * heartbeat — and so does a run the platform kills at maxDuration, which executes no user
   * code afterwards and therefore never closes the row. Only the SCHEDULED GET records one;
   * POST is the manual re-drain.
   */
  const result = await withSyncJobRun(
    { jobName: JOB, trigger: "cron" },
    () => drain(),
    (r) => ({
      rowsRead: r.steps,
      rowsWritten: r.jobsCompleted,
      // A step that failed marks its job failed and moves on; the drain itself still worked.
      status: r.failed > 0 ? "partial" : "success",
      metadata: {
        steps: r.steps,
        jobsCompleted: r.jobsCompleted,
        jobsFailed: r.failed,
        hitTimeBudget: r.hitTimeBudget,
        hitStepCap: r.hitStepCap,
      },
    }),
  )
  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return NextResponse.json(await drain())
}
