/**
 * GET/POST /api/cron/import-depth-charts
 *
 * Vercel Cron schedule: weekly on Wednesday at 04:00 UTC (see vercel.json).
 * Syncs NFL depth charts from Rolling Insights into the depthChart table.
 * Depth chart data provides role context (starter/backup) that improves
 * fantasy value scoring and draft advisor recommendations.
 *
 * Optional query params:
 *   season — 4-digit year string (defaults to current season)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { syncNFLDepthChartsToDb } from "@/lib/rolling-insights"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 300

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const season = url.searchParams.get("season") ?? undefined

  const startedAt = Date.now()

  try {
    const count = await syncNFLDepthChartsToDb({ season })

    return NextResponse.json({
      ok: true,
      sport: "NFL",
      season: season ?? "current",
      synced: count,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-depth-charts] failed:", message)
    return NextResponse.json(
      { ok: false, sport: "NFL", error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
