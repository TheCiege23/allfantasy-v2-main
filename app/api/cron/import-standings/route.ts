/**
 * GET/POST /api/cron/import-standings
 *
 * Vercel Cron schedule: every 4 hours (see vercel.json).
 * Syncs NFL/NCAAF standings from API-Sports into sportsDataCache.
 * Standings freshness drives the "currentFactsStatus" column in the admin
 * Sport Import Matrix and the Power Rankings / Matchup Prep AI tools.
 *
 * Optional query params:
 *   sport   — "NFL" (default) or "NCAAF"
 *   season  — 4-digit year string (defaults to current season)
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import {
  syncAPISportsStandingsToDb,
  clearAPISportsDiagnostics,
  getAPISportsDiagnostics,
} from "@/lib/api-sports"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

export const dynamic = "force-dynamic"
export const maxDuration = 120

function resolveSport(param: string | null): "NFL" | "NCAAF" {
  if (param?.toUpperCase() === "NCAAF") return "NCAAF"
  return "NFL"
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sport = resolveSport(url.searchParams.get("sport"))
  const season = url.searchParams.get("season") ?? undefined

  const startedAt = Date.now()

  try {
    clearAPISportsDiagnostics()
    const count = await withSyncJobRun(
      { jobName: "cron-import-standings", sport, provider: "api-sports", trigger: "cron" },
      () => syncAPISportsStandingsToDb({ season, sport }),
      (rows) => ({ rowsWritten: typeof rows === "number" ? rows : 0 }),
    )
    const diagnostics = getAPISportsDiagnostics()

    return NextResponse.json({
      ok: true,
      sport,
      season: season ?? "current",
      synced: count,
      diagnostics,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-standings] failed:", message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
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
