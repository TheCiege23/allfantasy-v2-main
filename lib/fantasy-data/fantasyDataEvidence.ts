/**
 * Fantasy data evidence snapshot — reads DB counts/timestamps to tell AI and UI
 * what data is currently available, how fresh it is, and which providers supplied it.
 * Never throws — returns structured "unavailable" on any error.
 */
import "server-only"
import { prisma } from "@/lib/prisma"

export type FantasyEvidenceDomainSnapshot = {
  count: number
  lastImportedAt: string | null
  provider: string | null
}

export type FantasyDataEvidenceSnapshot = {
  sport: string
  season: number
  builtAt: string

  players: {
    count: number
    lastImportedAt: string | null
    provider: string | null
  }
  adp: {
    count: number
    lastImportedAt: string | null
    provider: string | null
    formats: string[]
  }
  injuries: {
    count: number
    lastImportedAt: string | null
    provider: string | null
  }
  schedules: {
    count: number
    lastImportedAt: string | null
    provider: string | null
  }
  teams: FantasyEvidenceDomainSnapshot
  scores: FantasyEvidenceDomainSnapshot
  standings: FantasyEvidenceDomainSnapshot
  news: FantasyEvidenceDomainSnapshot
  weather: FantasyEvidenceDomainSnapshot
  projections: FantasyEvidenceDomainSnapshot
  fantasyValues: FantasyEvidenceDomainSnapshot
  depthCharts: FantasyEvidenceDomainSnapshot
  seasonStats: FantasyEvidenceDomainSnapshot
  gameLogs: FantasyEvidenceDomainSnapshot
  idpStats: FantasyEvidenceDomainSnapshot
  lastFullSyncAt: string | null
  lastImportRun: {
    jobName: string
    status: string
    completedAt: string | null
    rowsWritten: number
  } | null

  dataAvailability: "full" | "partial" | "adp_only" | "pending" | "unavailable"
  missingEnv: string[]
  warnings: string[]
}

function currentSeason(): number {
  return new Date().getFullYear()
}

function toIso(d: Date | null | undefined): string | null {
  return d instanceof Date ? d.toISOString() : null
}

function resolveSportFilter(sport: string): { sport: string; sportLower: string } {
  const upper = sport.toUpperCase()
  return { sport: upper, sportLower: upper.toLowerCase() }
}

async function getPlayerEvidence(sport: string, season: number) {
  try {
    const count = await (prisma as any).sportsPlayerRecord.count({
      where: { sport },
    }).catch(() => 0)
    const latest = await (prisma as any).sportsPlayerRecord.findFirst({
      where: { sport },
      orderBy: { lastUpdated: "desc" },
      select: { lastUpdated: true, dataSource: true },
    }).catch(() => null)
    return {
      count: Number(count),
      lastImportedAt: toIso(latest?.lastUpdated),
      provider: typeof latest?.dataSource === "string" ? latest.dataSource : null,
    }
  } catch {
    return { count: 0, lastImportedAt: null, provider: null }
  }
}

async function getAdpEvidence(sport: string) {
  try {
    const count = await (prisma as any).adpDataRecord.count({
      where: { sport },
    }).catch(() => 0)
    const latest = await (prisma as any).adpDataRecord.findFirst({
      where: { sport },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, source: true, format: true },
    }).catch(() => null)
    const formats = await (prisma as any).adpDataRecord.findMany({
      where: { sport },
      select: { format: true },
      distinct: ["format"],
      take: 10,
    }).catch(() => []) as Array<{ format: string }>
    return {
      count: Number(count),
      lastImportedAt: toIso(latest?.createdAt),
      provider: typeof latest?.source === "string" ? latest.source : null,
      formats: formats.map((f) => f.format).filter(Boolean),
    }
  } catch {
    return { count: 0, lastImportedAt: null, provider: null, formats: [] }
  }
}

