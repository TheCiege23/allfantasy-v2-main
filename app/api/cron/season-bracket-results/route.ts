import { NextRequest, NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { syncSeasonBracketResults } from "@/lib/playoffs/syncSeasonBracketResults"
import { syncNbaCupTournament } from "@/lib/playoffs/syncNbaCupTournament"
import { syncNflPlayoffs } from "@/lib/playoffs/syncNflPlayoffs"
import { sweepBracketExperience } from "@/lib/playoffs/bracketExperienceService"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Railway invokes this with POST and CRON_SECRET. NBA Cup automatically publishes
 * schedules and results when apply=true. CFP retains its existing opt-in guard.
 */
export async function POST(request: NextRequest) {
  if (!requireCronAuth(request, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const sport = body.sport === "ncaaf" || body.sport === "nba_cup" || body.sport === "nfl" ? body.sport : null
  const season = body.season == null ? new Date().getUTCFullYear() : Number(body.season)
  if (!sport || !Number.isInteger(season) || season < 2024 || season > 2100) {
    return NextResponse.json({ error: "Valid tournament and season required." }, { status: 400 })
  }
  if (sport === "nfl") {
    // Outside January-February this returns before any provider call (nflPostseasonWindowOpen).
    const result = await syncNflPlayoffs({ season, apply: body.apply === true })
    return NextResponse.json({ ok: result.failures.length === 0, ...result }, { status: result.failures.length ? 502 : 200 })
  }
  if (sport === "nba_cup") {
    const result = await syncNbaCupTournament({ season, apply: body.apply === true })
    const experience = body.apply === true ? await sweepBracketExperience(sport, season).catch(() => ({ failures: 1, processed: 0, alerts: 0 })) : null
    return NextResponse.json({ ok: result.failures.length === 0 && !experience?.failures, ...result, experience }, { status: result.failures.length || experience?.failures ? 502 : 200 })
  }
  const apply = process.env.BRACKET_AUTO_RESULT_SYNC_ENABLED === "true" && body.apply === true
  const result = await syncSeasonBracketResults({ sport, season, apply })
  const experience = apply ? await sweepBracketExperience(sport, season).catch(() => ({ failures: 1, processed: 0, alerts: 0 })) : null
  return NextResponse.json({ ok: !experience?.failures, ...result, experience }, { status: experience?.failures ? 502 : 200 })
}
