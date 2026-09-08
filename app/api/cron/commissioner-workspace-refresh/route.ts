import { NextResponse } from 'next/server'

import { writeAutomationAuditLog } from '@/lib/automation/audit'
import { toErrorMessage } from '@/lib/automation/errors'
import { discoverWorkspaceRefreshLeagues } from '@/lib/automation/jobs/workspace/discoverWorkspaceRefreshLeagues'
import { refreshWorkspaceTasksBatch } from '@/lib/automation/jobs/workspace/refreshWorkspaceTasksJob'
import { generateScheduledReportsBatch } from '@/lib/automation/jobs/reports/generateScheduledReportsJob'
import { withSyncJobRun } from '@/lib/production-health/syncJobRunTelemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * ⚠ UNLIKE `cron-waivers`, THIS ONE IS NOT CONDITIONAL. Every league with imported activity is in
 * scope every day — a healthy league still needs the scan that closes yesterday's findings — so an
 * output probe on `automation_runs` is a valid liveness signal here, not merely a seasonal one.
 * The `sync_job_runs` row is still written on every fire, for the same reason the waiver sweep
 * writes one: it is what proves the scheduler is alive independently of whether work was found.
 */
const JOB = 'cron-commissioner-workspace-refresh'

/**
 * GET /api/cron/commissioner-workspace-refresh
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 *
 * 🛑 CRONS RUN ON THE WORKER SERVICE, NOT `allfantasy-v2-main`, and the worker deploys from
 * `worker-release` — which fast-forwards once a day. Landing this on `main` does not make it run;
 * `git ls-remote origin refs/heads/worker-release` is what says whether the container executing
 * crons has it yet. See the root CLAUDE.md.
 */
function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const auth = request.headers.get('authorization')
  const bearer = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  if (bearer && bearer === secret) return true

  if (process.env.NODE_ENV !== 'production') {
    const q = new URL(request.url).searchParams.get('secret')
    if (q && q === secret) return true
  }

  return false
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get('dryRun') === 'true'
  const leagueId = url.searchParams.get('leagueId') ?? undefined
  const limitRaw = url.searchParams.get('limit')
  const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw) || 25)) : 25

  /*
   * A dry run writes NO heartbeat, deliberately. The freshness probe matches on job name alone, so
   * a row written by a hand-issued smoke test would be indistinguishable from a scheduled fire and
   * could hide a dead scheduler — the same reasoning `cron-waivers` records.
   */
  if (dryRun) {
    try {
      const rows = await discoverWorkspaceRefreshLeagues({ limit, leagueId })
      return NextResponse.json({
        ok: true,
        dryRun: true,
        discovered: rows.length,
        results: rows.map((r) => ({
          leagueId: r.leagueId,
          lastActivityAt: r.lastActivityAt.toISOString(),
        })),
      })
    } catch (error) {
      const detail = toErrorMessage(error)
      await writeAutomationAuditLog({
        action: 'workspace.cron.discovery_failed',
        entityType: 'system',
        entityId: 'cron',
        message: detail,
      }).catch(() => {})
      return NextResponse.json(
        { ok: false, error: process.env.NODE_ENV === 'production' ? 'discovery_failed' : detail },
        { status: 500 },
      )
    }
  }

  /*
   * ⚠ TWO JOBS, ONE CRON ENTRY, AND THAT IS A BUDGET DECISION NOT A DESIGN ONE.
   * `scripts/cron-budget-check.mjs` caps the registry at 60 schedules and it is AT 60 — measured
   * 2026-09-08. A 61st entry fails the budget check and blocks every PR that touches the registry.
   * The two still write separate `automation_runs` rows under separate job types, so the ledger
   * and Automation Center distinguish them exactly as if they had their own schedules; only this
   * entry point and the heartbeat are shared.
   *
   * The scan runs FIRST on purpose: reports package what the scan has just refreshed, so running
   * them in the other order would generate this week's digest from last night's picture.
   */
  const outcome = await withSyncJobRun(
    { jobName: JOB, trigger: 'cron' },
    async () => {
      const workspace = await refreshWorkspaceTasksBatch({ limit, leagueId })
      const reports = await generateScheduledReportsBatch({ limit, leagueId }).catch((e) => {
        // Report generation must never take the task scan's heartbeat down with it — the scan is
        // the thing whose absence makes every other commissioner surface lie.
        console.error('[cron-commissioner] report generation failed:', toErrorMessage(e))
        return { enabled: true, discovered: 0, completed: 0, skipped: 0, failed: 1, generated: 0 }
      })
      return { ...workspace, reports }
    },
    (r) => ({
      rowsRead: r.discovered,
      rowsWritten: r.completed,
      status: r.failed > 0 || r.reports.failed > 0 ? 'partial' : 'success',
      /*
       * ⚠ `enabled` IS IN THE TELEMETRY BECAUSE A GATED RUN AND A RUN THAT FOUND NO WORK ARE
       * OTHERWISE THE SAME ROW — zero read, zero written, status success. Those are opposite
       * situations: one means the feature is switched off, the other means every league is
       * healthy. Without this field the freshness monitor would report a permanently disabled
       * job as a permanently healthy one.
       */
      metadata: {
        enabled: r.enabled,
        discovered: r.discovered,
        completed: r.completed,
        skipped: r.skipped,
        failed: r.failed,
        reportsEnabled: r.reports.enabled,
        reportsGenerated: r.reports.generated,
        reportsFailed: r.reports.failed,
      },
    }),
  )

  return NextResponse.json({
    ok: outcome.failed === 0 && outcome.reports.failed === 0,
    enabled: outcome.enabled,
    dryRun: false,
    discovered: outcome.discovered,
    completed: outcome.completed,
    skipped: outcome.skipped,
    failed: outcome.failed,
    reports: outcome.reports,
    results: outcome.leagues,
  })
}
