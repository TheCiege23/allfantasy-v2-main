/**
 * GET/POST /api/cron/import-stat-lines
 *
 * Phase 1 of the AF Projections Engine (AF_PROJECTIONS_ENGINE_BRIEF.md):
 * Rolling Insights `player-stats/{season}/{SPORT}` -> `FantasyStatLine`.
 * This is the projection BASE — `fantasy_stat_lines` had 0 rows ever because
 * no writer existed. Run daily (season aggregates move daily at most).
 *
 * Optional query params:
 *   sport   — "NFL" (default)
 *   season  — 4-digit year; when set, the prior-season bootstrap fallback is
 *             DISABLED (you asked for that season, you get that season or a
 *             loud failure).
 *
 * FAILS LOUDLY: zero rows written returns ok:false + HTTP 500 (same policy as
 * import-projections / import-injuries after Phase 0 — a cron that reports
 * success while writing nothing is how the last outage lasted a month).
 * Also fails when the unresolved rate exceeds the threshold: rows that join to
 * nothing are the exact failure this pipeline exists to avoid, so writing 60%
 * of the feed and calling it success would be a lie.
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { syncRollingInsightsPlayerStatsToDb } from "@/lib/stats/rollingInsightsPlayerStats"
import { syncCfbdPlayerStatsToDb } from "@/lib/stats/cfbdPlayerStats"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Above this share of unresolved+ambiguous rows the run is declared FAILED
 * even if some rows were written — per the brief: "if it is high, stop and fix
 * matching before proceeding." 25% is a starting point, not a law; tighten it
 * once a real baseline is measured.
 */
const UNRESOLVED_RATE_FAILURE_THRESHOLD = 0.25

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sport = (url.searchParams.get("sport") ?? "NFL").toUpperCase()
  const seasonParam = url.searchParams.get("season")
  const season = seasonParam && /^\d{4}$/.test(seasonParam) ? Number(seasonParam) : undefined

  const startedAt = Date.now()
  try {
    // NCAAF goes to CollegeFootballData. Rolling Insights carries no college
    // data at all — measured `fetched: 0` — so routing NCAAF there produced an
    // empty table and a cascade failure in compute-projections.
    if (sport === "NCAAF") {
      const cfbd = await syncCfbdPlayerStatsToDb({ season })
      const ok = cfbd.written > 0
      return NextResponse.json(
        {
          ok,
          sport,
          source: "cfbd",
          season: cfbd.season,
          fetched: cfbd.fetched,
          players: cfbd.players,
          written: cfbd.written,
          skippedNonFantasy: cfbd.skippedNonFantasy,
          errors: cfbd.errors,
          durationMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
        },
        { status: ok ? 200 : 500 },
      )
    }

    const result = await syncRollingInsightsPlayerStatsToDb({ sport, season })

    const zeroRows = result.written === 0
    const badResolutionRate = result.unresolvedRate > UNRESOLVED_RATE_FAILURE_THRESHOLD
    const failed = zeroRows || badResolutionRate

    return NextResponse.json(
      {
        ok: !failed,
        sport,
        source: "rolling_insights",
        seasonRequested: result.seasonRequested,
        seasonUsed: result.seasonUsed,
        /** True when the requested season had no data (pre-kickoff) and the
         *  prior season was ingested as the bootstrap base. Explicit, so the
         *  in-season transition is observable rather than inferred. */
        seasonFellBack: result.seasonFellBack,
        fetched: result.fetched,
        written: result.written,
        resolvedDirect: result.resolvedDirect,
        resolvedByName: result.resolvedByName,
        identityIdsBackfilled: result.backfilledIds,
        unresolved: result.unresolved,
        ambiguousRefused: result.ambiguous,
        unresolvedRate: Number(result.unresolvedRate.toFixed(4)),
        unresolvedRateThreshold: UNRESOLVED_RATE_FAILURE_THRESHOLD,
        failureReason: zeroRows
          ? "zero_rows_written"
          : badResolutionRate
            ? "unresolved_rate_above_threshold"
            : undefined,
        sampleUnresolved: result.sampleUnresolved.length ? result.sampleUnresolved : undefined,
        errors: result.errors.length ? result.errors.slice(0, 10) : undefined,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      { status: failed ? 500 : 200 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-stat-lines] failed:", message)
    return NextResponse.json(
      { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
