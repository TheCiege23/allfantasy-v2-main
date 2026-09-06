/**
 * NCAAF fantasy data import service.
 * NCAAF data (devy/C2C) requires the CFBD provider key. Without it, returns
 * a structured "provider unavailable" result so the UI/AI can show the correct
 * beta/pending state instead of crashing or hallucinating data.
 */
import "server-only"
import { runSportsDataImporter } from "@/lib/workers/sports-data-importer"
import { runInjuryImporter } from "@/lib/workers/injury-importer"
import { runNewsImporter } from "@/lib/workers/news-importer"
import { runScheduleImporter } from "@/lib/workers/schedule-importer"
import { prisma } from "@/lib/prisma"
import type { FantasyImportSummary } from "./importNflFantasyData"
import { importProviderDomainData } from "./importProviderDomainData"

export type NcaafImportMode = "redraft" | "devy" | "c2c" | "all"

function currentSeason(): number {
  return new Date().getFullYear()
}

function checkNcaafEnv(): { missingEnv: string[]; providerAvailable: boolean } {
  const missingEnv: string[] = []
  const hasCfbd =
    Boolean(process.env.CFBD_API_KEY?.trim()) ||
    Boolean(process.env.CFBD_KEY?.trim()) ||
    Boolean(process.env.COLLEGE_FOOTBALL_DATA_API_KEY?.trim())
  const hasApiSports =
    Boolean(process.env.APISPORTS_API_KEY?.trim()) ||
    Boolean(process.env.APISPORTS_KEY?.trim()) ||
    Boolean(process.env.API_SPORTS_KEY?.trim()) ||
    Boolean(process.env.SPORTS_API_KEY?.trim()) ||
    Boolean(process.env.X_RAPIDAPI_KEY?.trim())

  if (!hasCfbd) {
    missingEnv.push("CFBD_API_KEY or CFBD_KEY or COLLEGE_FOOTBALL_DATA_API_KEY (CollegeFootballData) - required for NCAAF player data")
  }

  if (!hasApiSports) {
    missingEnv.push("APISPORTS_API_KEY or APISPORTS_KEY or API_SPORTS_KEY or SPORTS_API_KEY - needed for NCAAF schedules/scores fallback")
  }

  return {
    missingEnv,
    providerAvailable: hasCfbd,
  }
}