async function getInjuryEvidence(sport: string) {
  /*
   * ⚠ THIS COUNT INCLUDES ROWS THAT IDENTIFY NOBODY. A healthy number here
   * is not evidence of a healthy injury feed, and for two sports it is evidence
   * of the opposite.
   *
   * `injury_reports.playerId` carries TWO placeholder conventions when a
   * provider supplies no id: `''` alongside playerName 'Unknown Player', and
   * `'unk:…'` alongside playerName 'Unknown'. A predicate that catches only
   * the blank one undercounts by the second — that is how two measurements of
   * this table on the same day disagreed by 56 rows.
   *
   * Measured on production 2026-08-27, predicate
   *   playerId = '' OR playerId LIKE 'unk:%'   (equivalently playerName ILIKE '%unknown%')
   *
   *   total 1,358 · no usable identity 1,047 (77%)
   *   blank id by sport: NBA 273/273 · MLB 244/244 · NHL 250/251 · NFL 224/573
   *
   * So NBA and MLB report as healthy here while being 100% unidentifiable: the
   * upstream feeds send no ids for those sports at all. Resolving through
   * PlayerIdentityMap does not rescue them either — it covers 19.8% of NFL and
   * 0% of NBA, NHL and MLB.
   *
   * The blank id also sits INSIDE the table's unique key
   * (sport, playerId, reportDate, status), so those rows overwrite one another
   * on upsert. The count therefore understates how many reports arrived while
   * overstating how many are usable.
   *
   * If this number ever drops sharply for a sport, check whether ids started
   * being required before treating it as an outage — refusing id-less rows was
   * implemented and then deliberately reverted (branch
   * injury-importer-require-player-id). This note describes the DATA, and stays
   * true whichever way that decision goes.
   */
  try {
    const count = await (prisma as any).injuryReportRecord.count({
      where: { sport },
    }).catch(() => 0)
    const latest = await (prisma as any).injuryReportRecord.findFirst({
      where: { sport },
      orderBy: { reportDate: "desc" },
      select: { reportDate: true },
    }).catch(() => null)
    return {
      count: Number(count),
      lastImportedAt: toIso(latest?.reportDate),
      provider: "api_sports",
    }
  } catch {
    return { count: 0, lastImportedAt: null, provider: null }
  }
}

async function getScheduleEvidence(sport: string, season: number) {
  try {
    const count = await (prisma as any).sportsGame.count({
      where: { sport, season },
    }).catch(() => 0)
    const latest = await (prisma as any).sportsGame.findFirst({
      where: { sport, season },
      orderBy: { fetchedAt: "desc" },
      select: { fetchedAt: true, source: true },
    }).catch(() => null)
    return {
      count: Number(count),
      lastImportedAt: toIso(latest?.fetchedAt),
      provider: typeof latest?.source === "string" ? latest.source : null,
    }
  } catch {
    return { count: 0, lastImportedAt: null, provider: null }
  }
}

type EvidenceMetric = {
  model: string
  where?: Record<string, unknown>
  dateField: string
  providerField?: string
  staticProvider?: string
}

function getPrismaModel(name: string): any | null {
  const model = (prisma as any)[name]
  return model && typeof model === "object" ? model : null
}

async function getDomainEvidence(metrics: EvidenceMetric[]): Promise<FantasyEvidenceDomainSnapshot> {
  let count = 0
  let latestDate: string | null = null
  let provider: string | null = null

  for (const metric of metrics) {
    const model = getPrismaModel(metric.model)
    if (!model) continue

    try {
      const metricCount = typeof model.count === "function"
        ? Number(await model.count({ where: metric.where ?? {} }).catch(() => 0))
        : 0
      count += metricCount

      if (typeof model.findFirst !== "function") continue
      const select: Record<string, boolean> = { [metric.dateField]: true }
      if (metric.providerField) select[metric.providerField] = true
      const latest = await model.findFirst({
        where: metric.where ?? {},
        orderBy: { [metric.dateField]: "desc" },
        select,
      }).catch(() => null)

      const iso = toIso(latest?.[metric.dateField])
      if (iso && (!latestDate || Date.parse(iso) > Date.parse(latestDate))) {
        latestDate = iso
        provider = metric.staticProvider ??
          (metric.providerField && typeof latest?.[metric.providerField] === "string"
            ? latest[metric.providerField]
            : provider)
      }
    } catch {
      // keep evidence resilient; one missing model/column should not hide other domains
    }
  }

  return {
    count,
    lastImportedAt: latestDate,
    provider,
  }
}

