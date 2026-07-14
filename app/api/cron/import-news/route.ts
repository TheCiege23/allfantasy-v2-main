/**
 * GET/POST /api/cron/import-news
 *
 * Vercel Cron schedule: every 15 minutes (see vercel.json).
 * Calls runNewsImporter to refresh PlayerNewsRecord rows from provider news
 * feeds (Rolling Insights, ClearSports, ESPN, NewsAPI, API-Sports).
 * PlayerNewsRecord freshness directly feeds FantasyValueSnapshot news context
 * and injury-news aggregation for AI tools.
 *
 * Optional query params:
 *   sport — comma-separated sport codes (e.g. "NFL,NBA") — defaults to all sports
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runNewsImporter } from "@/lib/workers/news-importer"
import { withSyncJobRun, extractCommonCounts } from "@/lib/production-health/syncJobRunTelemetry"

export const dynamic = "force-dynamic"
export const maxDuration = 120

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sportParam = url.searchParams.get("sport")

  const sports = sportParam
    ? sportParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined

  const startedAt = Date.now()

  try {
    const result = await withSyncJobRun(
      { jobName: "cron-import-news", sport: sports?.join(",") ?? "ALL", provider: "news", trigger: "cron" },
      () => runNewsImporter({ sports }),
      extractCommonCounts,
    )

    return NextResponse.json({
      ok: true,
      imported: result.imported,
      sports: result.sports,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-news] failed:", message)
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
