/**
 * GET/POST /api/cron/import-players
 *
 * Vercel Cron schedule: every 6 hours (see vercel.json).
 * Calls runSportsDataImporter to build/refresh SportsPlayerRecord rows with
 * enriched stats, projections, ADP, injury status, and news for all supported sports.
 *
 * Optional query params:
 *   sport  — comma-separated sport codes to limit scope (e.g. "NFL,NBA")
 *   dryRun — "true" to skip DB writes (returns projected row count only)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runSportsDataImporter } from "@/lib/workers/sports-data-importer"
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
      { jobName: "cron-import-players", sport: sports?.join(",") ?? "ALL", provider: "multi", trigger: "cron" },
      () => runSportsDataImporter({ sports }),
      extractCommonCounts,
    )

    return NextResponse.json({
      ok: true,
      dryRun: false,
      imported: result.imported,
      sports: result.sports,
      staleFallbackApplied: result.staleFallbackApplied,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-players] failed:", message)
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
