/**
 * GET/POST /api/cron/import-stat-lines
 *
 * Phase 1 of the AF Projections Engine (AF_PROJECTIONS_ENGINE_BRIEF.md):
 * Rolling Insights `player-stats/{season}/{SPORT}` -> `FantasyStatLine`.
 * This is the projection BASE — `fantasy_stat_lines` had 0 rows ever because
 * no writer existed. Run daily (season aggregates move daily at most).
 *
 * Optional query params:
 *   sport   — one sport code; omitted runs every supported sport
 *   season  — 4-digit year; when set, the prior-season bootstrap fallback is
 *             DISABLED (you asked for that season, you get that season or a
 *             loud failure).
 *   skipIdentityBackfill — "1" to run the stat sync alone (see below)
 *
 * ⚠ THE IDENTITY BACKFILL RUNS FIRST, AND THAT ORDERING IS THE WHOLE POINT.
 * `syncRollingInsightsPlayerStatsToDb` refuses to write when `PlayerIdentityMap` holds no rows
 * for the sport — correctly, because provider-keyed stat rows that join to nothing are the exact
 * failure this pipeline exists to avoid. Measured on production 2026-08-27, that map held 1,933
 * rows and every one was NFL, so five sports could never get past this step no matter how much
 * provider data was ingested. The backfill is DB-only (Rolling Insights' own player ids are
 * already sitting in `SportsPlayer.externalId` for every sport), idempotent, and bounded, so
 * running it here makes the dependency explicit and self-healing instead of a manual prerequisite
 * somebody has to remember.
 *
 * FAILS LOUDLY: zero rows written returns ok:false + HTTP 500 (same policy as
 * import-projections / import-injuries after Phase 0 — a cron that reports
 * success while writing nothing is how the last outage lasted a month).
 * Also fails when the unresolved rate exceeds the threshold: rows that join to
 * nothing are the exact failure this pipeline exists to avoid, so writing 60%
 * of the feed and calling it success would be a lie.
 *
 * A sport with NO player-stats source at all (SOCCER — the vendor documents none, see
 * `support_consequences`) reports `providerCoverage: "none"` and does NOT fail. A permanently red
 * light is one an operator stops reading.
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { createRunBudget, rotateForFairness } from "@/lib/cron/runBudget"
import { syncRollingInsightsPlayerStatsToDb } from "@/lib/stats/rollingInsightsPlayerStats"
import { syncCfbdPlayerStatsToDb } from "@/lib/stats/cfbdPlayerStats"
import { backfillIdentityMapForSport } from "@/lib/sports-data/multiSportIdentityMap"
import { riSupports } from "@/lib/sports-data/rollingInsightsSupport"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"

export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Above this share of unresolved+ambiguous rows the run is declared FAILED
 * even if some rows were written — per the brief: "if it is high, stop and fix
 * matching before proceeding." 25% is a starting point, not a law; tighten it
 * once a real baseline is measured.
 */
const UNRESOLVED_RATE_FAILURE_THRESHOLD = 0.25

/**
 * Source rows the identity backfill scans per sport per run.
 *
 * NCAAF alone has 39,671 Rolling Insights rows in `SportsPlayer` and NCAAB 18,209, so an
 * unbounded first pass would spend the whole route budget on one sport. Bounded plus rotated, the
 * map converges over a few nightly runs and every sport advances.
 */
const IDENTITY_SCAN_PER_RUN = 20_000

const ALL_SPORTS = SUPPORTED_SPORTS.map((s) => String(s))

function resolveSports(param: string | null): string[] {
  const upper = param?.trim().toUpperCase() ?? ""
  if (upper && ALL_SPORTS.includes(upper)) return [upper]
  return rotateForFairness(ALL_SPORTS)
}

/** Which feed, if any, carries season stat lines for this sport. */
function statSourceFor(sport: string): "cfbd" | "rolling_insights" | "none" {
  // Rolling Insights carries no college football data at all — measured `fetched: 0` — so routing
  // NCAAF there produced an empty table and a cascade failure in compute-projections.
  if (sport === "NCAAF") return "cfbd"
  return riSupports("player_stats", sport) ? "rolling_insights" : "none"
}

