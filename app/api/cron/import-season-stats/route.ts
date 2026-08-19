/**
 * GET/POST /api/cron/import-season-stats
 *
 * Vercel Cron schedule: daily at 06:20 UTC (see vercel.json).
 *
 * `PlayerSeasonStats` is read by /api/players/season-stats (DB-only, no live fallback) but had
 * no scheduled writer — only the admin-gated /api/sports/sync could refresh it, so it went stale
 * until someone triggered a sync by hand. Production rows were 73 days old when this was added.
 *
 * Calls `syncNflFoundationSeasonStats`, which pulls Rolling Insights' `player-stats/{year}/NFL`
 * endpoint. Note this is deliberately NOT `syncNFLPlayersToDb`: that function reads the *roster*
 * endpoint, whose payload carries no `regularSeason` block at all (verified live — 0 of 66
 * players for 2025-2026), so a cron built on it would run green and write zero stat rows.
 *
 * Season handling: RI 400s on a season that has not started, so the sync walks back up to
 * SEASON_FALLBACK_MAX_YEARS until one returns rows, and labels each row with the season that
 * actually supplied it. During the offseason this means the endpoint serves last completed
 * season totals — correct data, correctly labelled.
 *
 * Query params:
 *   season — override the season to sync (default: current year, with fallback)
 *   limit  — cap rows processed (smoke tests)
 *   dryRun — "true" to report without writing
 */

import type { NextRequest } from "next/server"
import { NextResponse } from "next/server"
import { requireCronAuth } from "@/app/api/cron/_auth"
import { syncNflFoundationSeasonStats } from "@/lib/nfl-data-foundation/nflFoundationSync"

export const dynamic = "force-dynamic"
import { ingestPlayerStats } from '@/lib/sports-data/theSportsDbIngest'

export const maxDuration = 300

async function handle(req: NextRequest) {
  const url = new URL(req.url)
  const seasonParam = url.searchParams.get("season")?.trim()
  const limitParam = Number(url.searchParams.get("limit"))
  const dryRun = url.searchParams.get("dryRun") === "true"
  const startedAt = Date.now()

  try {
    const report = await syncNflFoundationSeasonStats({
      season: seasonParam || String(new Date().getUTCFullYear()),
      write: !dryRun,
      ...(Number.isFinite(limitParam) && limitParam > 0 ? { limit: limitParam } : {}),
    })

    /*
     * TheSportsDB season statistics.
     *
     * Folded in here rather than given a route — the repo is at the 2048-route
     * ceiling, and this cron already owns season stats. Daily at 06:20 matches
     * freshnessPolicy's player_season_stats tier.
     *
     * ⚠ BOUNDED AND CYCLING. lookupplayerstats is ONE CALL PER PLAYER, so all
     * ~5,000 stored players would take about an hour — far past this route's 300s
     * maxDuration. Each run takes a slice; ingestPlayerStats orders players with
     * no stats row first, then least-recently-fetched, so successive runs walk
     * the whole population instead of re-fetching the same head every night.
     */
    const tsdbStats: Record<string, unknown> = {}
    if (url.searchParams.get('tsdb') !== '0' && !dryRun) {
      for (const sport of ['NFL', 'NBA', 'NHL', 'MLB'] as const) {
        try {
          const r = await ingestPlayerStats(sport, { maxPlayers: 60 })
          tsdbStats[sport] = {
            queried: r.playersQueried,
            withStats: r.playersWithStats,
            seasonRows: r.seasonRowsWritten,
          }
        } catch (err) {
          tsdbStats[sport] = { error: String(err).slice(0, 120) }
        }
      }
    }

    return NextResponse.json({
      ok: true,
      dryRun,
      thesportsdb: tsdbStats,
      requestedSeason: report.requestedSeason,
      season: report.season,
      fallbackSeasonUsed: report.fallbackSeasonUsed,
      providerRows: report.providerRows,
      rowsWithRegularSeason: report.rowsWithRegularSeason,
      matchedSportsPlayers: report.matchedSportsPlayers,
      written: report.written,
      skippedMissingStats: report.skippedMissingStats,
      errors: report.errors,
      durationMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error("[cron/import-season-stats] failed:", message)
    return NextResponse.json(
      { ok: false, error: message.slice(0, 240), durationMs: Date.now() - startedAt },
      { status: 500 },
    )
  }
}

// NOTE: `CRON_SECRET` is named explicitly. `requireCronAuth` resolves
// `preferredSecretEnv ?? LEAGUE_CRON_SECRET ?? CRON_SECRET`, and LEAGUE_CRON_SECRET is set in
// production — so a bare `requireCronAuth(req)` compares Vercel's Bearer against the wrong
// variable and 401s on every run (see #289 / #304).
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
