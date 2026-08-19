import { NextResponse } from "next/server"

import {
  captureLeagueSnapshotJob,
  captureLeagueSnapshotsBatchJob,
} from "@/lib/decision-os/snapshot/captureLeagueSnapshotJob"
import { createDefaultBehavioralSnapshotStore } from "@/lib/decision-os/snapshot/prismaBehavioralSnapshotStore"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"
import { prisma } from "@/lib/prisma"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * GET /api/cron/decision-os-snapshot-capture
 * Auth: `Authorization: Bearer ${CRON_SECRET}` (identical pattern to `app/api/cron/waivers/route.ts`).
 * Non-production: `?secret=${CRON_SECRET}` allowed for local smoke tests.
 *
 * Commissioner OS Surface Alignment — Phase B Increment 4. Captures the already-built Decision OS
 * behavioral snapshot (Phase A Increment 5's writer) for one or more EXPLICITLY named leagues.
 * Pass `?leagueId=<id>` for a single league (on-demand verification) or
 * `?leagueIds=<id1>,<id2>,...` for an explicit batch.
 *
 * Aug 2026 — SCHEDULED discovery mode (`?discover=1`): the deliberate deployment decision the
 * Phase B comment deferred (docs/os/COMMISSIONER_OS_SURFACE_ALIGNMENT.md §4d) has now been made.
 * The daily cron walks non-archived canonical leagues (freshest-updated first, hard cap 200) under
 * a 240s time budget — leagues skipped for time are reported honestly (`skippedForTime`), never
 * silently dropped, and the daily-cadence snapshot writer dedupes per UTC day so tomorrow's fire
 * resumes them. Explicit-id calls behave exactly as before. Telemetry: SyncJobRun
 * `cron-decision-os-snapshot-capture` via withSyncJobRun (production-health cron panel).
 */
const DISCOVERY_TIME_BUDGET_MS = 240_000
const DISCOVERY_LEAGUE_CAP = 200
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

function parseLeagueIds(url: URL): string[] {
  const leagueIds = url.searchParams.get("leagueIds")
  if (leagueIds) {
    return leagueIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  }
  const leagueId = url.searchParams.get("leagueId")
  return leagueId ? [leagueId.trim()].filter(Boolean) : []
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  let leagueIds = parseLeagueIds(url)

  // Scheduled discovery mode — walk non-archived canonical leagues under a time
  // budget, wrapped in SyncJobRun telemetry so staleness is observable.
  if (leagueIds.length === 0 && url.searchParams.get("discover") === "1") {
    const summary = await withSyncJobRun(
      { jobName: "cron-decision-os-snapshot-capture", trigger: "cron" },
      async () => {
        const startedAt = Date.now()
        const leagues = await prisma.league
          .findMany({
            where: { status: { notIn: ["complete", "completed", "archived"] } },
            select: { id: true },
            orderBy: { updatedAt: "desc" },
            take: DISCOVERY_LEAGUE_CAP,
          })
          .catch(() => [] as { id: string }[])

        const store = createDefaultBehavioralSnapshotStore()
        if (!store) {
          return { storeUnavailable: true, discovered: 0, processed: 0, failed: 0, skippedForTime: 0, errors: [] as string[] }
        }

        let processed = 0
        let failed = 0
        let skippedForTime = 0
        const errors: string[] = []
        for (const league of leagues) {
          if (Date.now() - startedAt > DISCOVERY_TIME_BUDGET_MS) {
            skippedForTime += 1
            continue
          }
          const result = await captureLeagueSnapshotJob(league.id, { store })
          if (result.ok) processed += 1
          else {
            failed += 1
            if (errors.length < 5) errors.push(`${league.id}: ${result.error}`)
          }
        }
        return { storeUnavailable: false, discovered: leagues.length, processed, failed, skippedForTime, errors }
      },
      (s) => ({
        rowsRead: s.discovered,
        rowsWritten: s.processed,
        rowsSkipped: s.skippedForTime,
        errors: s.storeUnavailable ? ["snapshot_store_unavailable"] : s.errors,
        warnings: s.skippedForTime > 0 ? [`${s.skippedForTime} leagues deferred by the ${DISCOVERY_TIME_BUDGET_MS / 1000}s time budget`] : [],
      }),
    )

    if (summary.storeUnavailable) {
      return NextResponse.json({ ok: false, mode: "discover", error: "snapshot_store_unavailable" }, { status: 503 })
    }
    return NextResponse.json({
      ok: summary.failed === 0,
      mode: "discover" as const,
      discovered: summary.discovered,
      processed: summary.processed,
      failed: summary.failed,
      skippedForTime: summary.skippedForTime,
      errors: summary.errors,
    })
  }

  if (leagueIds.length === 0) {
    return NextResponse.json({ ok: false, error: "no_leagues_specified" }, { status: 400 })
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      discovered: leagueIds.length,
      processed: 0,
      failed: 0,
      results: leagueIds.map((leagueId) => ({ leagueId })),
    })
  }

  const store = createDefaultBehavioralSnapshotStore()
  if (!store) {
    return NextResponse.json({ ok: false, error: "snapshot_store_unavailable" }, { status: 503 })
  }

  if (leagueIds.length === 1) {
    const result = await captureLeagueSnapshotJob(leagueIds[0], { store })
    return NextResponse.json({
      ok: result.ok,
      dryRun: false,
      discovered: 1,
      processed: result.ok ? 1 : 0,
      failed: result.ok ? 0 : 1,
      results: [result],
    })
  }

  const { ok, results } = await captureLeagueSnapshotsBatchJob(leagueIds, { store })
  const failedCount = results.filter((r) => !r.ok).length
  return NextResponse.json({
    ok,
    dryRun: false,
    discovered: leagueIds.length,
    processed: leagueIds.length - failedCount,
    failed: failedCount,
    results,
  })
}