interface SportOutcome {
  body: Record<string, unknown>
  failed: boolean
}

async function runOneSport(
  sport: string,
  season: number | undefined,
  skipIdentityBackfill: boolean,
): Promise<SportOutcome> {
  const startedAt = Date.now()
  const source = statSourceFor(sport)

  if (source === "none") {
    return {
      body: {
        ok: true,
        sport,
        providerCoverage: "none",
        note: "no player season-stats feed exists for this sport at any configured provider",
        written: 0,
        durationMs: Date.now() - startedAt,
      },
      failed: false,
    }
  }

  try {
    if (source === "cfbd") {
      const cfbd = await syncCfbdPlayerStatsToDb({ season })
      const ok = cfbd.written > 0
      return {
        body: {
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
        },
        failed: !ok,
      }
    }

    // Populate the join key before asking for rows that need it.
    const identity = skipIdentityBackfill
      ? null
      : await backfillIdentityMapForSport(sport, { limit: IDENTITY_SCAN_PER_RUN })

    const result = await syncRollingInsightsPlayerStatsToDb({ sport, season })

    /*
     * `notModified` means a 304 survived the cache-busted retry: unchanged-or-not-yet-started, and
     * the prior-season bootstrap already had its turn. Writing nothing in that case is the correct
     * behaviour, not an outage, so it is excluded from the zero-rows failure.
     */
    const zeroRows = result.written === 0 && !result.notModified
    const badResolutionRate = result.unresolvedRate > UNRESOLVED_RATE_FAILURE_THRESHOLD
    const failed = zeroRows || badResolutionRate

    return {
      body: {
        ok: !failed,
        sport,
        source: "rolling_insights",
        seasonRequested: result.seasonRequested,
        seasonUsed: result.seasonUsed,
        /** True when the requested season had no data (pre-kickoff) and the
         *  prior season was ingested as the bootstrap base. Explicit, so the
         *  in-season transition is observable rather than inferred. */
        seasonFellBack: result.seasonFellBack,
        notModified: result.notModified || undefined,
        /** What the join key looked like going in — a stat sync that writes nothing because the
         *  map is still filling reads very differently from one whose provider went dark. */
        identityBackfill: identity
          ? {
              scanned: identity.scanned,
              created: identity.created,
              linked: identity.linked,
              alreadyMapped: identity.alreadyMapped,
              ambiguous: identity.ambiguous,
              errors: identity.errors.length ? identity.errors.slice(0, 3) : undefined,
            }
          : undefined,
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
      },
      failed,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron/import-stat-lines] ${sport} failed:`, message)
    return {
      body: { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      failed: true,
    }
  }
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const explicit = url.searchParams.get("sport")
  const seasonParam = url.searchParams.get("season")
  const season = seasonParam && /^\d{4}$/.test(seasonParam) ? Number(seasonParam) : undefined
  const skipIdentityBackfill = url.searchParams.get("skipIdentityBackfill") === "1"

  const budget = createRunBudget()
  const results: SportOutcome[] = []
  const deferred: string[] = []

  for (const sport of resolveSports(explicit)) {
    if (!explicit && budget.exhausted()) {
      deferred.push(sport)
      continue
    }
    results.push(await runOneSport(sport, season, skipIdentityBackfill))
  }

  // Explicit single-sport callers keep the exact response shape they had before.
  if (explicit) {
    const only = results[0]!
    return NextResponse.json({ ...only.body, timestamp: new Date().toISOString() }, {
      status: only.failed ? 500 : 200,
    })
  }

  const anyFailed = results.some((r) => r.failed)
  return NextResponse.json(
    {
      ok: !anyFailed,
      sports: results.map((r) => r.body),
      deferredForBudget: deferred.length ? deferred : undefined,
      timestamp: new Date().toISOString(),
    },
    { status: anyFailed ? 500 : 200 },
  )
}

export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
