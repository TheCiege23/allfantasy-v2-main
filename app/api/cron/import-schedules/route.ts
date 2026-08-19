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
import {
  ingestSchedule,
  ingestTeams,
  type IngestSport,
} from "@/lib/sports-data/theSportsDbIngest"

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

/** Every league the TheSportsDB ingest covers. */
const TSDB_SPORTS: IngestSport[] = ['NFL', 'NCAAF', 'MLB', 'NBA', 'NHL', 'NCAAB', 'SOCCER']

/**
 * Leagues whose teams come back from ONE `search_all_teams` call.
 *
 * NCAAF is deliberately absent: it cannot be listed by name at all, so its 231
 * teams need 231 individual lookups — about four minutes, which alone would eat
 * this route's 300s budget.
 */
const TSDB_FAST_TEAM_SPORTS: IngestSport[] = ['NFL', 'MLB', 'NBA', 'NHL', 'NCAAB', 'SOCCER']

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

    /*
     * TheSportsDB slice.
     *
     * Folded into this existing cron rather than given its own route — the repo
     * sits at Vercel's hard 2048-route ceiling, and a schedule sync already has a
     * home here.
     *
     * ⚠ BOUNDED ON PURPOSE. maxDuration is 300s and a full sweep takes about ten
     * minutes, most of it NCAAF, whose 231 teams have to be looked up one at a
     * time because the provider cannot list them by name. So this runs SCHEDULES
     * only — seven calls, roughly thirty seconds — and teams only for the leagues
     * that list in one request. NCAAF teams stay with the manual script until
     * they have a job that can take the time.
     *
     * `?tsdb=0` opts out; anything else runs it.
     *
     * CADENCE. The weekly Monday entries above run the Rolling Insights and
     * API-Sports sync and pick this up alongside them. A separate vercel.json
     * entry runs `?source=tsdb-only` every six hours: "tsdb-only" matches neither
     * "all" nor "rolling_insights" nor "api_sports", so both of those blocks skip
     * and only this one executes. Six hours is what freshnessPolicy sets for
     * current_schedule — kickoff times flex and lineup locks are computed from
     * them, so weekly would be far too stale.
     */
    if (url.searchParams.get('tsdb') !== '0') {
      const tsdb: Record<string, unknown> = {}
      for (const s of TSDB_SPORTS) {
        try {
          const sched = await ingestSchedule(s)
          const entry: Record<string, unknown> = { season: sched.season, games: sched.written }
          // Only the leagues whose teams come back in a single call. NCAAF is
          // excluded by TSDB_FAST_TEAM_SPORTS, not by accident.
          if (TSDB_FAST_TEAM_SPORTS.includes(s)) {
            const teams = await ingestTeams(s, { season: sched.season })
            entry.teams = teams.written
          }
          tsdb[s] = entry
        } catch (err) {
          tsdb[s] = { error: String(err).slice(0, 120) }
        }
      }
      results.thesportsdb = tsdb
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
