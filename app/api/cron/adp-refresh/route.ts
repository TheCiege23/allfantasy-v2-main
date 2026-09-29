/**
 * GET/POST /api/cron/adp-refresh
 *
 * Vercel Cron schedule: daily at 10:00 UTC (see vercel.json).
 * Calls runAdpImporter to refresh AdpDataRecord rows from provider ADP feeds
 * (Fantrax, Sleeper, ESPN, MFL, NFFC, FFC, Rolling Insights, AI ADP snapshots)
 * and build consensus rows for all supported sports. Then, each failure-isolated:
 * FantasyCalc value capture, the defender board, the AI ADP job, and the Market
 * Movers player-valuation sync (`player-valuations:{sport}`).
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
import { prisma } from "@/lib/prisma"
import { refreshCanonicalDefenderBoardCache } from "@/lib/values/canonicalDefenderBoardCache"
import { PLAYER_VALUATION_SPORTS, syncPlayerValuations } from "@/lib/player-valuation-sync"
import type { ApiChainSport } from "@/lib/workers/api-config"
import { redactAndCap } from "@/lib/security/redactSecrets"
import { recordSyncJobRun } from "@/lib/production-health/syncJobRunTelemetry"

/*
 * 🛑 THIS JOB SUCCEEDS WITHOUT WRITING A ROW ON MOST DAYS, SO ITS OUTPUT TABLE CANNOT BE ITS PULSE.
 *
 * `adp_data` is unique on (sport, format, scoring, playerId, week, season, source), and `week` is
 * the calendar week of the year. The first run of a week inserts; every later run that week reads
 * the same feeds and `skipDuplicates` drops all of it. Measured 2026-09-29, the dispatcher's own
 * log: `providerRowsRead: 3550, providerRowsWritten: 0, week: 40`, HTTP 200. The freshness probe
 * read `adp_data.created_at`, so from the second day after each week rolled it reported a healthy
 * job STALE, every hour, until the next Sunday.
 *
 * So the probe reads this heartbeat instead. It is recorded as FAILED when the import read nothing
 * — a feed outage must still alarm, and a heartbeat that goes green on an empty read is the false
 * clean the freshness monitor exists to remove. Only the scheduled full run records it: a hand run
 * scoped with `?sport=` is not evidence that every feed still answers.
 */
const ADP_REFRESH_JOB = "cron-adp-refresh"

async function recordAdpHeartbeat(
  sports: string[] | undefined,
  result: Awaited<ReturnType<typeof runAdpImporter>>,
  durationMs: number,
): Promise<boolean> {
  if (sports) return false
  await recordSyncJobRun(
    { jobName: ADP_REFRESH_JOB, trigger: "cron" },
    {
      rowsRead: result.providerRowsRead,
      rowsWritten: result.imported,
      rowsSkipped: Math.max(0, result.providerRowsRead - result.providerRowsWritten),
      errors: result.providerRowsRead > 0 ? [] : ["ADP import read 0 provider rows"],
      metadata: { week: result.week, season: result.season },
    },
    durationMs,
  )
  return true
}

export const dynamic = "force-dynamic"
export const maxDuration = 300

/*
 * Player-valuation phase bounds. The route has `maxDuration` 300s and four phases ahead of this
 * one, so the phase takes what is left minus a margin, capped, and is skipped outright if too
 * little remains to finish even one sport.
 */
const ROUTE_BUDGET_MS = maxDuration * 1000
const VALUATIONS_MARGIN_MS = 30_000
const VALUATIONS_MAX_MS = 150_000
const VALUATIONS_MIN_MS = 20_000
/*
 * Daily writer, so the rows are written to outlive a day. The reader serves stale rows anyway
 * (`allowStale: true`) and only LABELS them stale, so 30h means "stale" is shown only when a run
 * was actually missed — not every afternoon, which is what the script's 6h default would do.
 */
const VALUATIONS_TTL_MS = 30 * 60 * 60 * 1000

/** This route's sport codes (upper case, ADP vocabulary) → the valuation writer's. */
const VALUATION_SPORT_BY_CODE: Record<string, ApiChainSport> = {
  NFL: "nfl",
  NBA: "nba",
  MLB: "mlb",
  NHL: "nhl",
  NCAAF: "ncaaf",
  NCAAFB: "ncaaf",
  NCAAB: "ncaab",
  NCAABB: "ncaab",
  SOCCER: "soccer_euro",
}

