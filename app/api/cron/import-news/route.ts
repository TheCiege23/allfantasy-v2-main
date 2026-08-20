/**
 * GET/POST /api/cron/import-news
 *
 * Vercel Cron schedule: every 15 minutes (see vercel.json).
 * Calls runNewsImporter to refresh PlayerNewsRecord rows from provider news
 * feeds (Rolling Insights, ClearSports, ESPN, NewsAPI, API-Sports).
 * PlayerNewsRecord freshness directly feeds FantasyValueSnapshot news context
 * and injury-news aggregation for AI tools.
 *
 * Optional query params:
 *   sport — comma-separated sport codes (e.g. "NFL,NBA") — defaults to all sports
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runNewsImporter } from "@/lib/workers/news-importer"

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

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sportParam = url.searchParams.get("sport")

  const sports = sportParam
    ? sportParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined

  // `full` runs the NewsAPI passes on top of ESPN. NewsAPI has a quota, so it must stay at
  // roughly hourly while ESPN stays at */15.
  //
  // This used to need TWO cron entries (a */15 ESPN-only one and a separate hourly `?full=1`).
  // Instead the single */15 cron now decides for itself: the first fire of each hour does the
  // full pass, the other three are ESPN-only. Same two behaviours, same cadences, one schedule.
  //
  // An explicit `?full=` still wins, so manual/admin invocation can force either mode.
  const fullParam = url.searchParams.get('full')
  const full =
    fullParam === null
      ? new Date().getUTCMinutes() < 15
      : ['1', 'true', 'yes'].includes(fullParam.toLowerCase())

  const startedAt = Date.now()

  try {
    // Ingest FIRST. runNewsImporter re-reads sports_news, so without a preceding
    // fetch it can only recycle whatever is already there — which is exactly how
    // this job reported ok:true for 107 days while advancing nothing.
    const { syncEspnNewsOnly, syncFullNewsCoverage } = await import('@/app/api/sports/news/sync-helper')
    let fetched: { total: number; breakdown: Record<string, number> } | null = null
    let fetchError: string | null = null
    try {
      fetched = full ? await syncFullNewsCoverage() : await syncEspnNewsOnly()
    } catch (err) {
      // A provider outage must not also block the normalize step from running
      // over rows already present, but it must be visible in the response.
      fetchError = err instanceof Error ? err.message : String(err)
      console.error('[cron/import-news] source sync failed:', fetchError)
    }

    const result = await runNewsImporter({ sports })

    // `imported` counts rows OFFERED to createMany, not rows inserted
    // (skipDuplicates), so it cannot stand in for freshness. `articlesFetched` is
    // the number that actually moves sports_news forward.
    const articlesFetched = fetched?.total ?? 0
    const ok = fetchError === null && articlesFetched > 0

    return NextResponse.json(
      {
        ok,
        mode: full ? 'full' : 'espn-only',
        articlesFetched,
        sourceBreakdown: fetched?.breakdown ?? null,
        sourceError: fetchError,
        normalizedOffered: result.imported,
        sports: result.sports,
        durationMs: Date.now() - startedAt,
        timestamp: new Date().toISOString(),
      },
      // Zero fetched articles means the feed is not advancing. Reporting 200 here
      // is what hid this for 107 days.
      { status: ok ? 200 : 500 }
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-news] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
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
