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
import { syncEspnStandingsToDb } from "@/lib/standings/espnStandings"
import { withSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 120

/**
 * Heartbeat identity in `sync_job_runs`. Must stay in step with PROBES in
 * scripts/cron-freshness-check.mjs — renaming it here without renaming it there makes the
 * freshness monitor report CONFIG ("no rows for job_name") forever.
 */
const JOB = "cron-import-standings"

function resolveSport(param: string | null): "NFL" | "NCAAF" {
  if (param?.toUpperCase() === "NCAAF") return "NCAAF"
  return "NFL"
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sport = resolveSport(url.searchParams.get("sport"))
  const season = url.searchParams.get("season") ?? undefined

  const startedAt = Date.now()

  const runSync = async () => {
    clearAPISportsDiagnostics()

    /*
     * ⚠ ESPN FIRST. API-Sports CANNOT ANSWER FOR THE CURRENT SEASON AND HAS NOT SINCE APRIL.
     *
     * This job ran every four hours and reported `ok: true` every time while writing nothing.
     * Measured 2026-08-30: every `*:standings:*` row in SportsDataCache was 2025-season, written
     * 2026-04-25, and all of them expired 2026-07-24. The account is on API-Sports' Free plan,
     * which answers every current-season request with "Free plans do not have access to this
     * season, try from 2022 to 2024" — a billing limit that `lib/scores/gameScoreProviders.ts`
     * and `/api/cron/import-injuries` had already hit and migrated away from. Standings was the
     * one feed that never did.
     *
     * ESPN needs no key, publishes both football codes, and was verified live returning season
     * 2026 with 32 NFL team entries. API-Sports is kept as a SECOND attempt rather than deleted:
     * it is the only source here for a historical `?season=` backfill, which is the one request
     * the Free plan can still serve.
     */
    const espn = await syncEspnStandingsToDb({ sport, season })

    let count = espn.written
    let provider = "espn"
    if (count === 0) {
      const apiSports = await syncAPISportsStandingsToDb({ season, sport })
      if (apiSports > 0) {
        count = apiSports
        provider = "api_sports"
      }
    }

    return { espn, count, provider, diagnostics: getAPISportsDiagnostics() }
  }

  try {
    /*
     * Heartbeat, and it records on every SCHEDULED fire including the failures — `withSyncJobRun`
     * writes its `running` row before the work and closes it after, so a run that ends in the
     * zero-rows failure below is still visible as a run that happened.
     *
     * ⚠ IT IS A HEARTBEAT AND NOT A TABLE PROBE FOR A REASON WORTH KEEPING. This job writes
     * `SportsDataCache` under `<SPORT>:standings:<season>:<abbrev>` keys — NOT a `standings`
     * table, which has never held a row and is what the old NO_PROBE note pointed at. But
     * SportsDataCache is written by many jobs, so a table probe on it would be satisfied by any
     * of them and report this one healthy while it wrote nothing. That is the same shared-probe
     * false green recorded against ?rosters=1 and the sync-player-images variants.
     */
    const { espn, count, provider, diagnostics } = await withSyncJobRun(
      { jobName: JOB, jobScope: sport, sport, trigger: "cron" },
      runSync,
      (r) => ({
        rowsRead: r.espn.fetched,
        rowsWritten: r.count,
        rowsSkipped: r.espn.skipped,
        // Zero rows is the documented failure below; the telemetry must agree with the response.
        status: r.count === 0 ? ("failed" as const) : ("success" as const),
      }),
    )

    /*
     * ZERO ROWS IS A FAILURE, and saying so is the point. The previous handler returned
     * `ok: true` unconditionally, which is exactly how four months of silence went unnoticed.
     * Non-2xx too: the cron dashboard keys off HTTP status, so a 200 carrying `ok:false` still
     * reads as healthy.
     */
    const failed = count === 0

    return NextResponse.json(
      {
        ok: !failed,
        sport,
        season: season ?? "current",
        synced: count,
        provider: failed ? null : provider,
        espn: { fetched: espn.fetched, written: espn.written, skipped: espn.skipped, errors: espn.errors.slice(0, 3) },
        diagnostics,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: failed ? 500 : 200 },
    )
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
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
