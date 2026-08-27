/**
 * GET/POST /api/cron/import-player-game-stats
 *
 * Vercel Cron: daily at 06:40 UTC (see vercel.json).
 *
 * Sleeper week stats → ingestSportStats (normalization + fantasy points) → PlayerGameStat →
 * generateGameFactsFromExistingStats → PlayerGameFact, with an explicit per-week completion
 * ledger. See lib/player-game-stats/importPlayerGameStats.ts for the full design rationale.
 *
 * Per run: sweep stale telemetry → acquire the atomic run lock → resolve the newest season
 * with data → repair PARTIAL weeks first (facts-only regeneration, no provider call) → ingest
 * MISSING weeks oldest-first, bounded by maxWeeks and a wall-clock budget. Provider failures
 * are tagged (timeout/http/network) per week and never abort the run. Idempotent throughout;
 * once a season reconciles this is a cheap no-op.
 *
 * Query params:
 *   season   — override season (default: current UTC year, with fallback walk-back)
 *   week     — process exactly this week (full fetch+ingest, even if completed)
 *   maxWeeks — cap weeks per run (default 6)
 *   limit    — cap player rows per week (smoke tests; such weeks stay `partial` by design)
 *   dryRun   — "true" to fetch/count without writing
 *
 *   multiSport — "1" switches to the Rolling Insights date sweep for MLB / NBA / NHL / NCAAB /
 *                SOCCER and skips the whole NFL path above. See the block that reads it.
 *   sport      — with multiSport=1, restrict to one of those sports
 *   days       — with multiSport=1, how many days back to sweep (default 3, max 120)
 *   from,to    — with multiSport=1, an explicit YYYY-MM-DD range for a historical backfill
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import { toPrismaJsonInput } from "@/lib/prisma-json"
import { createRunBudget, rotateForFairness } from "@/lib/cron/runBudget"
import {
  dateRange,
  ingestRollingInsightsGameLogs,
  recentDates,
} from "@/lib/sports-data/rollingInsightsGameLogs"
import { scoreProjectionAccuracyForCompletedWeeks } from "@/lib/projections/projectionAccuracy"
import {
  SleeperWeeklyStatsFetcher,
  acquireRunLock,
  findWeeksNeedingWork,
  importPlayerGameStatsForWeek,
  isPlayerGameStatsSchemaReady,
  loadKnownNflPlayerIds,
  repairWeekFacts,
  resolveIngestableSeason,
  sweepStaleIngestionState,
  type ImportWeekReport,
} from "@/lib/player-game-stats/importPlayerGameStats"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const RUN_BUDGET_MS = 240_000
const DEFAULT_MAX_WEEKS = 6

/**
 * Sports whose per-game player lines come from Rolling Insights `/live/{date}/{SPORT}`.
 *
 * NFL is absent because it already has a better source here: Sleeper's weekly stats, with a
 * completion ledger and fantasy points already computed. NCAAF is absent because Rolling Insights
 * carries no college football data at all — measured `fetched: 0` — which is the same reason
 * `import-stat-lines` routes NCAAF to CollegeFootballData.
 */
const MULTI_SPORT_GAME_LOG_SPORTS = ["MLB", "NBA", "NHL", "NCAAB", "SOCCER"] as const

