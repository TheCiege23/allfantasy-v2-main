/**
 * GET/POST /api/cron/adp-refresh
 *
 * Vercel Cron schedule: daily at 10:00 UTC (see vercel.json).
 * Calls runAdpImporter to refresh AdpDataRecord rows from provider ADP feeds
 * (Fantrax, Sleeper, ESPN, MFL, NFFC, FFC, Rolling Insights, AI ADP snapshots)
 * and build consensus rows for all supported sports.
 *
 * Optional query params:
 *   sport  — comma-separated sport codes (e.g. "NFL") — defaults to all supported sports
 *   dryRun — "true" to skip DB writes
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { runAdpImporter } from "@/lib/workers/adp-importer"

/**
 * NOTE: `requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`.
 * Vercel Cron presents `Authorization: Bearer $CRON_SECRET`, so a BARE call checks
 * LEAGUE_CRON_SECRET first and 401s whenever that variable is set to anything else — which is
 * what happened in production the moment #284 made these routes reachable again (404 -> 401,
 * measured 2026-07-20 00:01 UTC). Naming CRON_SECRET explicitly is what `keeper/session` and
 * `weather/refresh-cron` already do, and those are the crons that were returning 200.
 */
import { ingestPlayerValues } from "@/lib/player-values/ingestPlayerValues"

export const dynamic = "force-dynamic"
export const maxDuration = 300

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const sportParam = url.searchParams.get("sport")
  const dryRun = url.searchParams.get("dryRun") === "true"

  const sports = sportParam
    ? sportParam
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined

  const startedAt = Date.now()

  try {
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        sports: sports ?? "all",
        message: "Dry run — no DB writes performed (ADP import and player-value capture both skipped).",
        durationMs: Date.now() - startedAt,
      })
    }

    const result = await runAdpImporter({ sports })

    /*
     * PLAYER VALUES RIDE ALONG HERE, AND THIS IS THE ONLY THING THAT SCHEDULES THEM.
     *
     * `scripts/ingest-player-values.ts` had no scheduler: it ran once by hand and left
     * 1,140 rows all stamped 2026-08-16. A dated value series is what lets a trade be
     * priced at the time it happened, so a series with one day in it means every
     * historical trade is unpriceable — which is exactly the state the trade features
     * are in today.
     *
     * ADP refresh is the right host: same domain (what the market thinks a player is
     * worth), already daily, already `maxDuration = 300`, and it names CRON_SECRET
     * explicitly rather than tripping the LEAGUE_CRON_SECRET shadowing that has broken
     * crons in this repo before. Folding in also costs no route, which matters at the
     * 2,048 ceiling.
     *
     * FAILURE IS ISOLATED. A FantasyCalc outage must not turn an ADP run red — ADP has
     * already been written by the time we get here. The outcome is reported in the
     * response instead of thrown, so a partial capture is visible rather than silent.
     */
    let playerValues: Awaited<ReturnType<typeof ingestPlayerValues>> | { error: string } | null = null
    try {
      playerValues = await ingestPlayerValues()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error("[cron/adp-refresh] player value capture failed:", message)
      playerValues = { error: message.slice(0, 200) }
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      playerValues,
      imported: result.imported,
      sports: result.sports,
      season: result.season,
      week: result.week,
      providerRowsRead: result.providerRowsRead,
      providerRowsWritten: result.providerRowsWritten,
      consensusRowsAttempted: result.consensusRowsAttempted,
      consensusRowsWritten: result.consensusRowsWritten,
      skippedRows: result.skippedRows,
      breakdown: {
        bySport: result.providerRowsWrittenBySport,
        consensus: result.consensusRowsBySport,
      },
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/adp-refresh] failed:", message)
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