function valuationSportsFor(sports: string[] | undefined): ApiChainSport[] {
  if (!sports) return PLAYER_VALUATION_SPORTS
  const mapped = sports.map((s) => VALUATION_SPORT_BY_CODE[s]).filter((s): s is ApiChainSport => Boolean(s))
  return Array.from(new Set(mapped))
}

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
  let heartbeat = false

  try {
    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        sports: sports ?? "all",
        message:
          "Dry run — no DB writes performed (ADP import, player-value capture, AI ADP job and player-valuation sync all skipped).",
        durationMs: Date.now() - startedAt,
      })
    }

    const result = await runAdpImporter({ sports })
    heartbeat = await recordAdpHeartbeat(sports, result, Date.now() - startedAt)

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
     * THE DEFENDER BOARD RIDES ALONG, BECAUSE IT IS THE OTHER HALF OF "player values".
     *
     * `ingestPlayerValues` above captures FantasyCalc, which publishes NO defenders and NO
     * kickers — 719 rostered players priced at nothing. `loadCanonicalDefenderBoard` prices them
     * against a fixed reference league, and it belongs here rather than in a new cron for the
     * plain reason that this IS the daily player-value job.
     *
     * 🛑 AND THE READ PATH CANNOT DO THIS LAZILY, WHICH IS WHY THE WRITER IS NOT OPTIONAL. The
     * board takes ~27s: it projects 5,385 defenders to find where replacement level sits, and it
     * must price the whole pool to price anyone. A read-through cache would hand the first
     * visitor after each expiry a 27-second page. So the reader returns null on a miss and
     * THIS is what makes the value exist at all — the ingestCFBDStats failure, avoided by
     * shipping the writer in the same change as the reader.
     *
     * FAILURE IS ISOLATED, same rule as its siblings: ADP and player values are already written,
     * and a stale-but-present board is strictly better than turning this run red.
     */
    let defenderBoard: Awaited<ReturnType<typeof refreshCanonicalDefenderBoardCache>> | { error: string } | null =
      null
    try {
      defenderBoard = await refreshCanonicalDefenderBoardCache({ prisma })
      if (!defenderBoard.ok) {
        console.warn("[cron/adp-refresh] defender board not refreshed:", defenderBoard.reason)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error("[cron/adp-refresh] defender board refresh failed:", message)
      defenderBoard = { error: message.slice(0, 200) }
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

    /*
     * MARKET MOVERS' VALUATIONS RIDE ALONG, AND THIS IS THE ONLY THING THAT SCHEDULES THEM.
     *
     * `/market-movers` reads `player-valuations:{sport}` through `/api/player-valuations`, and
     * the only writer was the npm script `sync:player-valuations` — which nothing ran, so the
     * surface served whatever a human last synced (`lib/enrichment-cache.ts` called it an
     * "unscheduled writer"). Owner decision 2026-09-29: schedule it WITHOUT a new cron slot —
     * the CI cron budget caps job count — and this is the daily player-value job already.
     * The writer is the script's own, moved to `lib/player-valuation-sync.ts`, not a copy.
     *
     * LAST, and BOUNDED. It calls Rolling Insights (4 endpoints × 7 sports), the slowest thing
     * here, so it gets what the route has left rather than a fixed slice: sports not yet started
     * when the budget runs out are skipped and reported, and the route does not wait past the
     * budget for one still in flight.
     *
     * FAILURE IS ISOLATED, same rule as its siblings: every earlier phase has already written.
     * One sport failing is recorded per sport by the writer; a throw here is caught and reported.
     */
    let playerValuations:
      | Awaited<ReturnType<typeof syncPlayerValuations>>
      | { skipped: string }
      | { timedOut: true; budgetMs: number }
      | { error: string }
      | null = null
    try {
      const valuationSports = valuationSportsFor(sports)
      const budgetMs = Math.min(VALUATIONS_MAX_MS, startedAt + ROUTE_BUDGET_MS - VALUATIONS_MARGIN_MS - Date.now())
      if (valuationSports.length === 0) {
        playerValuations = { skipped: "no requested sport has player valuations" }
      } else if (budgetMs < VALUATIONS_MIN_MS) {
        playerValuations = { skipped: `route time budget spent (${Math.max(0, budgetMs)}ms left)` }
      } else {
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<{ timedOut: true; budgetMs: number }>((resolve) => {
          timer = setTimeout(() => resolve({ timedOut: true, budgetMs }), budgetMs)
        })
        try {
          playerValuations = await Promise.race([
            syncPlayerValuations({
              sports: valuationSports,
              ttlMs: VALUATIONS_TTL_MS,
              deadlineAt: Date.now() + budgetMs,
            }),
            timeout,
          ])
        } finally {
          if (timer) clearTimeout(timer)
        }
      }
    } catch (e) {
      // Redacted: this phase talks to Rolling Insights, whose token rides in the query string.
      const message = redactAndCap(e instanceof Error ? e.message : e, 200)
      console.error("[cron/adp-refresh] player valuation sync failed:", message)
      playerValuations = { error: message }
    }

    return NextResponse.json({
      ok: true,
      dryRun: false,
      playerValues,
      aiAdp,
      playerValuations,
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
      /*
       * Reported rather than buried: a board that quietly stopped refreshing looks identical to
       * one that never had a defender to price, and the surface reading it shows nothing either way.
       */
      defenderBoard:
        defenderBoard && 'ok' in defenderBoard && defenderBoard.ok
          ? { priced: defenderBoard.cached.coverage.priced, candidates: defenderBoard.cached.coverage.candidates }
          : defenderBoard,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/adp-refresh] failed:", message)
    if (!heartbeat && !sports) {
      await recordSyncJobRun(
        { jobName: ADP_REFRESH_JOB, trigger: "cron" },
        { errors: [message] },
        Date.now() - startedAt,
      )
    }
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
