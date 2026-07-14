/**
 * GET/POST /api/cron/adp-refresh
 *
 * Vercel Cron schedule: daily at 10:00 UTC (see vercel.json).
 * Calls runAdpImporter to refresh AdpDataRecord rows from provider ADP feeds
 * (Fantrax, Sleeper, ESPN, MFL, NFFC, FFC, Rolling Insights, AI ADP snapshots)
 * and build consensus rows for all supported sports.
 *
 * Optional query params:
 *   sport  — comma-separated sport codes (e.g. "NFL") — defaults to all supported sports
 *   dryRun — "true" to skip DB writes
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runAdpImporter } from "@/lib/workers/adp-importer"
import { withSyncJobRun, extractCommonCounts } from "@/lib/production-health/syncJobRunTelemetry"

export const dynamic = "force-dynamic"
export const maxDuration = 300

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sportParam = url.searchParams.get("sport")
  const dryRun = url.searchParams.get("dryRun") === "true"

  const sports = sportParam
    ? sportParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined

  const startedAt = Date.now()

  try {
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        sports: sports ?? "all",
        message: "Dry run — no DB writes performed.",
        durationMs: Date.now() - startedAt,
      })
    }

    const result = await withSyncJobRun(
      { jobName: "cron-adp-refresh", sport: sports?.join(",") ?? "ALL", provider: "multi", trigger: "cron" },
      () => runAdpImporter({ sports }),
      extractCommonCounts,
    )

    return NextResponse.json({
      ok: true,
      dryRun: false,
      imported: result.imported,
      sports: result.sports,
      season: result.season,
      week: result.week,
      providerRowsRead: result.providerRowsRead,
      providerRowsWritten: result.providerRowsWritten,
      consensusRowsAttempted: result.consensusRowsAttempted,
      consensusRowsWritten: result.consensusRowsWritten,
      skippedRows: result.skippedRows,
      breakdown: {
        bySport: result.providerRowsWrittenBySport,
        consensus: result.consensusRowsBySport,
      },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/adp-refresh] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