type WeekOutcome = ImportWeekReport | {
  season: number
  week: number
  providerFailure: string
  status?: number
}

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  const seasonParam = Number(url.searchParams.get("season"))
  const weekParam = Number(url.searchParams.get("week"))
  const limitParam = Number(url.searchParams.get("limit"))
  const maxWeeksParam = Number(url.searchParams.get("maxWeeks"))
  const startedAt = Date.now()

  // Deploy-ordering safety: until the additive player_game_stats migration is applied, this
  // run is a clean no-op — 200, zero writes (not even a lock row).
  if (!(await isPlayerGameStatsSchemaReady())) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "migration_pending: player_game_stats lacks the provider-telemetry columns; apply 20260721120000_player_game_stats_provider_telemetry",
      durationMs: Date.now() - startedAt,
    })
  }

  /*
   * MULTI-SPORT MODE — `?multiSport=1`, optionally narrowed with `?sport=`.
   *
   * ⚠ AN EXCLUSIVE MODE, ABOVE THE LOCK, ON PURPOSE. Everything below this point is
   * NFL-by-construction: `SleeperWeeklyStatsFetcher` serves only NFL, the completion ledger is
   * keyed by NFL week, and `acquireRunLock` is a single global lock this job holds for its whole
   * run. Measured on production 2026-08-27, that is why `player_game_stats` held 252,768 rows and
   * every one was NFL. Threading six more sports through the NFL ledger would mean either
   * serialising them behind one lock or inventing a week number for sports that have no weeks.
   *
   * The other sports instead sweep DATES against Rolling Insights' `/live/{date}/{SPORT}`, which
   * the contract describes as returning started AND finished events — so the same call is both
   * the live tick and the historical backfill. Newest-first, budgeted, and resumable by simply
   * running again: the upsert key is (playerId, sportType, gameId), so re-covering a date is free.
   *
   * NOT A NEW ROUTE, deliberately — the repo sits at Vercel's 2048-route ceiling and per-game
   * player stats already have a home here.
   */
  if (url.searchParams.get("multiSport") === "1") {
    const explicit = url.searchParams.get("sport")?.trim().toUpperCase()
    const daysParam = Number(url.searchParams.get("days"))
    const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.floor(daysParam), 120) : 3
    const fromDate = url.searchParams.get("from")
    const toDate = url.searchParams.get("to")

    const candidates = MULTI_SPORT_GAME_LOG_SPORTS.filter((s) => (explicit ? s === explicit : true))
    const budget = createRunBudget(RUN_BUDGET_MS)
    const perSport: Record<string, unknown> = {}
    const deferred: string[] = []

    // Rotated so a budget cut does not starve the same sport every night.
    for (const s of rotateForFairness(candidates)) {
      if (!explicit && budget.exhausted()) {
        deferred.push(s)
        continue
      }
      const dates =
        fromDate && toDate ? dateRange(fromDate, toDate) : recentDates(days)
      try {
        perSport[s] = await ingestRollingInsightsGameLogs({
          sport: s,
          dates,
          shouldStop: () => budget.exhausted(),
        })
      } catch (err) {
        perSport[s] = { error: String(err).slice(0, 200) }
      }
    }

    const written = Object.values(perSport).reduce<number>(
      (a, r) => a + (typeof (r as { written?: number }).written === "number" ? (r as { written: number }).written : 0),
      0,
    )
    return NextResponse.json({
      ok: true,
      mode: "multiSport",
      provider: "rolling_insights",
      written,
      sports: perSport,
      deferredForBudget: deferred.length ? deferred : undefined,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  }

  // Stale-state sweep BEFORE lock acquisition: a function killed mid-run must not block the
  // next scheduled run beyond the stale threshold, and its telemetry row is truthfully
  // closed as timed_out rather than lingering as 'running' forever.
  const swept = dryRun ? { sweptRuns: 0, sweptLedger: 0 } : await sweepStaleIngestionState()

  // Atomic lock: single INSERT ... WHERE NOT EXISTS — concurrent invocations cannot both win.
  const lockId = dryRun ? null : await acquireRunLock("cron")
  if (!dryRun && lockId == null) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: "another run holds the lock", swept },
      { status: 409 },
    )
  }

  try {
    const fetcher = new SleeperWeeklyStatsFetcher()
    const requestedSeason = Number.isFinite(seasonParam) && seasonParam > 2000
      ? seasonParam
      : new Date().getUTCFullYear()

    const resolved = await resolveIngestableSeason(requestedSeason, fetcher)
    if (!resolved) {
      throw new Error(`no ingestable season found walking back from ${requestedSeason}`)
    }

    const maxWeeks = Number.isFinite(maxWeeksParam) && maxWeeksParam > 0
      ? Math.floor(maxWeeksParam)
      : DEFAULT_MAX_WEEKS

    const explicitWeek = Number.isFinite(weekParam) && weekParam >= 1 ? Math.floor(weekParam) : null
    const plan = explicitWeek
      ? { missing: [explicitWeek], partial: [] as number[], completed: [] as number[] }
      : await findWeeksNeedingWork(resolved.season)

    const reports: WeekOutcome[] = []
    const repairs: WeekOutcome[] = []
    let budgetExhausted = false
    let processed = 0

    // Partial weeks first: facts-only regeneration is cheap (no provider call) and closes
    // the exact stats-without-facts gap the release hit on week 16.
    for (const week of plan.partial) {
      if (processed >= maxWeeks || Date.now() - startedAt > RUN_BUDGET_MS) { budgetExhausted = true; break }
      if (dryRun) { repairs.push({ season: resolved.season, week, providerFailure: "dry_run_skip" }); continue }
      try {
        repairs.push(await repairWeekFacts(resolved.season, week))
        processed += 1
      } catch (err) {
        repairs.push({ season: resolved.season, week, providerFailure: `repair_failed: ${err instanceof Error ? err.message : String(err)}` })
      }
    }

    const knownPlayerIds = plan.missing.length > 0 ? await loadKnownNflPlayerIds() : new Set<string>()

    for (const week of plan.missing.slice(0, Math.max(0, maxWeeks - processed))) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) { budgetExhausted = true; break }
      const result = await importPlayerGameStatsForWeek({
        season: resolved.season,
        week,
        fetcher,
        knownPlayerIds,
        dryRun,
        ...(Number.isFinite(limitParam) && limitParam > 0 ? { limit: Math.floor(limitParam) } : {}),
      })
      if ("providerFailure" in result) {
        reports.push({ season: resolved.season, week, providerFailure: result.providerFailure, status: result.status })
      } else {
        reports.push(result)
        processed += 1
      }
    }

    const ingestReports = reports.filter((r): r is ImportWeekReport => !("providerFailure" in r))
    const totals = ingestReports.reduce(
      (acc, r) => ({
        fetched: acc.fetched + r.fetched,
        teamRowsFiltered: acc.teamRowsFiltered + r.teamRowsFiltered,
        ingested: acc.ingested + r.ingested,
        matchedPlayers: acc.matchedPlayers + r.matchedPlayers,
        unresolvedPlayers: acc.unresolvedPlayers + r.unresolvedPlayers,
        playerFactsGenerated: acc.playerFactsGenerated + r.playerFactsGenerated,
      }),
      { fetched: 0, teamRowsFiltered: 0, ingested: 0, matchedPlayers: 0, unresolvedPlayers: 0, playerFactsGenerated: 0 },
    )
    const providerFailures = reports.filter((r) => "providerFailure" in r)
    const weeksRemaining = explicitWeek
      ? []
      : [...plan.partial, ...plan.missing].filter(
          (week) => ![...repairs, ...reports].some((r) => r.week === week && !("providerFailure" in r)),
        )

    if (lockId) {
      await prisma.syncJobRun.update({
        where: { id: lockId },
        data: {
          status: "completed",
          rowsRead: totals.fetched,
          rowsWritten: totals.ingested,
          rowsSkipped: totals.unresolvedPlayers,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
          metadata: toPrismaJsonInput({
            season: resolved.season,
            fallbackSeasonUsed: resolved.fallbackUsed,
            weeksIngested: ingestReports.map((r) => r.week),
            weeksRepaired: repairs.filter((r) => !("providerFailure" in r)).map((r) => r.week),
            weeksRemaining,
            providerFailures: providerFailures.map((r) => ({ week: r.week, kind: (r as { providerFailure: string }).providerFailure })),
            budgetExhausted,
            swept,
            playerFactsGenerated: totals.playerFactsGenerated,
          }),
        },
      })
    }

    /*
     * Projection accuracy retro-scorer (P4-1). Once a week's actuals are proven complete,
     * rescore that week's stored projections (provider + AF mirror) against the actuals
     * under one canonical PPR ruler and persist the per-source/per-position error summary
     * to SportsDataCache — see lib/projections/projectionAccuracy.ts. Only weeks the ledger
     * already proved complete on a PREVIOUS run are eligible, so a partial ingest is never
     * scored; capped and budget-bounded so it cannot starve the ingest this cron exists for.
     */
    let projectionAccuracy:
      | Awaited<ReturnType<typeof scoreProjectionAccuracyForCompletedWeeks>>
      | { error: string }
      | null = null
    if (!dryRun && !explicitWeek && plan.completed.length > 0) {
      try {
        projectionAccuracy = await scoreProjectionAccuracyForCompletedWeeks(resolved.season, plan.completed, {
          maxWeeks: 2,
          budgetMs: Math.max(0, RUN_BUDGET_MS - (Date.now() - startedAt)),
        })
      } catch (err) {
        projectionAccuracy = { error: (err instanceof Error ? err.message : String(err)).slice(0, 200) }
      }
    }

    return NextResponse.json({
      ok: providerFailures.length === 0,
      dryRun,
      provider: "sleeper",
      sport: "NFL",
      requestedSeason,
      season: resolved.season,
      fallbackSeasonUsed: resolved.fallbackUsed,
      swept,
      plan: { partial: plan.partial, missing: plan.missing, completed: plan.completed.length },
      repairs,
      weeksProcessed: ingestReports.map((r) => r.week),
      weeksRemaining,
      providerFailures,
      budgetExhausted,
      projectionAccuracy,
      ...totals,
      perWeek: reports,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (lockId) {
      await prisma.syncJobRun.update({
        where: { id: lockId },
        data: {
          status: "failed",
          errorMessage: message.slice(0, 500),
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      }).catch(() => undefined)
    }
    console.error("[cron/import-player-game-stats] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

// NOTE: `CRON_SECRET` is named explicitly. `requireCronAuth` resolves
// `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`, and LEAGUE_CRON_SECRET is set in
// production — a bare `requireCronAuth(req)` 401s on every scheduled run (see #289 / #304).
export async function GET(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return handle(req)
}

export async function POST(req: NextRequest) {
  if (!requireCronAuth(req, "CRON_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return handle(req)
}
