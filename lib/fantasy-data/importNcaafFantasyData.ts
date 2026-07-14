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
import type { FantasyImportSummary, ImportStageSummary } from "./importNflFantasyData"
import { importProviderDomainData } from "./importProviderDomainData"

export type NcaafImportMode = "redraft" | "devy" | "c2c" | "all"

type ImportOptions = {
  season?: number
  dryRun?: boolean
  mode?: NcaafImportMode
  historyStart?: number
  historyEnd?: number
  projectionSeason?: number
  limit?: number
  verbose?: boolean
  providers?: string[]
  skipProviders?: string[]
}

type ProviderAvailability = {
  cfbd: boolean
  apiSports: boolean
  theSportsDb: boolean
  clearSports: boolean
}

function currentSeason(): number {
  return new Date().getFullYear()
}

function emptyCounts(): FantasyImportSummary["counts"] {
  return {
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
  }
}

function normalizeProviderToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_")
}

function isProviderEnabled(options: ImportOptions | undefined, provider: string): boolean {
  const token = normalizeProviderToken(provider)
  const only = (options?.providers ?? []).map(normalizeProviderToken).filter(Boolean)
  const skip = (options?.skipProviders ?? []).map(normalizeProviderToken).filter(Boolean)
  if (only.length > 0 && !only.includes(token)) return false
  return !skip.includes(token)
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

function resolveNcaafProviderAvailability(): ProviderAvailability {
  return {
    cfbd:
      Boolean(process.env.CFBD_API_KEY?.trim()) ||
      Boolean(process.env.CFBD_KEY?.trim()) ||
      Boolean(process.env.COLLEGE_FOOTBALL_DATA_API_KEY?.trim()),
    apiSports:
      Boolean(process.env.APISPORTS_API_KEY?.trim()) ||
      Boolean(process.env.APISPORTS_KEY?.trim()) ||
      Boolean(process.env.API_SPORTS_KEY?.trim()) ||
      Boolean(process.env.SPORTS_API_KEY?.trim()),
    theSportsDb:
      Boolean(process.env.THESPORTSDB_API_KEY?.trim()) ||
      Boolean(process.env.SPORTSDB_API_KEY?.trim()) ||
      Boolean(process.env.THE_SPORTS_DB_API_KEY?.trim()),
    clearSports:
      Boolean(process.env.CLEARSPORTS_API_KEY?.trim()) ||
      Boolean(process.env.CLEARSPORTS_KEY?.trim()) ||
      Boolean(process.env.CLEAR_SPORTS_API_KEY?.trim()),
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

async function safeCount(modelName: string, where: Record<string, unknown>): Promise<number> {
  try {
    const model = (prisma as any)[modelName]
    if (!model?.count) return 0
    return Number(await model.count({ where }).catch(() => 0))
  } catch {
    return 0
  }
}

function stageFromDbCount(input: {
  stage: string
  provider: string
  rowsRead: number
  warnings?: string[]
  errors?: string[]
  details?: Record<string, unknown>
}): ImportStageSummary {
  return {
    stage: input.stage,
    provider: input.provider,
    ok: (input.errors?.length ?? 0) === 0,
    dryRun: true,
    rowsRead: input.rowsRead,
    rowsWouldWrite: 0,
    rowsWritten: 0,
    rowsSkipped: 0,
    durationMs: 0,
    warnings: input.warnings ?? [],
    errors: input.errors ?? [],
    details: input.details,
  }
}

async function buildNcaafDryRunSummary(options: ImportOptions): Promise<{
  counts: FantasyImportSummary["counts"]
  warnings: string[]
  errors: string[]
  stages: ImportStageSummary[]
}> {
  const season = options.season ?? currentSeason()
  const historyStart = options.historyStart ?? season
  const historyEnd = Math.max(historyStart, options.historyEnd ?? season)
  const projectionSeason = options.projectionSeason ?? season
  const historyYears = Array.from(
    { length: Math.max(0, historyEnd - historyStart + 1) },
    (_, index) => String(historyStart + index),
  )
  const providers = resolveNcaafProviderAvailability()
  const warnings: string[] = []
  const errors: string[] = []

  const [
    sportsPlayerCount,
    sportsPlayerRecordCount,
    sportsPlayerImageCount,
    sportsPlayerRecordHeadshotCount,
    sportsTeamCount,
    teamAssetCount,
    sportsTeamLogoCount,
    teamAssetLogoCount,
    sportsGameCount,
    gameScheduleCount,
    scoredSportsGameCount,
    scoredGameScheduleCount,
    injuryReportCount,
    sportsInjuryCount,
    sportsNewsCount,
    playerNewsRecordCount,
    standingsCacheCount,
    fantasyProjectionCount,
    afProjectionSnapshotCount,
    fantasyValueCount,
    playerSeasonStatsCount,
    teamSeasonStatsCount,
  ] = await Promise.all([
    safeCount("sportsPlayer", { sport: "NCAAF" }),
    safeCount("sportsPlayerRecord", { sport: "NCAAF" }),
    safeCount("sportsPlayer", { sport: "NCAAF", imageUrl: { not: null } }),
    safeCount("sportsPlayerRecord", {
      sport: "NCAAF",
      OR: [{ headshotUrl: { not: null } }, { headshotUrlSm: { not: null } }, { headshotUrlLg: { not: null } }],
    }),
    safeCount("sportsTeam", { sport: "NCAAF" }),
    safeCount("teamAsset", { sport: "NCAAF" }),
    safeCount("sportsTeam", { sport: "NCAAF", logo: { not: null } }),
    safeCount("teamAsset", {
      sport: "NCAAF",
      OR: [{ logoUrl: { not: null } }, { logoUrlSm: { not: null } }, { logoUrlLg: { not: null } }],
    }),
    safeCount("sportsGame", { sport: "NCAAF", season }),
    safeCount("gameSchedule", { sportType: "NCAAF", season }),
    safeCount("sportsGame", {
      sport: "NCAAF",
      season,
      OR: [
        { homeScore: { not: null } },
        { awayScore: { not: null } },
        { status: { in: ["live", "Live", "in_progress", "final", "Final", "completed", "Completed"] } },
      ],
    }),
    safeCount("gameSchedule", {
      sportType: "NCAAF",
      season,
      OR: [
        { homeScore: { not: null } },
        { awayScore: { not: null } },
        { status: { in: ["live", "Live", "in_progress", "final", "Final", "completed", "Completed"] } },
      ],
    }),
    safeCount("injuryReportRecord", { sport: "NCAAF" }),
    safeCount("sportsInjury", { sport: "NCAAF" }),
    safeCount("sportsNews", { sport: "NCAAF" }),
    safeCount("playerNewsRecord", { sport: "NCAAF" }),
    safeCount("sportsDataCache", {
      OR: [
        { cacheKey: { startsWith: "NCAAF:standings:" } },
        { cacheKey: { startsWith: "ncaaf:standings:" } },
      ],
    }),
    safeCount("fantasyProjection", { sport: "NCAAF", season: String(projectionSeason) }),
    safeCount("aFProjectionSnapshot", { sport: "NCAAF", season: projectionSeason }),
    safeCount("sportsPlayerRecord", {
      sport: "NCAAF",
      OR: [{ dynastyValue: { not: null } }, { adp: { not: null } }],
    }),
    safeCount("playerSeasonStats", {
      sport: "NCAAF",
      ...(historyYears.length > 0 ? { season: { in: historyYears } } : {}),
    }),
    safeCount("teamSeasonStats", {
      sport: "NCAAF",
      ...(historyYears.length > 0 ? { season: { in: historyYears } } : {}),
    }),
  ])

  const counts = emptyCounts()
  counts.players = Math.max(sportsPlayerCount, sportsPlayerRecordCount)
  counts.injuries = Math.max(injuryReportCount, sportsInjuryCount)
  counts.schedules = Math.max(sportsGameCount, gameScheduleCount)
  counts.teams = Math.max(sportsTeamCount, teamAssetCount)
  counts.scores = Math.max(scoredSportsGameCount, scoredGameScheduleCount)
  counts.standings = standingsCacheCount
  counts.news = Math.max(sportsNewsCount, playerNewsRecordCount)
  counts.playerHeadshots = Math.max(sportsPlayerImageCount, sportsPlayerRecordHeadshotCount)
  counts.teamLogos = Math.max(sportsTeamLogoCount, teamAssetLogoCount)
  counts.projections = Math.max(fantasyProjectionCount, afProjectionSnapshotCount)
  counts.fantasyValues = fantasyValueCount
  counts.seasonStats = playerSeasonStatsCount + teamSeasonStatsCount

  if (!providers.cfbd && isProviderEnabled(options, "cfbd")) {
    warnings.push("CFBD not configured; skipping NCAAF player/season-stat provider probe and reporting DB rows only.")
  }
  if (!providers.apiSports && isProviderEnabled(options, "api_sports")) {
    warnings.push("API-Sports not configured; skipping NCAAF schedule/score/injury provider probe and reporting DB rows only.")
  }
  if (!providers.theSportsDb && !providers.clearSports && (isProviderEnabled(options, "thesportsdb") || isProviderEnabled(options, "clearsports"))) {
    warnings.push("TheSportsDB/ClearSports media providers are not configured; NCAAF headshot/logo availability is DB-only in this dry-run.")
  }
  if (counts.players === 0) {
    warnings.push("No NCAAF player rows found. Dry-run is DB-first; provider probe is not implemented, so this reflects persisted availability only.")
  }
  if (counts.playerHeadshots === 0) {
    warnings.push("No NCAAF headshot rows found. Dry-run is DB-first; provider probe is not implemented, so this reflects persisted availability only.")
  }
  if (counts.teamLogos === 0) {
    warnings.push("No NCAAF team logo rows found. Dry-run is DB-first; provider probe is not implemented, so this reflects persisted availability only.")
  }
  if (counts.projections === 0) {
    warnings.push(`No NCAAF projection rows found for season ${projectionSeason}. Dry-run is DB-first; provider probe is not implemented.`)
  }
  if (counts.seasonStats === 0) {
    warnings.push(`No NCAAF season stats found for ${historyStart}-${historyEnd}. Dry-run is DB-first; provider probe is not implemented.`)
  }

  const stages: ImportStageSummary[] = [
    stageFromDbCount({
      stage: "db.players",
      provider: "database",
      rowsRead: counts.players,
      warnings: !providers.cfbd ? ["CFBD not configured; player counts reflect persisted DB rows only."] : [],
      details: { sportsPlayerCount, sportsPlayerRecordCount },
    }),
    stageFromDbCount({
      stage: "db.injuries",
      provider: "database",
      rowsRead: counts.injuries,
      warnings: !providers.apiSports ? ["API-Sports not configured; injury counts reflect persisted DB rows only."] : [],
      details: { injuryReportCount, sportsInjuryCount },
    }),
    stageFromDbCount({
      stage: "db.schedules",
      provider: "database",
      rowsRead: counts.schedules,
      warnings: !providers.apiSports ? ["API-Sports not configured; schedule counts reflect persisted DB rows only."] : [],
      details: { sportsGameCount, gameScheduleCount, season },
    }),
    stageFromDbCount({
      stage: "db.teams",
      provider: "database",
      rowsRead: counts.teams,
      details: { sportsTeamCount, teamAssetCount },
    }),
    stageFromDbCount({
      stage: "db.player_headshots",
      provider: "database",
      rowsRead: counts.playerHeadshots,
      warnings: [
        ...(!providers.theSportsDb && !providers.clearSports ? ["No dedicated media provider configured; headshot counts reflect persisted DB rows only."] : []),
        ...(counts.playerHeadshots === 0 ? ["No NCAAF headshot rows found in the database."] : []),
      ],
      details: { sportsPlayerImageCount, sportsPlayerRecordHeadshotCount },
    }),
    stageFromDbCount({
      stage: "db.team_logos",
      provider: "database",
      rowsRead: counts.teamLogos,
      warnings: [
        ...(!providers.theSportsDb && !providers.clearSports ? ["No dedicated media provider configured; logo counts reflect persisted DB rows only."] : []),
        ...(counts.teamLogos === 0 ? ["No NCAAF team logo rows found in the database."] : []),
      ],
      details: { sportsTeamLogoCount, teamAssetLogoCount },
    }),
    stageFromDbCount({
      stage: "db.projections",
      provider: "database",
      rowsRead: counts.projections,
      warnings: counts.projections === 0 ? [`No NCAAF projection rows found for season ${projectionSeason}.`] : [],
      details: { fantasyProjectionCount, afProjectionSnapshotCount, projectionSeason },
    }),
    stageFromDbCount({
      stage: "db.season_stats",
      provider: "database",
      rowsRead: counts.seasonStats,
      warnings: counts.seasonStats === 0 ? [`No NCAAF season stats found for ${historyStart}-${historyEnd}.`] : [],
      details: { playerSeasonStatsCount, teamSeasonStatsCount, historyStart, historyEnd },
    }),
  ]

  return {
    counts,
    warnings,
    errors,
    stages,
  }
}

export async function importNcaafFantasyData(options?: ImportOptions): Promise<FantasyImportSummary> {
  const startedAt = new Date()
  const season = options?.season ?? currentSeason()
  const dryRun = options?.dryRun ?? false
  const { missingEnv, providerAvailable } = checkNcaafProviderEnv()
  const warnings = missingEnv.map((k) => `Missing env: ${k}`)
  const errors: string[] = []

  if (dryRun) {
    const dryRunSummary = await buildNcaafDryRunSummary(options ?? {})
    warnings.push(...dryRunSummary.warnings)
    errors.push(...dryRunSummary.errors)
    const completedAt = new Date()
    return {
      ok: errors.length === 0,
      sport: "NCAAF",
      provider: "db_first",
      season,
      counts: dryRunSummary.counts,
      skipped: 0,
      missingEnv,
      stale: missingEnv.length > 0 || Object.values(dryRunSummary.counts).every((value) => value === 0),
      warnings,
      errors,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      dryRun: true,
      stages: dryRunSummary.stages,
    }
  }

  if (!providerAvailable) {
    return {
      ok: false,
      sport: "NCAAF",
      provider: "none",
      season,
      counts: emptyCounts(),
      skipped: 0,
      missingEnv,
      stale: true,
      warnings: [
        ...warnings,
        "NCAAF provider keys are not configured. No player data can be imported until CFBD/API-Sports are connected.",
      ],
      errors: [],
      durationMs: 0,
      startedAt: startedAt.toISOString(),
      completedAt: startedAt.toISOString(),
      dryRun: false,
      stages: [],
    }
  }

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
  const stages: ImportStageSummary[] = []

  try {
    const stageStarted = Date.now()
    const result = await runSportsDataImporter({ sports: ["NCAAF"] })
    playersImported = result.imported
    if (result.staleFallbackApplied) {
      warnings.push("NCAAF player import used stale fallback.")
    }
    stages.push({
      stage: "import.players",
      provider: "sports_data_importer",
      ok: true,
      dryRun: false,
      rowsRead: result.imported,
      rowsWouldWrite: result.imported,
      rowsWritten: result.imported,
      rowsSkipped: 0,
      durationMs: Date.now() - stageStarted,
      warnings: result.staleFallbackApplied ? ["Stale fallback applied."] : [],
      errors: [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(`NCAAF player import failed: ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    const result = await runScheduleImporter({
      sports: ["NCAAF"],
      season,
    })
    schedulesImported = result.imported
    stages.push({
      stage: "import.schedules",
      provider: "schedule_importer",
      ok: true,
      dryRun: false,
      rowsRead: result.imported,
      rowsWouldWrite: result.imported,
      rowsWritten: result.imported,
      rowsSkipped: 0,
      durationMs: Date.now() - stageStarted,
      warnings: [],
      errors: [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`NCAAF schedule import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    const result = await runInjuryImporter({ sports: ["NCAAF"] })
    injuriesImported = result.imported
    stages.push({
      stage: "import.injuries",
      provider: "injury_importer",
      ok: true,
      dryRun: false,
      rowsRead: result.imported,
      rowsWouldWrite: result.imported,
      rowsWritten: result.imported,
      rowsSkipped: 0,
      durationMs: Date.now() - stageStarted,
      warnings: [],
      errors: [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`NCAAF injury import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    const result = await runNewsImporter({ sports: ["NCAAF"] })
    newsImported += result.imported
    stages.push({
      stage: "import.news",
      provider: "news_importer",
      ok: true,
      dryRun: false,
      rowsRead: result.imported,
      rowsWouldWrite: result.imported,
      rowsWritten: result.imported,
      rowsSkipped: 0,
      durationMs: Date.now() - stageStarted,
      warnings: [],
      errors: [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`NCAAF news import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
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
    stages.push({
      stage: "import.provider_domains",
      provider: "api_chain",
      ok: result.errors.length === 0,
      dryRun: false,
      rowsRead: result.imported,
      rowsWouldWrite: result.imported,
      rowsWritten: result.imported,
      rowsSkipped: 0,
      durationMs: Date.now() - stageStarted,
      warnings: result.warnings,
      errors: result.errors,
    })
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

  await recordImportRun({
    sport: "NCAAF",
    rowsWritten: totalWritten,
    status: errors.length > 0 ? "partial" : "completed",
    errorMessage: errors.length > 0 ? errors[0] : null,
  })

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
    dryRun: false,
    stages,
  }
}