function getExtendedEvidenceLoaders(sport: string, season: number) {
  const seasonString = String(season)
  const sportLower = sport.toLowerCase()
  const standingsCacheWhere = {
    OR: [
      { cacheKey: { startsWith: `${sport}:standings:` } },
      { cacheKey: { startsWith: `${sportLower}:standings:` } },
    ],
  }
  return {
    teams: getDomainEvidence([
      { model: "sportsTeam", where: { sport }, dateField: "fetchedAt", providerField: "source" },
      { model: "teamAsset", where: { sport }, dateField: "lastUpdated", providerField: "logoSource" },
    ]),
    scores: getDomainEvidence([
      {
        model: "sportsGame",
        where: {
          sport,
          season,
          OR: [
            { homeScore: { not: null } },
            { awayScore: { not: null } },
            { status: { in: ["live", "Live", "in_progress", "final", "Final", "completed", "Completed"] } },
          ],
        },
        dateField: "fetchedAt",
        providerField: "source",
      },
      {
        model: "gameSchedule",
        where: {
          sportType: sport,
          season,
          OR: [
            { homeScore: { not: null } },
            { awayScore: { not: null } },
            { status: { in: ["live", "Live", "in_progress", "final", "Final", "completed", "Completed"] } },
          ],
        },
        dateField: "updatedAt",
        staticProvider: "game_schedule",
      },
    ]),
    standings: getDomainEvidence([
      {
        model: "sportsDataCache",
        where: standingsCacheWhere,
        dateField: "createdAt",
        staticProvider: "sports_data_cache",
      },
    ]),
    news: getDomainEvidence([
      { model: "playerNewsRecord", where: { sport }, dateField: "publishedAt", providerField: "source" },
      { model: "sportsNews", where: { sport }, dateField: "publishedAt", providerField: "source" },
    ]),
    weather: getDomainEvidence([
      { model: "weatherCache", where: { sport }, dateField: "fetchedAt", providerField: "dataSource" },
      { model: "gameSchedule", where: { sportType: sport, season, weather: { not: null } }, dateField: "updatedAt", staticProvider: "game_schedule" },
    ]),
    projections: getDomainEvidence([
      { model: "fantasyProjection", where: { sport, season: seasonString }, dateField: "fetchedAt", providerField: "source" },
      { model: "aFProjectionSnapshot", where: { sport, season }, dateField: "computedAt", staticProvider: "allfantasy" },
    ]),
    fantasyValues: getDomainEvidence([
      { model: "sportsPlayerRecord", where: { sport, OR: [{ dynastyValue: { not: null } }, { adp: { not: null } }] }, dateField: "lastUpdated", providerField: "dataSource" },
      { model: "adpDataRecord", where: { sport, season }, dateField: "createdAt", providerField: "source" },
    ]),
    depthCharts: getDomainEvidence([
      { model: "depthChart", where: { sport, season: seasonString }, dateField: "fetchedAt", providerField: "source" },
    ]),
    seasonStats: getDomainEvidence([
      { model: "playerSeasonStats", where: { sport, season: seasonString }, dateField: "fetchedAt", providerField: "source" },
      { model: "teamSeasonStats", where: { sport, season: seasonString }, dateField: "fetchedAt", providerField: "source" },
    ]),
    gameLogs: getDomainEvidence([
      { model: "playerGameLogCache", where: { sport, season: seasonString }, dateField: "syncedAt", staticProvider: "player_game_log_cache" },
      { model: "playerGameStat", where: { sportType: sport, season }, dateField: "updatedAt", staticProvider: "player_game_stats" },
    ]),
    idpStats: getDomainEvidence([
      { model: "playerSeasonStats", where: { sport, season: seasonString, position: { in: ["DL", "DE", "DT", "LB", "CB", "S", "DB", "IDP"] } }, dateField: "fetchedAt", providerField: "source" },
      { model: "playerGameStat", where: { sportType: sport, season }, dateField: "updatedAt", staticProvider: "player_game_stats" },
    ]),
  }
}

async function getLastImportRun(sport: string) {
  try {
    const run = await (prisma as any).syncJobRun.findFirst({
      where: {
        jobScope: { contains: sport },
        status: { in: ["completed", "failed"] },
      },
      orderBy: { completedAt: "desc" },
      select: { jobName: true, status: true, completedAt: true, rowsWritten: true },
    }).catch(() => null)
    if (!run) return null
    return {
      jobName: String(run.jobName ?? ""),
      status: String(run.status ?? ""),
      completedAt: toIso(run.completedAt),
      rowsWritten: Number(run.rowsWritten ?? 0),
    }
  } catch {
    return null
  }
}

function resolveAvailability(players: { count: number }, adp: { count: number }): FantasyDataEvidenceSnapshot["dataAvailability"] {
  if (players.count > 50 && adp.count > 50) return "full"
  if (players.count > 0 && adp.count > 0) return "partial"
  if (adp.count > 0) return "adp_only"
  if (players.count > 0) return "partial"
  return "unavailable"
}

function checkMissingEnv(sport: string): string[] {
  const missing: string[] = []
  if (!process.env.ROLLING_INSIGHTS_API_KEY && !process.env.ROLLING_INSIGHTS_API_SECRET) {
    missing.push("ROLLING_INSIGHTS_API_KEY")
  }
  if (!process.env.API_SPORTS_KEY && !process.env.X_RAPIDAPI_KEY) {
    missing.push("API_SPORTS_KEY or X_RAPIDAPI_KEY")
  }
  if (sport === "NCAAF") {
    if (!process.env.CFBD_API_KEY && !process.env.COLLEGE_FOOTBALL_DATA_API_KEY) {
      missing.push("CFBD_API_KEY (CollegeFootballData) — NCAAF data limited without it")
    }
  }
  return missing
}

