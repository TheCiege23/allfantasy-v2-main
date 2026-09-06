/**
 * NFL fantasy data import service.
 * Orchestrates player, ADP, injury, and schedule imports for NFL leagues.
 * All imports are idempotent/upsert-based. Missing provider keys return
 * a structured "provider unavailable" result instead of throwing.
 */
import "server-only"
import { runSportsDataImporter } from "@/lib/workers/sports-data-importer"
import { runAdpImporter } from "@/lib/workers/adp-importer"
import { runInjuryImporter } from "@/lib/workers/injury-importer"
import { runScheduleImporter } from "@/lib/workers/schedule-importer"
import { runNewsImporter } from "@/lib/workers/news-importer"
import { syncNFLDepthChartsToDb, syncNFLTeamStatsToDb } from "@/lib/rolling-insights"
import { prisma } from "@/lib/prisma"
import { importProviderDomainData } from "./importProviderDomainData"

export type FantasyImportSummary = {
  ok: boolean
  sport: "NFL" | "NCAAF"
  provider: string
  season: number
  counts: {
    players: number
    adp: number
    injuries: number
    schedules: number
    teams: number
    scores: number
    standings: number
    news: number
    playerHeadshots: number
    teamLogos: number
    depthCharts: number
    projections: number
    fantasyValues: number
    seasonStats: number
    gameLogs: number
    weather: number
    idpStats: number
  }
  skipped: number
  missingEnv: string[]
  stale: boolean
  warnings: string[]
  errors: string[]
  durationMs: number
  startedAt: string
  completedAt: string
  dryRun: boolean
}

function currentSeason(): number {
  return new Date().getFullYear()
}

function checkNflEnv(): string[] {
  const missing: string[] = []
  const hasRollingInsights =
    Boolean(process.env.ROLLING_INSIGHTS_API_KEY?.trim()) ||
    Boolean(process.env.ROLLINGINSIGHTS_API_KEY?.trim()) ||
    (Boolean(process.env.ROLLING_INSIGHTS_CLIENT_ID?.trim()) &&
      Boolean(process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim())) ||
    (Boolean(process.env.ROLLING_INSIGHTS_CLIENT_ID2?.trim()) &&
      Boolean(process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim()))
  if (!hasRollingInsights) {
    missing.push("ROLLING_INSIGHTS_API_KEY or ROLLING_INSIGHTS_CLIENT_ID/ROLLING_INSIGHTS_CLIENT_SECRET")
  }
  const hasApiSports =
    Boolean(process.env.APISPORTS_API_KEY?.trim()) ||
    Boolean(process.env.APISPORTS_KEY?.trim()) ||
    Boolean(process.env.API_SPORTS_KEY?.trim()) ||
    Boolean(process.env.SPORTS_API_KEY?.trim())
  if (!hasApiSports) {
    missing.push("APISPORTS_API_KEY or APISPORTS_KEY or API_SPORTS_KEY or SPORTS_API_KEY")
  }
  return missing
}

async function recordImportRun(params: {
  sport: string
  rowsWritten: number
  status: string
  errorMessage?: string | null
}): Promise<void> {
  try {
    await (prisma as any).syncJobRun.create({
      data: {
        jobName: "import-nfl-fantasy-data",
        jobScope: params.sport,
        trigger: "api",
        status: params.status,
        rowsRead: 0,
        rowsWritten: params.rowsWritten,
        rowsSkipped: 0,
        errorMessage: params.errorMessage ?? null,
        startedAt: new Date(),
        completedAt: new Date(),
        durationMs: 0,
      },
    })
  } catch {
    // non-critical
  }
}

