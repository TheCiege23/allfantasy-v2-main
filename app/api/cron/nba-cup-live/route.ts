/**
 * GET/POST /api/cron/nba-cup-live
 *
 * Minute-level NBA Cup live scores, run as a fast-tier operational overlay in
 * scripts/cron-fast-tier-loop.mjs. The 15-minute bracket-results cron publishes
 * schedules and finals; on its own it left a live score up to 15 minutes stale.
 *
 * ⚠ IT CALLS THE PROVIDER ONLY WHILE A CUP GAME IS ON. The window is read from
 * the stored snapshot (a database read), so on the ~300 days a year with no Cup
 * game this route never leaves Postgres. The provider call itself stays inside
 * `syncNbaCupTournament`, the ingestion module the DB-first rule sanctions.
 */
import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"
import { readNbaCupSnapshot } from "@/lib/playoffs/nbaCupCache"
import { nbaCupLiveWindowOpen } from "@/lib/playoffs/nbaCupTournament"
import { syncNbaCupTournament } from "@/lib/playoffs/syncNbaCupTournament"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

/** Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in scripts/cron-freshness-check.mjs. */
const JOB = "cron-nba-cup-live"

async function handle() {
  const startedAt = Date.now()
  const season = new Date().getUTCFullYear()
  try {
    const result = await withSyncJobRun(
      { jobName: JOB, trigger: "cron" },
      async () => {
        const snapshot = await readNbaCupSnapshot(season)
        if (!snapshot || !nbaCupLiveWindowOpen(snapshot.games)) {
          return { applied: false, skipped: "no_live_games", failures: [] as Array<{ date: string; error: string | null }> }
        }
        return syncNbaCupTournament({ season, apply: true, liveOnly: true })
      },
      (r) => ({
        rowsWritten: "gamesPublished" in r ? Number(r.gamesPublished ?? 0) : 0,
        status: r.failures.length > 0 ? ("partial" as const) : ("success" as const),
      }),
    )
    return NextResponse.json({ ok: result.failures.length === 0, season, ...result, durationMs: Date.now() - startedAt })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/nba-cup-live] failed:", message)
    return NextResponse.json({ ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle()
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle()
}
