/**
 * GET/POST /api/cron/import-schedules
 *
 * Vercel Cron schedule: weekly on Monday at 03:00 UTC (see vercel.json).
 * Runs a full schedule sync for NFL (and optionally NCAAF) using Rolling
 * Insights (primary) then API-Sports (supplement).  Stores games into the
 * sportsGame table and gameSchedule table where applicable.
 *
 * Optional query params:
 *   sport   — "NFL" (default) or "NCAAF"
 *   season  — 4-digit year string (defaults to current season)
 *   source  — "rolling_insights" | "api_sports" | "all" (default: "all")
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { syncNFLScheduleToDb } from "@/lib/rolling-insights"
import {
  syncAPISportsGamesToDb,
  clearAPISportsDiagnostics,
  getAPISportsDiagnostics,
} from "@/lib/api-sports"

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

function resolveSport(param: string | null): "NFL" | "NCAAF" {
  if (param?.toUpperCase() === "NCAAF") return "NCAAF"
  return "NFL"
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sport = resolveSport(url.searchParams.get("sport"))
  const season = url.searchParams.get("season") ?? undefined
  const source = (url.searchParams.get("source") ?? "all").toLowerCase()

  const startedAt = Date.now()
  const results: Record<string, unknown> = {}
  const diagnostics: Record<string, unknown> = {}

  try {
    if ((source === "all" || source === "rolling_insights") && sport === "NFL") {
      try {
        const riCount = await syncNFLScheduleToDb({ season })
        results.rolling_insights = { synced: riCount, sport: "NFL" }
      } catch (err) {
        results.rolling_insights = { error: String(err).slice(0, 120), sport: "NFL" }
      }
    }

    if (source === "all" || source === "api_sports") {
      clearAPISportsDiagnostics()
      const asCount = await syncAPISportsGamesToDb({ season, sport })
      results.api_sports = { synced: asCount, sport }
      diagnostics.api_sports = getAPISportsDiagnostics()
    }

    const totalSynced = Object.values(results)
      .map((r) => (typeof (r as Record<string, unknown>).synced === "number" ? Number((r as Record<string, unknown>).synced) : 0))
      .reduce((a, b) => a + b, 0)

    return NextResponse.json({
      ok: true,
      sport,
      season: season ?? "current",
      source,
      totalSynced,
      results,
      diagnostics,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-schedules] failed:", message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
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
