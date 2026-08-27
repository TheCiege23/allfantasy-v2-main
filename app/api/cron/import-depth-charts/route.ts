/**
 * GET/POST /api/cron/import-depth-charts
 *
 * Vercel Cron schedule: weekly on Wednesday at 04:00 UTC (see vercel.json).
 * Syncs depth charts from Rolling Insights into the depthChart table for every sport the vendor
 * serves them for. Depth chart data provides role context (starter/backup) that improves fantasy
 * value scoring, the AF projection engine's depth-role input, and draft advisor recommendations.
 *
 * Optional query params:
 *   sport  — one sport code; omitted runs every supported sport
 *   season — 4-digit year string (defaults to current season)
 *
 * ⚠ TWO WRITERS, ON PURPOSE. NFL keeps its GraphQL path (`syncNFLDepthChartsToDb`), which returns
 * a richer per-position roster than REST does and has been in production since before this route
 * grew. MLB, NBA and NHL use the documented REST endpoint `/depth-charts/{SPORT}`, because there
 * is no documented GraphQL equivalent for them and inventing one would mean guessing a schema.
 * The two write different `source` values into a table keyed on (sport, team, position, source),
 * so for NFL they coexist rather than overwrite.
 *
 * NCAAF, NCAAB and SOCCER have NO depth-chart feed from this vendor (`support_matrix`). They are
 * reported as `providerCoverage: "none"` and do NOT fail the run — a red light that can never go
 * green is a red light an operator learns to ignore.
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { createRunBudget, rotateForFairness } from "@/lib/cron/runBudget"
import { syncNFLDepthChartsToDb } from "@/lib/rolling-insights"
import { syncRollingInsightsDepthChartsToDb } from "@/lib/sports-data/rollingInsightsDepthCharts"
import { riSupports } from "@/lib/sports-data/rollingInsightsRest"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"

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

const ALL_SPORTS = SUPPORTED_SPORTS.map((s) => String(s))

function resolveSports(param: string | null): string[] {
  const upper = param?.trim().toUpperCase() ?? ""
  if (upper && ALL_SPORTS.includes(upper)) return [upper]
  // Rotated so a budget cut never starves the same tail every week.
  return rotateForFairness(ALL_SPORTS)
}

interface SportOutcome {
  body: Record<string, unknown>
  failed: boolean
}

async function runOneSport(sport: string, season: string | undefined): Promise<SportOutcome> {
  const startedAt = Date.now()

  if (!riSupports("depth_charts", sport)) {
    return {
      body: {
        ok: true,
        sport,
        providerCoverage: "none",
        note: "Rolling Insights documents no depth-charts feed for this sport",
        synced: 0,
        durationMs: Date.now() - startedAt,
      },
      failed: false,
    }
  }

  try {
    if (sport === "NFL") {
      const count = await syncNFLDepthChartsToDb({ season })
      return {
        body: {
          ok: count > 0,
          sport,
          source: "rolling_insights_graphql",
          season: season ?? "current",
          synced: count,
          durationMs: Date.now() - startedAt,
        },
        failed: count === 0,
      }
    }

    const r = await syncRollingInsightsDepthChartsToDb({ sport, season })
    /*
     * A 304 that survived the cache-busted retry means UNCHANGED-or-empty and the contract does
     * not say which, so prior rows stand and this is not a failure. Zero rows with a 200 IS one.
     */
    const failed = !r.notModified && r.written === 0
    return {
      body: {
        ok: !failed,
        sport,
        source: "rolling_insights_rest",
        season: season ?? "current",
        teams: r.teams,
        synced: r.written,
        players: r.players,
        notModified: r.notModified || undefined,
        /** Non-zero means the payload has a shape this parser does not model — see GAPS.md G-07,
         *  which still lists the depth-chart field list as UNVERIFIED for every sport. */
        unrecognisedKeys: r.unrecognisedKeys.length ? r.unrecognisedKeys : undefined,
        errors: r.errors.length ? r.errors.slice(0, 5) : undefined,
        durationMs: Date.now() - startedAt,
      },
      failed,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[cron/import-depth-charts] ${sport} failed:`, message)
    return {
      body: { ok: false, sport, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      failed: true,
    }
  }
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const explicit = url.searchParams.get("sport")
  const season = url.searchParams.get("season") ?? undefined

  const budget = createRunBudget()
  const results: SportOutcome[] = []
  const deferred: string[] = []

  for (const sport of resolveSports(explicit)) {
    if (!explicit && budget.exhausted()) {
      deferred.push(sport)
      continue
    }
    results.push(await runOneSport(sport, season))
  }

  // Explicit single-sport callers keep the exact response they had before.
  if (explicit) {
    const only = results[0]!
    return NextResponse.json(only.body, { status: only.failed ? 500 : 200 })
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
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, 'CRON_SECRET')) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  return handle(req)
}
