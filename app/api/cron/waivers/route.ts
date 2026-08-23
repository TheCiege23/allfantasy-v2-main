import { NextResponse } from "next/server"

import { writeAutomationAuditLog } from "@/lib/automation/audit"
import { toErrorMessage } from "@/lib/automation/errors"
import { discoverDueWaiverLeagues } from "@/lib/automation/jobs/waivers/discoverDueWaiverLeagues"
import { processLeagueWaiversJob } from "@/lib/automation/jobs/waivers/processLeagueWaiversJob"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Heartbeat job name, probed by scripts/cron-freshness-check.mjs.
 *
 * This job is CONDITIONAL: outside the season there are no waivers due, so it correctly
 * discovers nothing and writes nothing. An output probe on automation_runs is therefore red
 * for most of the year, which is why the sweep records a sync_job_runs row on EVERY scheduled
 * fire — including the ones that find no work. The row is what proves the scheduler is alive.
 */
const JOB = "cron-waivers"

/**
 * GET /api/cron/waivers
 * Auth: `Authorization: Bearer ${CRON_SECRET}`.
 * Non-production: `?secret=${CRON_SECRET}` allowed for local smoke tests (omit in production callers).
 *
 * Reuses discovery + `processLeagueWaiversJob` → `processWaiverClaimsForLeague` (`lib/waiver-wire/process-engine.ts`).
 */
function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const auth = request.headers.get("authorization")
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null
  if (bearer && bearer === secret) return true

  if (process.env.NODE_ENV !== "production") {
    const q = new URL(request.url).searchParams.get("secret")
    if (q && q === secret) return true
  }

  return false
}

type DiscoveredRows = Awaited<ReturnType<typeof discoverDueWaiverLeagues>>

/**
 * Discovery, keeping the audit-log write and production message-redaction this route has always
 * done. Returns a discriminated result rather than a Response so the sweep below can be wrapped
 * in telemetry and still fail with exactly the body it used to.
 */
async function discoverOrExplain(args: { limit: number; leagueId?: string }): Promise<
  { ok: true; rows: DiscoveredRows } | { ok: false; safe: string; detail: string }
> {
  try {
    const rows = await discoverDueWaiverLeagues({
      limit: args.limit,
      leagueId: args.leagueId,
      now: new Date(),
    })
    return { ok: true, rows }
  } catch (discoverError: unknown) {
    const detail = toErrorMessage(discoverError)
    await writeAutomationAuditLog({
      action: "waivers.cron.discovery_failed",
      entityType: "system",
      entityId: "cron",
      message: detail,
    }).catch(() => {})
    return {
      ok: false,
      safe: process.env.NODE_ENV === "production" ? "discovery_failed" : detail,
      detail,
    }
  }
}

type SweepResult =
  | { kind: "discovery_failed"; safe: string; detail: string }
  | {
      kind: "swept"
      discovered: number
      processed: number
      failed: number
      results: Array<Record<string, unknown>>
    }

async function sweepDueWaiverLeagues(args: { limit: number; leagueId?: string }): Promise<SweepResult> {
  const discovered = await discoverOrExplain(args)
  if (!discovered.ok) {
    return { kind: "discovery_failed", safe: discovered.safe, detail: discovered.detail }
  }

  const results: Array<Record<string, unknown>> = []
  let processed = 0
  let failed = 0

  for (const row of discovered.rows) {
    try {
      const out = await processLeagueWaiversJob({
        leagueId: row.leagueId,
        scheduledFor: row.scheduledFor,
        trigger: "cron",
      })
      results.push({
        leagueId: row.leagueId,
        ok: out.ok,
        automationJobId: out.automationJobId,
        summary: out.summary,
        message: out.message,
      })
      if (out.ok) processed += 1
      else failed += 1
    } catch (error: unknown) {
      failed += 1
      const safe =
        process.env.NODE_ENV === "production"
          ? "processing_failed"
          : toErrorMessage(error)
      results.push({
        leagueId: row.leagueId,
        ok: false,
        error: safe,
      })
      await writeAutomationAuditLog({
        leagueId: row.leagueId,
        action: "waivers.cron.league_failed",
        entityType: "league",
        entityId: row.leagueId,
        message: toErrorMessage(error),
      }).catch(() => {})
    }
  }

  return { kind: "swept", discovered: discovered.rows.length, processed, failed, results }
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  const leagueId = url.searchParams.get("leagueId") ?? undefined
  const limitRaw = url.searchParams.get("limit")
  const limit = limitRaw ? Math.min(100, Math.max(1, Number(limitRaw) || 25)) : 25

  /*
   * A dry run processes nothing and is only ever issued by hand. It deliberately records NO
   * heartbeat: the freshness probe matches on job_name alone, so a row written here would make
   * a manual smoke test indistinguishable from a scheduled fire and could hide a dead
   * scheduler — the exact "a curl returning 200 proves nothing" failure the monitor exists to
   * catch.
   */
  if (dryRun) {
    const discovered = await discoverOrExplain({ limit, leagueId })
    if (!discovered.ok) {
      return NextResponse.json({ ok: false, error: discovered.safe }, { status: 500 })
    }
    return NextResponse.json({
      ok: true,
      dryRun: true,
      discovered: discovered.rows.length,
      processed: 0,
      failed: 0,
      results: discovered.rows.map((d) => ({
        leagueId: d.leagueId,
        pendingClaimCount: d.pendingClaimCount,
        scheduledFor: d.scheduledFor.toISOString(),
        waiverType: d.waiverType,
        metadata: d.metadata,
      })),
    })
  }

  /*
   * The wrap starts OUTSIDE discovery on purpose. `withSyncJobRun` writes its row before the
   * body runs, so the heartbeat survives every outcome below — no leagues due, discovery
   * blowing up, or the platform killing this function at maxDuration (which runs no user code
   * and so can never close the row; the started_at it left behind is still a valid heartbeat).
   */
  const outcome = await withSyncJobRun(
    { jobName: JOB, trigger: "cron" },
    () => sweepDueWaiverLeagues({ limit, leagueId }),
    (r) =>
      r.kind === "discovery_failed"
        ? { status: "failed", errors: [r.detail] }
        : {
            rowsRead: r.discovered,
            rowsWritten: r.processed,
            status: r.failed > 0 ? "partial" : "success",
            metadata: { discovered: r.discovered, processed: r.processed, failed: r.failed },
          },
  )

  if (outcome.kind === "discovery_failed") {
    return NextResponse.json({ ok: false, error: outcome.safe }, { status: 500 })
  }

  return NextResponse.json({
    ok: outcome.failed === 0,
    dryRun: false,
    discovered: outcome.discovered,
    processed: outcome.processed,
    failed: outcome.failed,
    results: outcome.results,
  })
}
