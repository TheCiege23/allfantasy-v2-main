import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { syncSeasonBracketResults } from "@/lib/playoffs/syncSeasonBracketResults"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Railway may invoke this with POST and CRON_SECRET. Writes require both an
 * enabled environment flag and apply=true; all other authorized calls dry-run.
 */
export async function POST(request: NextRequest) {
  if (!requireCronAuth(request, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const sport = body.sport === "ncaaf" || body.sport === "nba_cup" ? body.sport : null
  const season = body.season == null ? new Date().getUTCFullYear() : Number(body.season)
  if (!sport || !Number.isInteger(season) || season < 2024 || season > 2100) {
    return NextResponse.json({ error: "Valid tournament and season required." }, { status: 400 })
  }
  const apply = process.env.BRACKET_AUTO_RESULT_SYNC_ENABLED === "true" && body.apply === true
  const result = await syncSeasonBracketResults({ sport, season, apply })
  return NextResponse.json({ ok: true, ...result })
}