export async function importNflFantasyData(options?: {
  season?: number
  dryRun?: boolean
  sports?: string[]
  week?: number
}): Promise<FantasyImportSummary> {
  const startedAt = new Date()
  const season = options?.season ?? currentSeason()
  const dryRun = options?.dryRun ?? false
  const missingEnv = checkNflEnv()
  const warnings: string[] = [...missingEnv.map((k) => `Missing env: ${k}`)]
  const errors: string[] = []

  let playersImported = 0
  let adpImported = 0
  let injuriesImported = 0
  let schedulesImported = 0
  let teamsImported = 0
  let scoresImported = 0
  let standingsImported = 0
  let newsImported = 0
  let playerHeadshotsImported = 0
  let teamLogosImported = 0
  let depthChartsImported = 0
  let projectionsImported = 0
  let fantasyValuesImported = 0
  let seasonStatsImported = 0
  let skipped = 0

  if (missingEnv.length > 0) {
    warnings.push("NFL provider keys are missing — running with cached/fallback data only.")
  }

  // ── Players ──────────────────────────────────────────────────────────────────
  try {
    if (!dryRun) {
      const result = await runSportsDataImporter({ sports: ["NFL"] })
      playersImported = result.imported
      if (result.staleFallbackApplied) {
        warnings.push("NFL player import used stale fallback — provider may be unavailable.")
      }
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`Player import failed: ${msg.slice(0, 200)}`)
  }

  // ── ADP ───────────────────────────────────────────────────────────────────────
  try {
    if (!dryRun) {
      const result = await runAdpImporter({ sports: ["NFL"] })
      adpImported = result.imported
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`ADP import failed: ${msg.slice(0, 200)}`)
  }

  // ── Injuries ─────────────────────────────────────────────────────────────────
  try {
    if (!dryRun) {
      const result = await runInjuryImporter({
        sports: ["NFL"],
        week: options?.week,
      })
      injuriesImported = result.imported
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`Injury import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  // ── Schedules ─────────────────────────────────────────────────────────────────
  try {
    if (!dryRun) {
      const result = await runScheduleImporter({
        sports: ["NFL"],
        season,
      })
      schedulesImported = result.imported
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`Schedule import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    if (!dryRun) {
      const result = await runNewsImporter({ sports: ["NFL"] })
      newsImported += result.imported
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`News import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    if (!dryRun) {
      const result = await importProviderDomainData({
        sport: "NFL",
        season,
        week: options?.week,
      })
      teamsImported += result.results.find((row) => row.domain === "teams")?.imported ?? 0
      schedulesImported += result.results.find((row) => row.domain === "schedules")?.imported ?? 0
      scoresImported += result.results.find((row) => row.domain === "scores")?.imported ?? 0
      standingsImported += result.results.find((row) => row.domain === "standings")?.imported ?? 0
      newsImported += result.results.find((row) => row.domain === "news")?.imported ?? 0
      playerHeadshotsImported += result.results.find((row) => row.domain === "player_headshots")?.imported ?? 0
      teamLogosImported += result.results.find((row) => row.domain === "team_logos")?.imported ?? 0
      projectionsImported += result.results.find((row) => row.domain === "projections")?.imported ?? 0
      fantasyValuesImported += result.results.find((row) => row.domain === "fantasy_values")?.imported ?? 0
      warnings.push(...result.warnings)
      errors.push(...result.errors)
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`Provider domain import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    if (!dryRun) {
      depthChartsImported = await syncNFLDepthChartsToDb({ season: String(season) })
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`Depth chart import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    if (!dryRun) {
      seasonStatsImported = await syncNFLTeamStatsToDb({ season: String(season) })
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`Team season stats import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  const completedAt = new Date()
  const totalWritten =
    playersImported +
    adpImported +
    injuriesImported +
    schedulesImported +
    teamsImported +
    scoresImported +
    standingsImported +
    newsImported +
    playerHeadshotsImported +
    teamLogosImported +
    depthChartsImported +
    projectionsImported +
    fantasyValuesImported +
    seasonStatsImported

  if (!dryRun) {
    await recordImportRun({
      sport: "NFL",
      rowsWritten: totalWritten,
      // `success`, not `completed` — one vocabulary for sync_job_runs.status. This writer is
      // currently dormant (zero rows in production), so it is switched now precisely because it
      // would otherwise re-open the split the moment it first runs.
      status: errors.length > 0 ? "partial" : "success",
      errorMessage: errors.length > 0 ? errors[0] : null,
    })
  }

  return {
    ok: errors.length === 0 || totalWritten > 0,
    sport: "NFL",
    provider: missingEnv.length === 0 ? "rolling_insights+api_sports+sleeper" : "sleeper+cache",
    season,
    counts: {
      players: playersImported,
      adp: adpImported,
      injuries: injuriesImported,
      schedules: schedulesImported,
      teams: teamsImported,
      scores: scoresImported,
      standings: standingsImported,
      news: newsImported,
      playerHeadshots: playerHeadshotsImported,
      teamLogos: teamLogosImported,
      depthCharts: depthChartsImported,
      projections: projectionsImported,
      fantasyValues: fantasyValuesImported,
      seasonStats: seasonStatsImported,
      gameLogs: 0,
      weather: 0,
      idpStats: 0,
    },
    skipped,
    missingEnv,
    stale: missingEnv.length > 0,
    warnings,
    errors,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    dryRun,
  }
}
