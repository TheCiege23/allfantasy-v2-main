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

export type ImportStageSummary = {
  stage: string
  provider: string
  ok: boolean
  dryRun: boolean
  rowsRead: number
  rowsWouldWrite: number
  rowsWritten: number
  rowsSkipped: number
  durationMs: number
  warnings: string[]
  errors: string[]
  details?: Record<string, unknown>
}

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
  stages: ImportStageSummary[]
}

type ImportOptions = {
  season?: number
  dryRun?: boolean
  sports?: string[]
  week?: number
  historyStart?: number
  historyEnd?: number
  projectionSeason?: number
  limit?: number
  verbose?: boolean
  providers?: string[]
  skipProviders?: string[]
}

type ProviderAvailability = {
  rollingInsights: boolean
  apiSports: boolean
  theSportsDb: boolean
  clearSports: boolean
  sleeper: boolean
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

function resolveNflProviderAvailability(): ProviderAvailability {
  return {
    rollingInsights:
      Boolean(process.env.ROLLING_INSIGHTS_API_KEY?.trim()) ||
      Boolean(process.env.ROLLINGINSIGHTS_API_KEY?.trim()) ||
      (Boolean(process.env.ROLLING_INSIGHTS_CLIENT_ID?.trim()) &&
        Boolean(process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim())) ||
      (Boolean(process.env.ROLLING_INSIGHTS_CLIENT_ID2?.trim()) &&
        Boolean(process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim())),
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
    sleeper: true,
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

async function safeCount(modelName: string, where: Record<string, unknown>): Promise<number> {
  try {
    const model = (prisma as any)[modelName]
    if (!model?.count) return 0
    return Number(await model.count({ where }).catch(() => 0))
  } catch {
    return 0
  }
}

async function safeHeadshotSourceBreakdown(sport: string): Promise<Record<string, number>> {
  try {
    const rows = await (prisma as any).sportsPlayer.groupBy({
      by: ["source"],
      where: {
        sport,
        imageUrl: { not: null },
      },
      _count: { source: true },
    }).catch(() => [])
    const breakdown: Record<string, number> = {}
    for (const row of rows as Array<{ source?: string | null; _count?: { source?: number } }>) {
      const key = String(row.source ?? "unknown").trim() || "unknown"
      breakdown[key] = Number(row._count?.source ?? 0)
    }
    return breakdown
  } catch {
    return {}
  }
}

async function safeMissingHeadshotSample(sport: string, take: number): Promise<string[]> {
  try {
    const rows = await prisma.sportsPlayer.findMany({
      where: {
        sport,
        imageUrl: null,
      },
      select: {
        name: true,
        team: true,
        position: true,
      },
      orderBy: { name: "asc" },
      take,
    })
    return rows.map((row) => {
      const team = String(row.team ?? "").trim()
      const position = String(row.position ?? "").trim()
      return [row.name, team ? `(${team})` : "", position ? `- ${position}` : ""].filter(Boolean).join(" ")
    })
  } catch {
    return []
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

async function buildNflDryRunSummary(options: ImportOptions): Promise<{
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
  const providers = resolveNflProviderAvailability()
  const warnings: string[] = []
  const errors: string[] = []

  const [
    sportsPlayerCount,
    sportsPlayerRecordCount,
    sportsPlayerImageCount,
    sportsPlayerRecordHeadshotCount,
    fantasyPlayerHeadshotCount,
    identityMapCoverageCount,
    sportsTeamCount,
    teamAssetCount,
    sportsTeamLogoCount,
    teamAssetLogoCount,
    sportsGameCount,
    gameScheduleCount,
    scoredSportsGameCount,
    scoredGameScheduleCount,
    adpCount,
    injuryReportCount,
    sportsInjuryCount,
    sportsNewsCount,
    playerNewsRecordCount,
    standingsCacheCount,
    depthChartCount,
    fantasyProjectionCount,
    afProjectionSnapshotCount,
    fantasyValueCount,
    playerSeasonStatsCount,
    teamSeasonStatsCount,
  ] = await Promise.all([
    safeCount("sportsPlayer", { sport: "NFL" }),
    safeCount("sportsPlayerRecord", { sport: "NFL" }),
    safeCount("sportsPlayer", { sport: "NFL", imageUrl: { not: null } }),
    safeCount("sportsPlayerRecord", {
      sport: "NFL",
      OR: [{ headshotUrl: { not: null } }, { headshotUrlSm: { not: null } }, { headshotUrlLg: { not: null } }],
    }),
    safeCount("fantasyPlayer", { sport: "NFL", headshotUrl: { not: null } }),
    safeCount("playerIdentityMap", {
      sport: "NFL",
      OR: [
        { rollingInsightsId: { not: null } },
        { apiSportsId: { not: null } },
        { clearSportsId: { not: null } },
        { sleeperId: { not: null } },
      ],
    }),
    safeCount("sportsTeam", { sport: "NFL" }),
    safeCount("teamAsset", { sport: "NFL" }),
    safeCount("sportsTeam", { sport: "NFL", logo: { not: null } }),
    safeCount("teamAsset", {
      sport: "NFL",
      OR: [{ logoUrl: { not: null } }, { logoUrlSm: { not: null } }, { logoUrlLg: { not: null } }],
    }),
    safeCount("sportsGame", { sport: "NFL", season }),
    safeCount("gameSchedule", { sportType: "NFL", season }),
    safeCount("sportsGame", {
      sport: "NFL",
      season,
      OR: [
        { homeScore: { not: null } },
        { awayScore: { not: null } },
        { status: { in: ["live", "Live", "in_progress", "final", "Final", "completed", "Completed"] } },
      ],
    }),
    safeCount("gameSchedule", {
      sportType: "NFL",
      season,
      OR: [
        { homeScore: { not: null } },
        { awayScore: { not: null } },
        { status: { in: ["live", "Live", "in_progress", "final", "Final", "completed", "Completed"] } },
      ],
    }),
    safeCount("adpDataRecord", { sport: "NFL", season }),
    safeCount("injuryReportRecord", { sport: "NFL" }),
    safeCount("sportsInjury", { sport: "NFL" }),
    safeCount("sportsNews", { sport: "NFL" }),
    safeCount("playerNewsRecord", { sport: "NFL" }),
    safeCount("sportsDataCache", {
      OR: [
        { cacheKey: { startsWith: "NFL:standings:" } },
        { cacheKey: { startsWith: "nfl:standings:" } },
      ],
    }),
    safeCount("depthChart", { sport: "NFL", season: String(season) }),
    safeCount("fantasyProjection", { sport: "NFL", season: String(projectionSeason) }),
    safeCount("aFProjectionSnapshot", { sport: "NFL", season: projectionSeason }),
    safeCount("sportsPlayerRecord", {
      sport: "NFL",
      OR: [{ dynastyValue: { not: null } }, { adp: { not: null } }],
    }),
    safeCount("playerSeasonStats", {
      sport: "NFL",
      ...(historyYears.length > 0 ? { season: { in: historyYears } } : {}),
    }),
    safeCount("teamSeasonStats", {
      sport: "NFL",
      ...(historyYears.length > 0 ? { season: { in: historyYears } } : {}),
    }),
  ])

  const counts = emptyCounts()
  counts.players = Math.max(sportsPlayerCount, sportsPlayerRecordCount)
  counts.adp = adpCount
  counts.injuries = Math.max(injuryReportCount, sportsInjuryCount)
  counts.schedules = Math.max(sportsGameCount, gameScheduleCount)
  counts.teams = Math.max(sportsTeamCount, teamAssetCount)
  counts.scores = Math.max(scoredSportsGameCount, scoredGameScheduleCount)
  counts.standings = standingsCacheCount
  counts.news = Math.max(sportsNewsCount, playerNewsRecordCount)
  counts.playerHeadshots = Math.max(sportsPlayerImageCount, sportsPlayerRecordHeadshotCount)
  counts.teamLogos = Math.max(sportsTeamLogoCount, teamAssetLogoCount)
  counts.depthCharts = depthChartCount
  counts.projections = Math.max(fantasyProjectionCount, afProjectionSnapshotCount)
  counts.fantasyValues = Math.max(fantasyValueCount, adpCount)
  counts.seasonStats = playerSeasonStatsCount + teamSeasonStatsCount

  if (!providers.rollingInsights && isProviderEnabled(options, "rolling_insights")) {
    warnings.push("Rolling Insights not configured; skipping projections/season stats/depth charts provider probe and reporting DB rows only.")
  }
  if (!providers.apiSports && isProviderEnabled(options, "api_sports")) {
    warnings.push("API-Sports not configured; skipping injury/schedule/standings provider probe and reporting DB rows only.")
  }
  if (!providers.theSportsDb && !providers.clearSports && (isProviderEnabled(options, "thesportsdb") || isProviderEnabled(options, "clearsports"))) {
    warnings.push("TheSportsDB/ClearSports media providers are not configured; headshot/logo availability is DB-only in this dry-run.")
  }
  if (counts.projections === 0) {
    warnings.push(`No NFL projection rows found for season ${projectionSeason}. Provider probe is not implemented in dry-run; reporting DB rows only.`)
  }
  if (counts.seasonStats === 0) {
    warnings.push(`No NFL season stats found for ${historyStart}-${historyEnd}. Provider probe is not implemented in dry-run; reporting DB rows only.`)
  }
  if (counts.schedules === 0) {
    warnings.push(`No NFL schedule rows found for season ${season}. Provider probe is not implemented in dry-run; reporting DB rows only.`)
  }
  if (counts.depthCharts === 0) {
    warnings.push(`No NFL depth chart rows found for season ${season}. Provider probe is not implemented in dry-run; reporting DB rows only.`)
  }

  const nflPlayers = counts.players
  const nflPlayersWithHeadshots = counts.playerHeadshots
  const headshotCoveragePct =
    nflPlayers > 0 ? Number(((nflPlayersWithHeadshots / nflPlayers) * 100).toFixed(1)) : 0
  const [missingHeadshotSample, headshotSources] = await Promise.all([
    safeMissingHeadshotSample("NFL", 25),
    safeHeadshotSourceBreakdown("NFL"),
  ])

  const stages: ImportStageSummary[] = [
    stageFromDbCount({
      stage: "db.players",
      provider: "database",
      rowsRead: counts.players,
      warnings: counts.players === 0 ? ["No NFL player rows found in SportsPlayer/SportsPlayerRecord."] : [],
      details: { sportsPlayerCount, sportsPlayerRecordCount },
    }),
    stageFromDbCount({
      stage: "db.adp",
      provider: "database",
      rowsRead: counts.adp,
      warnings: counts.adp === 0 ? ["No NFL ADP rows found in AdpDataRecord."] : [],
      details: { season },
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
      warnings: [
        ...(!providers.apiSports ? ["API-Sports not configured; schedule counts reflect persisted DB rows only."] : []),
        ...(counts.schedules === 0 ? [`No NFL schedule rows found for season ${season}.`] : []),
      ],
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
      warnings: !providers.theSportsDb && !providers.clearSports ? ["No dedicated media provider configured; headshot counts reflect persisted DB rows only."] : [],
      details: {
        sportsPlayerImageCount,
        sportsPlayerRecordHeadshotCount,
        fantasyPlayerHeadshotCount,
        identityMapCoverageCount,
        nflPlayers,
        nflPlayersWithHeadshots,
        headshotCoveragePct,
        missingHeadshotSample,
        headshotSources,
      },
    }),
    stageFromDbCount({
      stage: "db.team_logos",
      provider: "database",
      rowsRead: counts.teamLogos,
      warnings: !providers.theSportsDb && !providers.clearSports ? ["No dedicated media provider configured; logo counts reflect persisted DB rows only."] : [],
      details: { sportsTeamLogoCount, teamAssetLogoCount },
    }),
    stageFromDbCount({
      stage: "db.depth_charts",
      provider: "database",
      rowsRead: counts.depthCharts,
      warnings: [
        ...(!providers.rollingInsights ? ["Rolling Insights not configured; depth chart counts reflect persisted DB rows only."] : []),
        ...(counts.depthCharts === 0 ? [`No NFL depth chart rows found for season ${season}.`] : []),
      ],
      details: { season },
    }),
    stageFromDbCount({
      stage: "db.projections",
      provider: "database",
      rowsRead: counts.projections,
      warnings: !providers.rollingInsights ? ["Rolling Insights not configured; projection counts reflect persisted DB rows only."] : [],
      details: { fantasyProjectionCount, afProjectionSnapshotCount, projectionSeason },
    }),
    stageFromDbCount({
      stage: "db.season_stats",
      provider: "database",
      rowsRead: counts.seasonStats,
      warnings: !providers.rollingInsights ? ["Rolling Insights not configured; season stat counts reflect persisted DB rows only."] : [],
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

export async function importNflFantasyData(options?: ImportOptions): Promise<FantasyImportSummary> {
  const startedAt = new Date()
  const season = options?.season ?? currentSeason()
  const dryRun = options?.dryRun ?? false
  const missingEnv = checkNflEnv()
  const warnings: string[] = [...missingEnv.map((k) => `Missing env: ${k}`)]
  const errors: string[] = []
  const stages: ImportStageSummary[] = []

  if (dryRun) {
    const dryRunSummary = await buildNflDryRunSummary(options ?? {})
    warnings.push(...dryRunSummary.warnings)
    errors.push(...dryRunSummary.errors)
    stages.push(...dryRunSummary.stages)
    const completedAt = new Date()
    return {
      ok: errors.length === 0,
      sport: "NFL",
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
      stages,
    }
  }

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
    warnings.push("NFL provider keys are missing - running with cached/fallback data only.")
  }

  try {
    const stageStarted = Date.now()
    const result = await runSportsDataImporter({ sports: ["NFL"] })
    playersImported = result.imported
    if (result.staleFallbackApplied) {
      warnings.push("NFL player import used stale fallback - provider may be unavailable.")
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
    errors.push(`Player import failed: ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    const result = await runAdpImporter({ sports: ["NFL"] })
    adpImported = result.imported
    stages.push({
      stage: "import.adp",
      provider: "adp_importer",
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
    errors.push(`ADP import failed: ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    const result = await runInjuryImporter({
      sports: ["NFL"],
      week: options?.week,
    })
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
    warnings.push(`Injury import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    const result = await runScheduleImporter({
      sports: ["NFL"],
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
    warnings.push(`Schedule import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    const result = await runNewsImporter({ sports: ["NFL"] })
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
    warnings.push(`News import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
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
    warnings.push(`Provider domain import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    depthChartsImported = await syncNFLDepthChartsToDb({ season: String(season) })
    stages.push({
      stage: "import.depth_charts",
      provider: "rolling_insights",
      ok: true,
      dryRun: false,
      rowsRead: depthChartsImported,
      rowsWouldWrite: depthChartsImported,
      rowsWritten: depthChartsImported,
      rowsSkipped: 0,
      durationMs: Date.now() - stageStarted,
      warnings: [],
      errors: [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`Depth chart import failed (non-critical): ${msg.slice(0, 200)}`)
  }

  try {
    const stageStarted = Date.now()
    seasonStatsImported = await syncNFLTeamStatsToDb({ season: String(season) })
    stages.push({
      stage: "import.team_season_stats",
      provider: "rolling_insights",
      ok: true,
      dryRun: false,
      rowsRead: seasonStatsImported,
      rowsWouldWrite: seasonStatsImported,
      rowsWritten: seasonStatsImported,
      rowsSkipped: 0,
      durationMs: Date.now() - stageStarted,
      warnings: [],
      errors: [],
    })
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

  await recordImportRun({
    sport: "NFL",
    rowsWritten: totalWritten,
    status: errors.length > 0 ? "partial" : "completed",
    errorMessage: errors.length > 0 ? errors[0] : null,
  })

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
    dryRun: false,
    stages,
  }
}
