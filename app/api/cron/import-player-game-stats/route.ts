/**
 * GET/POST /api/cron/import-player-game-stats
 *
 * Vercel Cron: daily at 06:40 UTC (see vercel.json).
 *
 * `PlayerGameStat` had ZERO production rows — its write path existed but nothing called it
 * (the only wired route, /api/internal/schedule-stats/ingest, is a dormant external-push
 * design gated on an unset STATS_INGESTION_API_KEY). Downstream, best-ball treated the empty
 * table as legitimate all-zero stats and the warehouse history UI rendered empty data as real.
 * This cron is the active, authenticated ingestion path: Sleeper week stats → ingestSportStats
 * (normalization + fantasy points) → PlayerGameStat → generateGameFactsFromExistingStats →
 * PlayerGameFact.
 *
 * Behavior per run: resolve the newest season with data (bounded walk-back — it is the
 * offseason, the current year 400s/empties), then ingest missing weeks oldest-first, bounded
 * by maxWeeks and a wall-clock budget. Idempotent; once a season is fully ingested this is a
 * cheap no-op until next season starts. Concurrency-guarded via SyncJobRun.
 *
 * Query params:
 *   season   — override season (default: current UTC year, with fallback walk-back)
 *   week     — ingest exactly this week
 *   maxWeeks — cap weeks per run (default 6)
 *   limit    — cap player rows per week (smoke tests)
 *   dryRun   — "true" to fetch/count without writing
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import {
  SleeperWeeklyStatsFetcher,
  findMissingWeeks,
  importPlayerGameStatsForWeek,
  isPlayerGameStatsSchemaReady,
  loadKnownNflPlayerIds,
  resolveIngestableSeason,
  type ImportWeekReport,
} from "@/lib/player-game-stats/importPlayerGameStats"

export const dynamic = "force-dynamic"
export const maxDuration = 300

const JOB_NAME = "import-player-game-stats"
const RUN_BUDGET_MS = 240_000
const LOCK_WINDOW_MS = 10 * 60 * 1000
const DEFAULT_MAX_WEEKS = 6

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  const seasonParam = Number(url.searchParams.get("season"))
  const weekParam = Number(url.searchParams.get("week"))
  const limitParam = Number(url.searchParams.get("limit"))
  const maxWeeksParam = Number(url.searchParams.get("maxWeeks"))
  const startedAt = Date.now()

  // Deploy-ordering safety: until the additive player_game_stats migration is applied, this
  // run is a clean no-op — 200, zero writes (not even a lock row). Merging the code before
  // the migration is therefore inert; the cron self-arms the moment the schema is ready.
  if (!(await isPlayerGameStatsSchemaReady())) {
    return NextResponse.json({
      ok: false,
      skipped: true,
      reason: "migration_pending: player_game_stats lacks the provider-telemetry columns; apply 20260721120000_player_game_stats_provider_telemetry",
      durationMs: Date.now() - startedAt,
    })
  }

  // Durable lock: a concurrent run inside the window is skipped, not doubled.
  const running = await prisma.syncJobRun.findFirst({
    where: {
      jobName: JOB_NAME,
      status: "running",
      startedAt: { gt: new Date(Date.now() - LOCK_WINDOW_MS) },
    },
    select: { id: true, startedAt: true },
  })
  if (running) {
    return NextResponse.json(
      { ok: false, skipped: true, reason: `already running since ${running.startedAt.toISOString()}` },
      { status: 409 },
    )
  }

  const run = dryRun
    ? null
    : await prisma.syncJobRun.create({
        data: { jobName: JOB_NAME, jobScope: "NFL", trigger: "cron", status: "running" },
        select: { id: true },
      })

  try {
    const fetcher = new SleeperWeeklyStatsFetcher()
    const requestedSeason = Number.isFinite(seasonParam) && seasonParam > 2000
      ? seasonParam
      : new Date().getUTCFullYear()

    const resolved = await resolveIngestableSeason(requestedSeason, fetcher)
    if (!resolved) {
      throw new Error(`no ingestable season found walking back from ${requestedSeason}`)
    }

    const weeks = Number.isFinite(weekParam) && weekParam >= 1
      ? [Math.floor(weekParam)]
      : await findMissingWeeks(resolved.season)

    const maxWeeks = Number.isFinite(maxWeeksParam) && maxWeeksParam > 0
      ? Math.floor(maxWeeksParam)
      : DEFAULT_MAX_WEEKS

    const knownPlayerIds = await loadKnownNflPlayerIds()
    const reports: ImportWeekReport[] = []
    let budgetExhausted = false

    for (const week of weeks.slice(0, maxWeeks)) {
      if (Date.now() - startedAt > RUN_BUDGET_MS) {
        budgetExhausted = true
        break
      }
      const report = await importPlayerGameStatsForWeek({
        season: resolved.season,
        week,
        fetcher,
        knownPlayerIds,
        dryRun,
        ...(Number.isFinite(limitParam) && limitParam > 0 ? { limit: Math.floor(limitParam) } : {}),
      })
      // null = provider failure for that week; report truthfully and keep going.
      if (report) reports.push(report)
      else reports.push({
        season: resolved.season, week, fetched: 0, teamRowsFiltered: 0, ingested: 0, matchedPlayers: 0,
        unresolvedPlayers: 0, playerFactsGenerated: 0, factStatus: "provider_failed", dryRun,
      })
    }

    const totals = reports.reduce(
      (acc, r) => ({
        fetched: acc.fetched + r.fetched,
        ingested: acc.ingested + r.ingested,
        matchedPlayers: acc.matchedPlayers + r.matchedPlayers,
        unresolvedPlayers: acc.unresolvedPlayers + r.unresolvedPlayers,
        playerFactsGenerated: acc.playerFactsGenerated + r.playerFactsGenerated,
      }),
      { fetched: 0, ingested: 0, matchedPlayers: 0, unresolvedPlayers: 0, playerFactsGenerated: 0 },
    )

    if (run) {
      await prisma.syncJobRun.update({
        where: { id: run.id },
        data: {
          status: "completed",
          rowsRead: totals.fetched,
          rowsWritten: totals.ingested,
          rowsSkipped: totals.unresolvedPlayers,
          completedAt: new Date(),
          durationMs: Date.now() - startedAt,
          metadata: {
            season: resolved.season,
            fallbackSeasonUsed: resolved.fallbackUsed,
            weeksProcessed: reports.map((r) => r.week),
            weeksRemaining: weeks.slice(reports.length).length,
            budgetExhausted,
            playerFactsGenerated: totals.playerFactsGenerated,
          },
        },
      })
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      provider: "sleeper",
      sport: "NFL",
      requestedSeason,
      season: resolved.season,
      fallbackSeasonUsed: resolved.fallbackUsed,
      weeksProcessed: reports.map((r) => r.week),
      weeksRemaining: weeks.slice(reports.length),
      budgetExhausted,
      ...totals,
      perWeek: reports,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (run) {
      await prisma.syncJobRun.update({
        where: { id: run.id },
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
