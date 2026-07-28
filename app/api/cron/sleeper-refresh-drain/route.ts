/**
 * GET|POST /api/cron/sleeper-refresh-drain
 *
 * Durable WORKER for user-initiated Sleeper current-state refresh jobs (Launch Batch 2 · B6).
 *
 * A manual resync enqueues a `pending` AutomationJob (jobType `sleeper.currentStateRefresh`) and returns
 * 202 without touching Sleeper. This cron drains those pending jobs out-of-band — it survives browser
 * navigation, refreshes, client disconnects, and serverless termination (the job is a durable DB row; a
 * crashed run leaves it pending/running and the next pass re-runs it, guarded by the per-league lock).
 *
 * IMPORTANT SCOPE: this ONLY processes jobs a user explicitly queued via the resync button. It is NOT the
 * automatic all-leagues portfolio sweep (`/api/cron/fantasy-os-exec-sync`, gated behind
 * FANTASY_OS_EXEC_SYNC_LIVE), which stays disabled. Per-step model + wall-clock budget keep each
 * invocation short (mirrors `/api/cron/legacy-import-drain`).
 */
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { runSleeperRefreshJob } from '@/lib/fantasy-os/sync/refreshJob/runSleeperRefreshJob'
import { SLEEPER_REFRESH_JOB_TYPE } from '@/lib/fantasy-os/sync/refreshJob/constants'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Leave headroom under maxDuration so the function returns cleanly rather than being killed mid-job.
const TIME_BUDGET_MS = 50_000
// Hard cap so a burst of queued jobs (or a retryable job re-pending) can never spin forever in one pass.
const MAX_JOBS = 25

async function handle() {
  const startedAt = Date.now()
  let processed = 0
  let completed = 0
  let failed = 0
  let retried = 0
  // Process each pending job at most once per invocation — a job that re-pends (retryable) is picked up
  // on the NEXT scheduled pass, not re-selected in a hot loop here.
  const seen = new Set<string>()

  while (Date.now() - startedAt < TIME_BUDGET_MS && processed < MAX_JOBS) {
    const job = await prisma.automationJob.findFirst({
      where: {
        jobType: SLEEPER_REFRESH_JOB_TYPE,
        status: 'pending',
        ...(seen.size ? { id: { notIn: Array.from(seen) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true, leagueId: true, userId: true, idempotencyKey: true, metadata: true },
    })
    if (!job) break // queue drained

    seen.add(job.id)
    processed += 1

    try {
      const out = await runSleeperRefreshJob({
        jobType: SLEEPER_REFRESH_JOB_TYPE,
        idempotencyKey: job.idempotencyKey,
        leagueId: job.leagueId ?? undefined,
        userId: job.userId ?? undefined,
        metadata: (job.metadata ?? {}) as Record<string, unknown>,
      })
      if (out.status === 'completed') completed += 1
      else if (out.status === 'pending') retried += 1
      else failed += 1
    } catch {
      // runAutomationJob already recorded the failure on the job/run; count and continue.
      failed += 1
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    completed,
    failed,
    retried,
    hitTimeBudget: Date.now() - startedAt >= TIME_BUDGET_MS,
    hitJobCap: processed >= MAX_JOBS,
    durationMs: Date.now() - startedAt,
    timestamp: new Date().toISOString(),
  })
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle()
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return handle()
}