function checkNcaafProviderEnv(): { missingEnv: string[]; providerAvailable: boolean } {
  const missingEnv: string[] = []
  const hasCfbd =
    Boolean(process.env.CFBD_API_KEY?.trim()) ||
    Boolean(process.env.CFBD_KEY?.trim()) ||
    Boolean(process.env.COLLEGE_FOOTBALL_DATA_API_KEY?.trim())
  const hasApiSports =
    Boolean(process.env.APISPORTS_API_KEY?.trim()) ||
    Boolean(process.env.APISPORTS_KEY?.trim()) ||
    Boolean(process.env.API_SPORTS_KEY?.trim()) ||
    Boolean(process.env.SPORTS_API_KEY?.trim())

  if (!hasCfbd) {
    missingEnv.push("CFBD_API_KEY or CFBD_KEY or COLLEGE_FOOTBALL_DATA_API_KEY (CollegeFootballData) - required for NCAAF player data")
  }
  if (!hasApiSports) {
    missingEnv.push("APISPORTS_API_KEY or APISPORTS_KEY or API_SPORTS_KEY or SPORTS_API_KEY - needed for NCAAF schedules/scores/injuries fallback")
  }

  return {
    missingEnv,
    providerAvailable: hasCfbd || hasApiSports,
  }
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
        jobName: "import-ncaaf-fantasy-data",
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

export async function importNcaafFantasyData(options?: {
  season?: number
  dryRun?: boolean
  mode?: NcaafImportMode
}): Promise<FantasyImportSummary> {
  const startedAt = new Date()
  const season = options?.season ?? currentSeason()
  const dryRun = options?.dryRun ?? false
  const { missingEnv, providerAvailable } = checkNcaafProviderEnv()

  // If CFBD is missing, return a structured "provider unavailable" result.
  // This is the correct behavior for devy/C2C beta state; no hallucinated data.
  if (!providerAvailable) {
    return {
      ok: false,
      sport: "NCAAF",
      provider: "none",
      season,
      counts: {
        players: 0,
        adp: 0,
        injuries: 0,
        schedules: 0,
        teams: 0,
        scores: 0,
        standings: 0,
        news: 0,
        playerHeadshots: 0,
        teamLogos: 0,
        depthCharts: 0,
        projections: 0,
        fantasyValues: 0,
        seasonStats: 0,
        gameLogs: 0,
        weather: 0,
        idpStats: 0,
      },
      skipped: 0,
      missingEnv,
      stale: true,
      warnings: [
        "NCAAF provider key (CFBD_API_KEY) is not configured. " +
          "NCAAF devy/C2C data is in beta - no player data is available until the provider is connected.",
        "Devy and C2C leagues will show 'player pool pending' state. This is expected.",
      ],
      errors: [],
      durationMs: 0,
      startedAt: startedAt.toISOString(),
      completedAt: startedAt.toISOString(),
      dryRun,
    }
  }

  const errors: string[] = []
  const warnings = missingEnv.map((k) => `Missing env: ${k}`)
  let playersImported = 0
  let injuriesImported = 0
  let schedulesImported = 0
  let teamsImported = 0
  let scoresImported = 0
  let standingsImported = 0
  let newsImported = 0
  let playerHeadshotsImported = 0
  let teamLogosImported = 0
  let projectionsImported = 0
  let fantasyValuesImported = 0
  let skipped = 0

  try {
    if (!dryRun) {
      const result = await runSportsDataImporter({ sports: ["NCAAF"] })
      playersImported = result.imported
      if (result.staleFallbackApplied) {
        warnings.push("NCAAF player import used stale fallback.")
      }
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`NCAAF player import failed: ${msg.slice(0, 200)}`)
  }

  try {
    if (!dryRun) {
      const result = await runScheduleImporter({
        sports: ["NCAAF"],
        season,
      })
      schedulesImported = result.imported
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`NCAAF schedule import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    if (!dryRun) {
      const result = await runInjuryImporter({ sports: ["NCAAF"] })
      injuriesImported = result.imported
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`NCAAF injury import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    if (!dryRun) {
      const result = await runNewsImporter({ sports: ["NCAAF"] })
      newsImported += result.imported
    } else {
      skipped += 1
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`NCAAF news import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    if (!dryRun) {
      const result = await importProviderDomainData({
        sport: "NCAAF",
        season,
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
    warnings.push(`NCAAF provider domain import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  const completedAt = new Date()
  const totalWritten =
    playersImported +
    schedulesImported +
    injuriesImported +
    teamsImported +
    scoresImported +
    standingsImported +
    newsImported +
    playerHeadshotsImported +
    teamLogosImported +
    projectionsImported +
    fantasyValuesImported

  if (!dryRun) {
    await recordImportRun({
      sport: "NCAAF",
      rowsWritten: totalWritten,
      // `success`, not `completed` — one vocabulary for sync_job_runs.status. This writer is
      // currently dormant (zero rows in production), so it is switched now precisely because it
      // would otherwise re-open the split the moment it first runs.
      status: errors.length > 0 ? "partial" : "success",
      errorMessage: errors.length > 0 ? errors[0] : null,
    })
  }

  return {
    ok: errors.length === 0,
    sport: "NCAAF",
    provider: "cfbd+api_sports",
    season,
    counts: {
      players: playersImported,
      adp: 0,
      injuries: injuriesImported,
      schedules: schedulesImported,
      teams: teamsImported,
      scores: scoresImported,
      standings: standingsImported,
      news: newsImported,
      playerHeadshots: playerHeadshotsImported,
      teamLogos: teamLogosImported,
      depthCharts: 0,
      projections: projectionsImported,
      fantasyValues: fantasyValuesImported,
      seasonStats: 0,
      gameLogs: 0,
      weather: 0,
      idpStats: 0,
    },
    skipped,
    missingEnv,
    stale: false,
    warnings,
    errors,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    dryRun,
  }
}
