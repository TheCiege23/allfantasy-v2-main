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
 * ⚠ THIS NOTE DESCRIBED A BUG THAT IS FIXED, AND SAID THE OPPOSITE OF THE CODE. It read
 * "`requireCronAuth` resolves `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`", so a
 * bare call 401s. That WAS true and did break production on 2026-07-20 (404 -> 401), but
 * #289/#304 inverted it: `app/api/cron/_auth.ts:22-24` now resolves
 * `preferredSecretEnv ?? CRON_SECRET ?? LEAGUE_CRON_SECRET`, and its own comment says
 * LEAGUE_CRON_SECRET "must never win by default".
 *
 * Kept as a correction rather than deleted, because the stale version was load-bearing: it is
 * cited when choosing where to fold new work, and it makes an already-safe route look risky.
 * Naming 'CRON_SECRET' explicitly below is still right — it is the one contract every
 * deployment is guaranteed to have — but it is now belt-and-braces, not the thing standing
 * between this cron and a 401.
 */
import { ingestPlayerValues } from "@/lib/player-values/ingestPlayerValues"
import { runAiAdpJob } from "@/lib/ai-adp-engine"

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
        message:
          "Dry run — no DB writes performed (ADP import, player-value capture and AI ADP job all skipped).",
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

    /*
     * AI ADP RIDES ALONG TOO, AND THIS IS LIKEWISE THE ONLY THING THAT SCHEDULES IT.
     *
     * `runAiAdpJob` documents itself as "Call from cron daily" and had NO caller anywhere in
     * the repo, so `ai_adp_snapshots` held ZERO rows while eight surfaces read it — the same
     * shape as the player-value gap above, and as ingestCFBDStats before it. The input is
     * real: 32 completed sessions, 2,847 picks inside the job's 120-day lookback.
     *
     * ⚠ IT RUNS LAST, NOT FIRST, and the tempting argument for first is wrong. `runAdpImporter`
     * does read `aiAdpSnapshot` — but only in the non-NFL branch, and every consumer is gated
     * off by `isAiAdpConsumerEnabled()`, so there is no same-run consumer to feed. Meanwhile
     * this job holds the whole pick set in memory, and a V8 heap OOM is process death, not a
     * throw: `catch` would never run, and an untested job placed ahead of these two would take
     * out an ADP import and a player-value capture that both work today. Earn the earlier slot
     * with one clean run and a measured RSS, not with an ordering argument.
     *
     * FAILURE IS ISOLATED, same rule as above — ADP and player values are already written.
     */
    let aiAdp: Awaited<ReturnType<typeof runAiAdpJob>> | { error: string } | null = null
    try {
      aiAdp = await runAiAdpJob({ runReason: 'cron/adp-refresh' })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error("[cron/adp-refresh] ai adp job failed:", message)
      aiAdp = { error: message.slice(0, 200) }
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      playerValues,
      aiAdp,
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
