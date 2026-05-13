import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { requireCronAuth } from "../_auth"
import { syncAllPlayoffChallenges } from "@/lib/playoffs/playoffLiveSyncService"
import type { PlayoffSport } from "@/lib/playoffs/types"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * GET /api/cron/playoff-live-sync
 *
 * Cron: every 5 minutes — syncs live/completed game data into
 * PlayoffBracketSeries records (homeWins, awayWins, status, winnerTeamName)
 * for all open NBA/NHL bracket challenges.
 *
 * Triggers scoreAllEntriesForChallenge whenever a series is newly clinched.
 *
 * Auth: Authorization: Bearer ${CRON_SECRET} (or LEAGUE_CRON_SECRET / BRACKET_ADMIN_SECRET)
 *
 * Query params:
 *   ?sport=nba|nhl          — default "nba"
 *   ?season=2026            — default current UTC year
 *   ?dryRun=true            — simulate writes (no DB mutations)
 *   ?challengeId=<id>       — target a single challenge (skip discovery)
 */
export async function GET(request: NextRequest) {
  if (!requireCronAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  const singleChallengeId = url.searchParams.get("challengeId") ?? undefined

  const rawSport = url.searchParams.get("sport") ?? "nba"
  const sport: PlayoffSport = rawSport === "nhl" ? "nhl" : "nba"

  const rawSeason = url.searchParams.get("season")
  const season = rawSeason ? parseInt(rawSeason, 10) : new Date().getUTCFullYear()

  const startedAt = Date.now()

  console.log(
    `[playoff-live-sync/cron] starting — sport=${sport} season=${season} dryRun=${dryRun}` +
      (singleChallengeId ? ` challengeId=${singleChallengeId}` : "")
  )

  let result
  try {
    result = await syncAllPlayoffChallenges({ sport, season, dryRun, singleChallengeId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[playoff-live-sync/cron] fatal error:", msg)
    return NextResponse.json({ ok: false, error: "sync_failed", detail: msg }, { status: 500 })
  }

  const durationMs = Date.now() - startedAt

  // Build a compact summary log
  const totalUpdated = result.challengeResults.reduce((acc, c) => acc + c.seriesUpdated, 0)
  const totalClinched = result.challengeResults.reduce((acc, c) => acc + c.newlyClinched, 0)
  const totalErrors = result.errors.length + result.challengeResults.reduce((acc, c) => acc + c.errors.length, 0)

  console.log(
    `[playoff-live-sync/cron] done — challenges=${result.challengesProcessed} ` +
      `seriesUpdated=${totalUpdated} clinched=${totalClinched} errors=${totalErrors} ${durationMs}ms`
  )

  if (totalErrors > 0) {
    const allErrors = [
      ...result.errors,
      ...result.challengeResults.flatMap((c) => c.errors),
    ]
    console.warn("[playoff-live-sync/cron] errors:", allErrors)
  }

  return NextResponse.json({
    ok: totalErrors === 0,
    sport,
    season,
    dryRun,
    durationMs,
    challengesProcessed: result.challengesProcessed,
    seriesUpdated: totalUpdated,
    newlyClinched: totalClinched,
    errors: totalErrors,
    results: result.challengeResults.map((c) => ({
      challengeId: c.challengeId,
      seriesTotal: c.seriesTotal,
      seriesProcessed: c.seriesProcessed,
      seriesUpdated: c.seriesUpdated,
      newlyClinched: c.newlyClinched,
      errors: c.errors.length > 0 ? c.errors : undefined,
      series: c.results.map((s) => ({
        id: s.seriesId,
        match: `${s.homeTeamName} vs ${s.awayTeamName}`,
        score: `${s.homeWins}–${s.awayWins}`,
        status: s.status,
        winner: s.winnerTeamName ?? undefined,
        live: s.isLive || undefined,
        clinched: s.newlyClinched || undefined,
        skipped: s.skipped || undefined,
        skipReason: s.skipReason,
        updated: s.wasUpdated || undefined,
      })),
    })),
  })
}
