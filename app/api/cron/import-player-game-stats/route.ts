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
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { prisma } from "@/lib/prisma"
import { toPrismaJsonInput } from "@/lib/prisma-json"
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