function checkMissingProviderEnv(sport: string): string[] {
  const missing: string[] = []
  const hasRollingInsights =
    Boolean(process.env.ROLLING_INSIGHTS_API_KEY?.trim()) ||
    (Boolean(process.env.ROLLING_INSIGHTS_CLIENT_ID?.trim()) &&
      Boolean(process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim())) ||
    (Boolean(process.env.ROLLING_INSIGHTS_CLIENT_ID2?.trim()) &&
      Boolean(process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim()))
  const hasApiSports = Boolean(process.env.APISPORTS_API_KEY?.trim()) || Boolean(process.env.API_SPORTS_KEY?.trim())
  const hasCfbd = Boolean(process.env.CFBD_API_KEY?.trim()) || Boolean(process.env.CFBD_KEY?.trim())

  if (!hasRollingInsights) {
    missing.push("ROLLING_INSIGHTS_API_KEY or ROLLING_INSIGHTS_CLIENT_ID/ROLLING_INSIGHTS_CLIENT_SECRET")
  }
  if (!hasApiSports) {
    missing.push("APISPORTS_API_KEY or API_SPORTS_KEY")
  }
  if (sport === "NCAAF" && !hasCfbd) {
    missing.push("CFBD_API_KEY or CFBD_KEY (CollegeFootballData) - NCAAF data limited without it")
  }
  return missing
}

export async function loadFantasyDataEvidence(options: {
  sport: string
  season?: number
}): Promise<FantasyDataEvidenceSnapshot> {
  const { sport: rawSport } = options
  const { sport } = resolveSportFilter(rawSport)
  const season = options.season ?? currentSeason()
  const builtAt = new Date().toISOString()

  const extendedLoaders = getExtendedEvidenceLoaders(sport, season)
  const [
    players,
    adp,
    injuries,
    schedules,
    teams,
    scores,
    standings,
    news,
    weather,
    projections,
    fantasyValues,
    depthCharts,
    seasonStats,
    gameLogs,
    idpStats,
    lastRun,
  ] = await Promise.all([
    getPlayerEvidence(sport, season),
    getAdpEvidence(sport),
    getInjuryEvidence(sport),
    getScheduleEvidence(sport, season),
    extendedLoaders.teams,
    extendedLoaders.scores,
    extendedLoaders.standings,
    extendedLoaders.news,
    extendedLoaders.weather,
    extendedLoaders.projections,
    extendedLoaders.fantasyValues,
    extendedLoaders.depthCharts,
    extendedLoaders.seasonStats,
    extendedLoaders.gameLogs,
    extendedLoaders.idpStats,
    getLastImportRun(sport),
  ])

  const allDates = [
    players.lastImportedAt,
    adp.lastImportedAt,
    injuries.lastImportedAt,
    schedules.lastImportedAt,
    teams.lastImportedAt,
    scores.lastImportedAt,
    standings.lastImportedAt,
    news.lastImportedAt,
    weather.lastImportedAt,
    projections.lastImportedAt,
    fantasyValues.lastImportedAt,
    depthCharts.lastImportedAt,
    seasonStats.lastImportedAt,
    gameLogs.lastImportedAt,
    idpStats.lastImportedAt,
  ].filter((d): d is string => d !== null)

  const lastFullSyncAt = allDates.length > 0
    ? allDates.sort().at(-1) ?? null
    : null

  const dataAvailability = resolveAvailability(players, adp)
  const missingEnv = checkMissingProviderEnv(sport)
  const warnings: string[] = []
  if (missingEnv.length > 0) {
    warnings.push(`Missing provider keys — data may be stale or unavailable: ${missingEnv.join(", ")}`)
  }
  if (dataAvailability === "unavailable") {
    warnings.push(`No player or ADP data found for ${sport} ${season}. Trigger an import to populate.`)
  }

  return {
    sport,
    season,
    builtAt,
    players,
    adp,
    injuries,
    schedules,
    teams,
    scores,
    standings,
    news,
    weather,
    projections,
    fantasyValues,
    depthCharts,
    seasonStats,
    gameLogs,
    idpStats,
    lastFullSyncAt,
    lastImportRun: lastRun,
    dataAvailability,
    missingEnv,
    warnings,
  }
}
