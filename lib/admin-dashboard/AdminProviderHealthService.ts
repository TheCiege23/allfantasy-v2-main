import "server-only"

import { prisma } from "@/lib/prisma"
import {
  getClearSportsConfigFromEnv,
  getOpenAIConfigFromEnv,
  getProviderStartupValidationNotes,
  getRollingInsightsConfigFromEnv,
} from "@/lib/provider-config"
import { getWorldCupProviderOpsStatus } from "@/lib/world-cup/worldCupOperationsReadiness"
import {
  getWorldCupLiveProviderChain,
} from "@/lib/world-cup/live-providers/worldCupLiveProviderRegistry"

export type AdminProviderHealthStatus =
  | "configured"
  | "missing_env"
  | "configured_failing"
  | "scaffold_only"
  | "not_production_ready"
  | "disabled"
  | "public_fallback"
  | "unknown"

export type AdminProviderHealthRow = {
  id: string
  name: string
  category: string
  status: AdminProviderHealthStatus
  configured: boolean
  envVars: string[]
  dataCategories: string[]
  consumedBy: string[]
  storage: string[]
  requestCount24h: number | null
  avgLatencyMs24h: number | null
  rateLimit: string
  importedRows: number | null
  lastSyncAt: string | null
  lastError: string | null
  costProtection: string[]
  note: string
}

export type AdminSportDataReliabilityRow = {
  id: string
  sport: string
  label: string
  counts: {
    teams: number | null
    players: number | null
    schedules: number | null
    games: number | null
    liveScores: number | null
    standings: number | null
    injuries: number | null
    news: number | null
    playerStats: number | null
  }
  lastSyncAtByType: Record<string, string | null>
  staleWarnings: string[]
  configuredProviders: string[]
  missingProviders: string[]
  note: string
}

type ProviderCallSummary = {
  requestCount24h: number
  avgLatencyMs24h: number | null
}

type ProviderSyncSummary = {
  lastSyncAt: string | null
  lastError: string | null
  recordsImported: number
  recordsUpdated: number
  recordsSkipped: number
}

type ProviderRateWindow = {
  callsMade: number
  callsLimit: number
  resetAt: string | null
}

type CountBySource = Record<string, number>

const NOT_TRACKED = "Not tracked yet"

function clean(value?: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function hasAnyEnv(keys: string[]): boolean {
  return keys.some((key) => Boolean(clean(process.env[key])))
}

function hasAllEnv(keys: string[]): boolean {
  return keys.every((key) => Boolean(clean(process.env[key])))
}

function latestIso(values: Array<Date | string | null | undefined>): string | null {
  let latest = 0
  for (const value of values) {
    if (!value) continue
    const stamp = value instanceof Date ? value.getTime() : new Date(value).getTime()
    if (Number.isFinite(stamp) && stamp > latest) latest = stamp
  }
  return latest > 0 ? new Date(latest).toISOString() : null
}

function isOlderThan(value: string | null, hours: number): boolean {
  if (!value) return true
  const stamp = new Date(value).getTime()
  return !Number.isFinite(stamp) || Date.now() - stamp > hours * 60 * 60 * 1000
}

function safeError(value: string | null | undefined): string | null {
  const text = clean(value)
  if (!text) return null
  return text.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 180)
}

function nowMinusHours(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

function keyForProvider(provider: string): string {
  return provider.trim().toLowerCase()
}

function requestAliases(id: string): string[] {
  switch (id) {
    case "api_football_world_cup":
      return ["api_football", "api_sports"]
    case "api_sports":
      return ["api_sports"]
    case "clearsports":
    case "clear_sports":
      return ["clearsports", "clear_sports"]
    default:
      return [id]
  }
}

function lookupCallSummary(
  calls: Record<string, ProviderCallSummary>,
  id: string
): ProviderCallSummary {
  const aliases = requestAliases(id)
  return aliases.reduce(
    (acc, alias) => {
      const row = calls[keyForProvider(alias)]
      if (!row) return acc
      const totalCount = acc.requestCount24h + row.requestCount24h
      const avg =
        acc.avgLatencyMs24h == null
          ? row.avgLatencyMs24h
          : row.avgLatencyMs24h == null
            ? acc.avgLatencyMs24h
            : Math.round((acc.avgLatencyMs24h + row.avgLatencyMs24h) / 2)
      return { requestCount24h: totalCount, avgLatencyMs24h: avg }
    },
    { requestCount24h: 0, avgLatencyMs24h: null } as ProviderCallSummary
  )
}

function lookupRateWindow(
  rates: Record<string, ProviderRateWindow>,
  id: string
): ProviderRateWindow | null {
  const aliases = requestAliases(id)
  let callsMade = 0
  let callsLimit = 0
  let resetAt: string | null = null
  let found = false
  for (const alias of aliases) {
    const row = rates[keyForProvider(alias)]
    if (!row) continue
    found = true
    callsMade += row.callsMade
    callsLimit += row.callsLimit
    resetAt = row.resetAt ?? resetAt
  }
  return found ? { callsMade, callsLimit, resetAt } : null
}

function lookupSync(
  sync: Record<string, ProviderSyncSummary>,
  id: string
): ProviderSyncSummary | null {
  const aliases = requestAliases(id)
  for (const alias of aliases) {
    const row = sync[keyForProvider(alias)]
    if (row) return row
  }
  return null
}

function formatRateLimit(row: ProviderRateWindow | null): string {
  if (!row) return NOT_TRACKED
  if (row.callsLimit <= 0) return `${row.callsMade} calls this window`
  return `${row.callsMade}/${row.callsLimit} calls this window`
}

function statusFromConfig(input: {
  configured: boolean
  scaffold?: boolean
  productionReady?: boolean
  publicFallback?: boolean
  disabled?: boolean
  failing?: boolean
}): AdminProviderHealthStatus {
  if (input.disabled) return "disabled"
  if (input.scaffold) return "scaffold_only"
  if (input.publicFallback) return "public_fallback"
  if (input.failing) return "configured_failing"
  if (input.configured && input.productionReady === false) return "not_production_ready"
  if (input.configured) return "configured"
  return "missing_env"
}

async function groupCountsBySource(modelName: string): Promise<CountBySource> {
  const delegate = (prisma as unknown as Record<string, unknown>)[modelName] as
    | { groupBy: (args: Record<string, unknown>) => Promise<Array<{ source: string | null; _count: { _all: number } }>> }
    | undefined
  if (!delegate?.groupBy) return {}
  try {
    const rows = await delegate.groupBy({
      by: ["source"],
      _count: { _all: true },
    })
    return rows.reduce<CountBySource>((acc, row) => {
      if (row.source) acc[keyForProvider(row.source)] = (acc[keyForProvider(row.source)] ?? 0) + row._count._all
      return acc
    }, {})
  } catch {
    return {}
  }
}

function sumSourceCounts(sources: CountBySource[], aliases: string[]): number {
  return sources.reduce((total, sourceMap) => {
    return total + aliases.reduce((sum, alias) => sum + (sourceMap[keyForProvider(alias)] ?? 0), 0)
  }, 0)
}

async function getCallSummaries(): Promise<Record<string, ProviderCallSummary>> {
  try {
    const rows = await prisma.apiCallLogRecord.groupBy({
      by: ["provider"],
      where: {
        calledAt: { gte: nowMinusHours(24) },
        cached: false,
      },
      _count: { _all: true },
      _avg: { latencyMs: true },
    })
    return rows.reduce<Record<string, ProviderCallSummary>>((acc, row) => {
      acc[keyForProvider(row.provider)] = {
        requestCount24h: row._count._all,
        avgLatencyMs24h:
          row._avg.latencyMs == null ? null : Math.round(row._avg.latencyMs),
      }
      return acc
    }, {})
  } catch {
    return {}
  }
}

async function getRateWindows(): Promise<Record<string, ProviderRateWindow>> {
  try {
    const now = new Date()
    const rows = await prisma.apiRateLimitRecord.findMany({
      where: { windowEnd: { gte: now } },
      select: {
        provider: true,
        callsMade: true,
        callsLimit: true,
        windowEnd: true,
      },
      orderBy: { windowEnd: "desc" },
      take: 100,
    })
    return rows.reduce<Record<string, ProviderRateWindow>>((acc, row) => {
      const key = keyForProvider(row.provider)
      const current = acc[key]
      acc[key] = {
        callsMade: (current?.callsMade ?? 0) + row.callsMade,
        callsLimit: Math.max(current?.callsLimit ?? 0, row.callsLimit),
        resetAt: current?.resetAt ?? row.windowEnd.toISOString(),
      }
      return acc
    }, {})
  } catch {
    return {}
  }
}

async function getSyncSummaries(): Promise<Record<string, ProviderSyncSummary>> {
  try {
    const rows = await prisma.providerSyncState.findMany({
      select: {
        provider: true,
        lastCompletedAt: true,
        lastSuccessAt: true,
        lastErrorAt: true,
        lastError: true,
        recordsImported: true,
        recordsUpdated: true,
        recordsSkipped: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    })
    return rows.reduce<Record<string, ProviderSyncSummary>>((acc, row) => {
      const key = keyForProvider(row.provider)
      if (acc[key]) return acc
      acc[key] = {
        lastSyncAt: (row.lastSuccessAt ?? row.lastCompletedAt ?? row.updatedAt)?.toISOString() ?? null,
        lastError: row.lastErrorAt ? safeError(row.lastError) : null,
        recordsImported: row.recordsImported,
        recordsUpdated: row.recordsUpdated,
        recordsSkipped: row.recordsSkipped,
      }
      return acc
    }, {})
  } catch {
    return {}
  }
}

async function getWorldCupCounts() {
  try {
    const [teams, fixtures, standings, syncLogs] = await Promise.all([
      prisma.worldCupTeam.count(),
      prisma.worldCupOfficialFixture.count(),
      prisma.worldCupOfficialGroupStanding.count(),
      prisma.worldCupSyncLog.count(),
    ])
    return { teams, fixtures, standings, syncLogs }
  } catch {
    return { teams: 0, fixtures: 0, standings: 0, syncLogs: 0 }
  }
}

type CountDelegate = {
  count: (args?: Record<string, unknown>) => Promise<number>
}

type FindFirstDelegate = {
  findFirst: (args?: Record<string, unknown>) => Promise<Record<string, unknown> | null>
}

function modelDelegate<T>(name: string): T | null {
  const delegate = (prisma as unknown as Record<string, unknown>)[name]
  return delegate ? (delegate as T) : null
}

async function safeCount(modelName: string, args?: Record<string, unknown>): Promise<number | null> {
  const delegate = modelDelegate<CountDelegate>(modelName)
  if (!delegate?.count) return null
  try {
    return await delegate.count(args)
  } catch {
    return null
  }
}

async function latestFieldIso(
  modelName: string,
  field: string,
  args?: Record<string, unknown>
): Promise<string | null> {
  const delegate = modelDelegate<FindFirstDelegate>(modelName)
  if (!delegate?.findFirst) return null
  try {
    const row = await delegate.findFirst({
      ...(args ?? {}),
      orderBy: { [field]: "desc" },
      select: { [field]: true },
    })
    return latestIso([row?.[field] as Date | string | null | undefined])
  } catch {
    return null
  }
}

function providerEnvStatus(providerNames: string[]) {
  const configured: string[] = []
  const missing: string[] = []
  for (const provider of providerNames) {
    let isConfigured = false
    if (provider === "API-Football") {
      isConfigured =
        hasAnyEnv(["API_SPORTS_KEY", "API_FOOTBALL_KEY", "APISPORTS_FOOTBALL_KEY", "RAPIDAPI_KEY"]) &&
        hasAnyEnv(["WORLD_CUP_CRON_SECRET"]) &&
        hasAnyEnv(["API_FOOTBALL_WORLD_CUP_LEAGUE_ID"])
    } else if (provider === "API-Sports") {
      isConfigured = hasAnyEnv(["API_SPORTS_KEY", "APISPORTS_API_KEY"])
    } else if (provider === "Rolling Insights") {
      isConfigured = Boolean(getRollingInsightsConfigFromEnv())
    } else if (provider === "ClearSports") {
      isConfigured = Boolean(getClearSportsConfigFromEnv())
    } else if (provider === "TheSportsDB") {
      isConfigured = hasAnyEnv(["THESPORTSDB_API_KEY", "SPORTSDB_API_KEY", "THE_SPORTS_DB_API_KEY"])
    } else if (provider === "CFBD") {
      isConfigured = hasAnyEnv(["CFBD_API_KEY", "CFBD_KEY"])
    } else if (provider === "NewsAPI") {
      isConfigured = hasAnyEnv(["NEWS_API_KEY", "NEWSAPI_KEY"])
    } else if (provider === "OpenAI") {
      isConfigured = Boolean(getOpenAIConfigFromEnv())
    }
    ;(isConfigured ? configured : missing).push(provider)
  }
  return { configured, missing }
}

async function standingsCountForSport(sport: string): Promise<number | null> {
  const lower = sport.toLowerCase()
  return safeCount("sportsDataCache", {
    where: {
      OR: [
        { cacheKey: { contains: `${sport}:standings:` } },
        { cacheKey: { contains: `${lower}:standings:` } },
        { cacheKey: { contains: `${sport}:standings` } },
        { cacheKey: { contains: `${lower}:standings` } },
      ],
    },
  })
}

async function buildGenericSportReliabilityRow(input: {
  id: string
  sport: string
  label: string
  providers: string[]
  note?: string
}): Promise<AdminSportDataReliabilityRow> {
  const sport = input.sport
  const [
    teams,
    players,
    schedules,
    games,
    liveScores,
    standings,
    sportsInjuries,
    injuryReports,
    sportsNews,
    playerNews,
    playerStats,
    playerGameLogs,
    teamsSync,
    playersSync,
    schedulesSync,
    gamesSync,
    injuriesSync,
    injuryReportsSync,
    newsSync,
    playerNewsSync,
    playerStatsSync,
    playerGameLogsSync,
  ] = await Promise.all([
    safeCount("sportsTeam", { where: { sport } }),
    safeCount("sportsPlayer", { where: { sport } }),
    safeCount("gameSchedule", { where: { sportType: sport } }),
    safeCount("sportsGame", { where: { sport } }),
    safeCount("sportsGame", { where: { sport, source: { in: ["rolling_insights", "espn_live"] } } }),
    standingsCountForSport(sport),
    safeCount("sportsInjury", { where: { sport } }),
    safeCount("injuryReportRecord", { where: { sport } }),
    safeCount("sportsNews", { where: { sport } }),
    safeCount("playerNewsRecord", { where: { sport } }),
    safeCount("playerSeasonStats", { where: { sport } }),
    safeCount("playerGameLogCache", { where: { sport } }),
    latestFieldIso("sportsTeam", "fetchedAt", { where: { sport } }),
    latestFieldIso("sportsPlayer", "fetchedAt", { where: { sport } }),
    latestFieldIso("gameSchedule", "updatedAt", { where: { sportType: sport } }),
    latestFieldIso("sportsGame", "fetchedAt", { where: { sport } }),
    latestFieldIso("sportsInjury", "fetchedAt", { where: { sport } }),
    latestFieldIso("injuryReportRecord", "reportDate", { where: { sport } }),
    latestFieldIso("sportsNews", "fetchedAt", { where: { sport } }),
    latestFieldIso("playerNewsRecord", "publishedAt", { where: { sport } }),
    latestFieldIso("playerSeasonStats", "updatedAt", { where: { sport } }),
    latestFieldIso("playerGameLogCache", "syncedAt", { where: { sport } }),
  ])

  const injuryCount = (sportsInjuries ?? 0) + (injuryReports ?? 0)
  const newsCount = (sportsNews ?? 0) + (playerNews ?? 0)
  const playerStatsCount = (playerStats ?? 0) + (playerGameLogs ?? 0)
  const lastSyncAtByType = {
    teams: teamsSync,
    players: playersSync,
    schedules: schedulesSync,
    games: gamesSync,
    injuries: latestIso([injuriesSync, injuryReportsSync]),
    news: latestIso([newsSync, playerNewsSync]),
    playerStats: latestIso([playerStatsSync, playerGameLogsSync]),
  }
  const staleWarnings = [
    teams === 0 ? "No teams imported" : null,
    players === 0 ? "No players imported" : null,
    (schedules ?? 0) + (games ?? 0) === 0 ? "No schedules/games imported" : null,
    injuryCount === 0 ? "No injuries imported" : null,
    newsCount === 0 ? "No news imported" : null,
    isOlderThan(lastSyncAtByType.games, 24) && (games ?? 0) > 0 ? "Games data older than 24h" : null,
    isOlderThan(lastSyncAtByType.news, 24) && newsCount > 0 ? "News data older than 24h" : null,
    isOlderThan(lastSyncAtByType.injuries, 24) && injuryCount > 0 ? "Injury data older than 24h" : null,
  ].filter((item): item is string => Boolean(item))
  const providerStatus = providerEnvStatus(input.providers)

  return {
    id: input.id,
    sport,
    label: input.label,
    counts: {
      teams,
      players,
      schedules,
      games,
      liveScores,
      standings,
      injuries: injuryCount,
      news: newsCount,
      playerStats: playerStatsCount,
    },
    lastSyncAtByType,
    staleWarnings,
    configuredProviders: providerStatus.configured,
    missingProviders: providerStatus.missing,
    note: input.note ?? "Counts are read from stored Neon tables only.",
  }
}

async function buildWorldCupReliabilityRow(): Promise<AdminSportDataReliabilityRow> {
  const [
    teams,
    fixtures,
    standings,
    injuries,
    teamsSync,
    fixturesSync,
    standingsSync,
    injuriesSync,
  ] = await Promise.all([
    safeCount("worldCupTeam"),
    safeCount("worldCupOfficialFixture"),
    safeCount("worldCupOfficialGroupStanding"),
    safeCount("injuryReportRecord", { where: { sport: "WC_SOCCER" } }),
    latestFieldIso("worldCupTeam", "updatedAt"),
    latestFieldIso("worldCupOfficialFixture", "updatedAt"),
    latestFieldIso("worldCupOfficialGroupStanding", "updatedAt"),
    latestFieldIso("injuryReportRecord", "reportDate", { where: { sport: "WC_SOCCER" } }),
  ])
  const providerStatus = providerEnvStatus(["API-Football", "OpenAI"])
  const staleWarnings = [
    teams === 0 ? "No World Cup teams imported" : null,
    fixtures === 0 ? "No World Cup fixtures imported" : null,
    standings === 0 ? "No World Cup standings imported yet" : null,
    isOlderThan(fixturesSync, 24) && (fixtures ?? 0) > 0 ? "Fixtures older than 24h" : null,
    isOlderThan(injuriesSync, 24) && (injuries ?? 0) > 0 ? "Injury data older than 24h" : null,
  ].filter((item): item is string => Boolean(item))

  return {
    id: "world-cup",
    sport: "WC_SOCCER",
    label: "World Cup",
    counts: {
      teams,
      players: null,
      schedules: fixtures,
      games: fixtures,
      liveScores: fixtures,
      standings,
      injuries,
      news: null,
      playerStats: null,
    },
    lastSyncAtByType: {
      teams: teamsSync,
      fixtures: fixturesSync,
      standings: standingsSync,
      injuries: injuriesSync,
    },
    staleWarnings,
    configuredProviders: providerStatus.configured,
    missingProviders: providerStatus.missing,
    note: "World Cup pages use dedicated official fixture/standing tables; generic soccer rows are separate.",
  }
}

export async function getAdminPerSportDataReliabilityRows(): Promise<AdminSportDataReliabilityRow[]> {
  const rows = await Promise.all([
    buildWorldCupReliabilityRow(),
    buildGenericSportReliabilityRow({
      id: "nfl",
      sport: "NFL",
      label: "NFL",
      providers: ["Rolling Insights", "API-Sports", "ClearSports", "TheSportsDB", "NewsAPI", "OpenAI"],
    }),
    buildGenericSportReliabilityRow({
      id: "mlb",
      sport: "MLB",
      label: "MLB",
      providers: ["Rolling Insights", "ClearSports", "TheSportsDB", "NewsAPI", "OpenAI"],
      note: "MLB player/game facts depend on Rolling Insights or ClearSports stat imports.",
    }),
    buildGenericSportReliabilityRow({
      id: "nba",
      sport: "NBA",
      label: "NBA",
      providers: ["Rolling Insights", "ClearSports", "TheSportsDB", "NewsAPI", "OpenAI"],
    }),
    buildGenericSportReliabilityRow({
      id: "nhl",
      sport: "NHL",
      label: "NHL",
      providers: ["Rolling Insights", "ClearSports", "TheSportsDB", "NewsAPI", "OpenAI"],
    }),
    buildGenericSportReliabilityRow({
      id: "ncaaf",
      sport: "NCAAF",
      label: "NCAAF",
      providers: ["Rolling Insights", "API-Sports", "CFBD", "ClearSports", "NewsAPI", "OpenAI"],
      note: "CFBD covers teams/schedules; injuries/player stats require another configured provider.",
    }),
    buildGenericSportReliabilityRow({
      id: "ncaab",
      sport: "NCAAB",
      label: "NCAAB",
      providers: ["Rolling Insights", "ClearSports", "TheSportsDB", "NewsAPI", "OpenAI"],
      note: "NCAAB is partial unless Rolling Insights or ClearSports returns player/injury/stat rows.",
    }),
    buildGenericSportReliabilityRow({
      id: "soccer",
      sport: "SOCCER",
      label: "Soccer",
      providers: ["Rolling Insights", "ClearSports", "TheSportsDB", "NewsAPI", "OpenAI"],
      note: "Generic soccer is separate from dedicated World Cup official tables.",
    }),
  ])
  return rows
}

async function getCacheCounts() {
  try {
    const [
      total,
      apiSports,
      apiFootball,
      clearSports,
      theSportsDb,
      rollingInsights,
      cfbd,
      espn,
      sleeper,
    ] = await Promise.all([
      prisma.sportsDataCache.count(),
      prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: "api_sports:" } } }),
      prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: "api_football:" } } }),
      prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: "clearsports:" } } }),
      prisma.sportsDataCache.count({ where: { cacheKey: { contains: "thesportsdb" } } }),
      prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: "rolling_insights:" } } }),
      prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: "cfbd:" } } }),
      prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: "espn:" } } }),
      prisma.sportsDataCache.count({ where: { cacheKey: { startsWith: "sleeper:" } } }),
    ])
    return {
      total,
      api_sports: apiSports,
      api_football: apiFootball,
      clear_sports: clearSports,
      thesportsdb: theSportsDb,
      rolling_insights: rollingInsights,
      cfbd,
      espn,
      sleeper,
    }
  } catch {
    return {
      total: 0,
      api_sports: 0,
      api_football: 0,
      clear_sports: 0,
      thesportsdb: 0,
      rolling_insights: 0,
      cfbd: 0,
      espn: 0,
      sleeper: 0,
    }
  }
}

function providerRow(
  input: Omit<
    AdminProviderHealthRow,
    "requestCount24h" | "avgLatencyMs24h" | "rateLimit" | "lastSyncAt" | "lastError"
  > & {
    calls: Record<string, ProviderCallSummary>
    rates: Record<string, ProviderRateWindow>
    sync: Record<string, ProviderSyncSummary>
  }
): AdminProviderHealthRow {
  const callSummary = lookupCallSummary(input.calls, input.id)
  const rateWindow = lookupRateWindow(input.rates, input.id)
  const syncSummary = lookupSync(input.sync, input.id)
  return {
    ...input,
    requestCount24h: callSummary.requestCount24h,
    avgLatencyMs24h: callSummary.avgLatencyMs24h,
    rateLimit: formatRateLimit(rateWindow),
    lastSyncAt: syncSummary?.lastSyncAt ?? null,
    lastError: syncSummary?.lastError ?? null,
  }
}

export async function getAdminProviderHealthRows(): Promise<AdminProviderHealthRow[]> {
  const [
    calls,
    rates,
    sync,
    teamCounts,
    playerCounts,
    gameCounts,
    injuryCounts,
    newsCounts,
    cacheCounts,
    worldCupCounts,
  ] = await Promise.all([
    getCallSummaries(),
    getRateWindows(),
    getSyncSummaries(),
    groupCountsBySource("sportsTeam"),
    groupCountsBySource("sportsPlayer"),
    groupCountsBySource("sportsGame"),
    groupCountsBySource("sportsInjury"),
    groupCountsBySource("sportsNews"),
    getCacheCounts(),
    getWorldCupCounts(),
  ])

  const sourceCounts = [teamCounts, playerCounts, gameCounts, injuryCounts, newsCounts]
  const worldCupOps = getWorldCupProviderOpsStatus()
  const apiFootballWorldCupKeyConfigured = hasAnyEnv([
    "API_SPORTS_KEY",
    "API_FOOTBALL_KEY",
    "APISPORTS_FOOTBALL_KEY",
    "RAPIDAPI_KEY",
  ])
  const apiFootballWorldCupProductionReady =
    worldCupOps.name === "apifootball" &&
    apiFootballWorldCupKeyConfigured &&
    worldCupOps.leagueIdConfigured &&
    worldCupOps.cronSecretPresent
  const openaiConfigured = Boolean(getOpenAIConfigFromEnv())
  const clearSportsConfigured = Boolean(getClearSportsConfigFromEnv())
  const rollingInsights = getRollingInsightsConfigFromEnv()
  const rollingInsightsConfigured = Boolean(rollingInsights)
  const liveChain = getWorldCupLiveProviderChain()
  const startupWarnings = getProviderStartupValidationNotes()
  const sportsDataConfigured = hasAnyEnv(["SPORTSDATA_API_KEY"])

  return [
    providerRow({
      id: "api_football_world_cup",
      name: "API-Football / API-Sports World Cup",
      category: "World Cup soccer",
      status: statusFromConfig({
        configured: apiFootballWorldCupKeyConfigured,
        productionReady: apiFootballWorldCupProductionReady,
      }),
      configured: apiFootballWorldCupKeyConfigured,
      envVars: [
        "WORLD_CUP_DATA_PROVIDER",
        "API_SPORTS_KEY or API_FOOTBALL_KEY",
        "API_FOOTBALL_WORLD_CUP_LEAGUE_ID",
        "WORLD_CUP_CRON_SECRET",
      ],
      dataCategories: ["teams", "fixtures", "live scores", "group standings", "injuries", "knockout results"],
      consumedBy: ["World Cup sync cron", "World Cup scoring", "leaderboard", "Chimmy DB context", "injury notifications"],
      storage: [
        "world_cup_teams",
        "world_cup_official_fixtures",
        "world_cup_official_group_standings",
        "injury_reports",
        "platform_notifications",
        "api_call_log_records",
      ],
      importedRows: worldCupCounts.teams + worldCupCounts.fixtures + worldCupCounts.standings,
      costProtection: [
        "server-only provider client",
        "cron/admin sync path",
        "per-endpoint cooldowns",
        "ApiRateLimitRecord hourly/daily budgets",
        "batch live sync fetches once then fans out to pools",
      ],
      note:
        apiFootballWorldCupProductionReady
          ? "Primary World Cup provider is configured for production sync."
          : `Current WORLD_CUP_DATA_PROVIDER is ${worldCupOps.name}; production sync is not using API-Football.`,
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "world_cup_live_chain",
      name: "World Cup live provider chain",
      category: "World Cup live scores",
      status: liveChain.length > 0 ? "configured" : "disabled",
      configured: liveChain.length > 0,
      envVars: ["WORLD_CUP_LIVE_PROVIDER_CHAIN"],
      dataCategories: ["live scores", "match clock", "winner", "penalty shootout"],
      consumedBy: ["admin live score sync", "World Cup bracket match updates"],
      storage: ["world_cup_bracket_matches", "world_cup_bracket_chat_events"],
      importedRows: worldCupCounts.syncLogs,
      costProtection: ["configured fallback order", "skips unconfigured providers", "warnings instead of hard failure"],
      note: `Current chain: ${liveChain.join(" -> ")}.`,
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "sportsdata_world_cup",
      name: "SportsData.io World Cup",
      category: "World Cup soccer",
      status: statusFromConfig({ configured: sportsDataConfigured, scaffold: true }),
      configured: sportsDataConfigured,
      envVars: ["SPORTSDATA_API_KEY", "SPORTSDATA_WORLD_CUP_COMPETITION_ID"],
      dataCategories: ["teams", "fixtures", "live scores"],
      consumedBy: ["World Cup provider abstraction"],
      storage: ["Not production ready"],
      importedRows: null,
      costProtection: ["disabled by scaffold errors until endpoints are verified"],
      note: "Provider file is scaffold-only; getTeams/getFixtures intentionally throw until endpoint shapes are verified.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "rolling_insights",
      name: "Rolling Insights / Reality Sports",
      category: "multi-sport data",
      status: statusFromConfig({ configured: rollingInsightsConfigured }),
      configured: rollingInsightsConfigured,
      envVars: [
        "ROLLING_INSIGHTS_API_KEY or ROLLING_INSIGHTS_CLIENT_ID/SECRET",
        "RI_NBA_ENABLED / RI_MLB_ENABLED / RI_NHL_ENABLED / RI_NCAAF_ENABLED / RI_NCAAB_ENABLED / RI_SOCCER_ENABLED",
      ],
      dataCategories: ["teams", "players", "scores", "schedule", "standings", "projections", "rankings", "ADP"],
      consumedBy: ["sports API chain", "draft room", "Chimmy sports context"],
      storage: ["sports_teams", "sports_players", "sports_games", "sports_data_cache"],
      importedRows: sumSourceCounts(sourceCounts, ["rolling_insights"]) + cacheCounts.rolling_insights,
      costProtection: ["DB-first cache", "timeout budget", "enabled-sport flags"],
      note: rollingInsights
        ? `Auth mode: ${rollingInsights.authMode}. Enabled sports: ${Object.entries(rollingInsights.enabledSports)
            .filter(([, enabled]) => enabled)
            .map(([sport]) => sport)
            .join(", ") || "none"}.`
        : "Missing Rolling Insights credentials; chain falls through to backups.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "api_sports",
      name: "API-Sports American Football",
      category: "NFL / college football",
      status: statusFromConfig({ configured: hasAnyEnv(["APISPORTS_API_KEY", "API_SPORTS_KEY"]) }),
      configured: hasAnyEnv(["APISPORTS_API_KEY", "API_SPORTS_KEY"]),
      envVars: ["APISPORTS_API_KEY or API_SPORTS_KEY", "APISPORTS_NFL_LEAGUE_ID", "APISPORTS_NCAAF_LEAGUE_ID"],
      dataCategories: ["teams", "players", "games", "standings", "injuries", "odds"],
      consumedBy: ["sports API chain", "sports sync admin route", "draft/player identity enrichment"],
      storage: ["sports_teams", "sports_games", "sports_injuries", "sports_data_cache", "api_call_log"],
      importedRows: sumSourceCounts(sourceCounts, ["api_sports"]) + cacheCounts.api_sports,
      costProtection: ["ApiRateLimitRecord hourly/daily guard", "fallback records on quota guard", "server-only key"],
      note: "Supports NFL and NCAAF in the generic chain; World Cup uses the API-Football wrapper.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "thesportsdb",
      name: "TheSportsDB",
      category: "multi-sport backup/media",
      status: statusFromConfig({
        configured: hasAnyEnv(["THESPORTSDB_API_KEY", "SPORTSDB_API_KEY", "THE_SPORTS_DB_API_KEY"]),
        publicFallback: !hasAnyEnv(["THESPORTSDB_API_KEY", "SPORTSDB_API_KEY", "THE_SPORTS_DB_API_KEY"]),
      }),
      configured: hasAnyEnv(["THESPORTSDB_API_KEY", "SPORTSDB_API_KEY", "THE_SPORTS_DB_API_KEY"]),
      envVars: ["THESPORTSDB_API_KEY", "THESPORTSDB_*_LEAGUE_ID"],
      dataCategories: ["teams", "players", "schedule", "headshots", "team logos", "World Cup live fallback"],
      consumedBy: ["sports API chain", "World Cup live provider chain", "draft images"],
      storage: ["sports_data_cache", "sports_players", "team_assets"],
      importedRows: sumSourceCounts(sourceCounts, ["thesportsdb"]) + cacheCounts.thesportsdb,
      costProtection: ["DB-first cache before provider fallback", "provider called only after primary/cache misses"],
      note: "Falls back to public test key in some helper paths; production should set a real key and league ids.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "clear_sports",
      name: "ClearSports",
      category: "multi-sport backup",
      status: statusFromConfig({ configured: clearSportsConfigured }),
      configured: clearSportsConfigured,
      envVars: ["CLEARSPORTS_API_KEY", "CLEARSPORTS_API_BASE", "CLEARSPORTS_WORLD_CUP_LIVE_URL"],
      dataCategories: ["teams", "games", "players", "injuries", "stats", "odds", "news", "World Cup live bridge"],
      consumedBy: ["sports API chain", "ClearSports sync", "provider diagnostics"],
      storage: ["sports_teams", "sports_games", "sports_players", "sports_injuries", "sports_news", "provider_sync_state"],
      importedRows: sumSourceCounts(sourceCounts, ["clear_sports"]) + cacheCounts.clear_sports,
      costProtection: ["configurable timeout", "retry/backoff", "per-minute in-memory guard", "ApiRateLimitRecord guard"],
      note: clearSportsConfigured ? "Configured server-side." : "Missing ClearSports key/base; chain skips it.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "cfbd",
      name: "College Football Data",
      category: "college football backup",
      status: statusFromConfig({ configured: hasAnyEnv(["CFBD_API_KEY", "CFBD_KEY"]) }),
      configured: hasAnyEnv(["CFBD_API_KEY", "CFBD_KEY"]),
      envVars: ["CFBD_API_KEY or CFBD_KEY"],
      dataCategories: ["NCAAF teams", "NCAAF schedule/games"],
      consumedBy: ["sports API chain fallback"],
      storage: ["sports_data_cache", "sports_teams", "sports_games"],
      importedRows: sumSourceCounts(sourceCounts, ["cfbd"]) + cacheCounts.cfbd,
      costProtection: ["called only after cache/primary miss"],
      note: "NCAAF fallback only; no in-repo player/stat coverage beyond supported endpoints.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "sleeper",
      name: "Sleeper",
      category: "NFL public fallback",
      status: "public_fallback",
      configured: true,
      envVars: [],
      dataCategories: ["NFL players", "NFL headshots"],
      consumedBy: ["sports API chain", "draft/player search fallback"],
      storage: ["sports_data_cache", "sports_players"],
      importedRows: sumSourceCounts(sourceCounts, ["sleeper"]) + cacheCounts.sleeper,
      costProtection: ["called only for NFL fallback data", "DB cache after successful fetch"],
      note: "No key required; should not be treated as official live scoring.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "espn",
      name: "ESPN public site APIs",
      category: "public fallback/news",
      status: "public_fallback",
      configured: true,
      envVars: ["ESPN_SOCCER_PATH optional"],
      dataCategories: ["teams", "scoreboard", "standings", "news fallback"],
      consumedBy: ["sports router fallback", "sports sync news path"],
      storage: ["sports_games", "sports_news", "sports_data_cache"],
      importedRows: sumSourceCounts(sourceCounts, ["espn", "espn_live"]) + cacheCounts.espn,
      costProtection: ["last fallback only", "DB cache after successful fetch"],
      note: "Public fallback. Not a contracted source of truth.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "openai",
      name: "OpenAI / Chimmy AI",
      category: "AI provider",
      status: statusFromConfig({ configured: openaiConfigured }),
      configured: openaiConfigured,
      envVars: ["OPENAI_API_KEY or AI_INTEGRATIONS_OPENAI_API_KEY", "OPENAI_MODEL_* optional"],
      dataCategories: ["AI answers", "voice", "image generation", "World Cup explanations"],
      consumedBy: ["Chimmy", "World Cup AI", "draft/waiver/trade analysis"],
      storage: ["chat_history", "ai_results", "token_ledger", "api_usage_events"],
      importedRows: null,
      costProtection: ["token/pro gating", "AI result cache", "fallback/refusal when data unavailable"],
      note: startupWarnings.find((warning) => warning.code.includes("openai"))?.message ?? "No live probe made in admin dashboard.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "stripe",
      name: "Stripe",
      category: "payments/subscriptions",
      status: statusFromConfig({
        configured: hasAnyEnv(["STRIPE_SECRET_KEY"]) && hasAnyEnv(["STRIPE_WEBHOOK_SECRET"]),
        productionReady: hasAnyEnv(["STRIPE_SECRET_KEY"]) && hasAnyEnv(["STRIPE_WEBHOOK_SECRET"]),
      }),
      configured: hasAnyEnv(["STRIPE_SECRET_KEY"]) && hasAnyEnv(["STRIPE_WEBHOOK_SECRET"]),
      envVars: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "STRIPE_CHECKOUT_LINK_*"],
      dataCategories: ["checkout", "subscriptions", "token purchases", "webhook events"],
      consumedBy: ["monetization checkout", "token grants", "admin payment health"],
      storage: ["stripe_webhook_events", "user_subscriptions", "token_ledger", "bracket_payments"],
      importedRows: null,
      costProtection: ["webhook idempotency", "no full payment details stored in admin tables"],
      note: "Admin metrics use stored Stripe/webhook rows only.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "cloudinary",
      name: "Cloudinary",
      category: "image uploads",
      status: statusFromConfig({
        configured: hasAllEnv(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]),
      }),
      configured: hasAllEnv(["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"]),
      envVars: ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"],
      dataCategories: ["World Cup chat image uploads"],
      consumedBy: ["World Cup pool chat image upload route"],
      storage: ["world_cup_bracket_chat_events metadata"],
      importedRows: null,
      costProtection: ["server-side signature", "no key exposed client-side"],
      note: "Only used when rich image upload is invoked.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "klipy",
      name: "Klipy GIFs",
      category: "GIF/search media",
      status: statusFromConfig({ configured: hasAnyEnv(["KLIPY_API_KEY", "VITE_KLIPY_API_KEY"]) }),
      configured: hasAnyEnv(["KLIPY_API_KEY", "VITE_KLIPY_API_KEY"]),
      envVars: ["KLIPY_API_KEY", "VITE_KLIPY_API_KEY"],
      dataCategories: ["GIF search", "chat GIF catalog"],
      consumedBy: ["rich message GIF resolver", "chat catalog sync"],
      storage: ["chat_gifs", "sports_data_cache", "chat_messages metadata", "api_call_log_records"],
      importedRows: null,
      costProtection: ["server-side resolver preferred", "30 minute GIF search cache", "per-user search burst limit", "clean fallback when missing"],
      note: hasAnyEnv(["VITE_KLIPY_API_KEY"]) ? "Legacy VITE_ key is present; prefer KLIPY_API_KEY server-side." : "World Cup chat GIF searches are proxied server-side.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "twilio",
      name: "Twilio",
      category: "SMS / phone verification",
      status: statusFromConfig({
        configured:
          hasAnyEnv(["TWILIO_VERIFY_SERVICE_SID"]) &&
          hasAnyEnv(["TWILIO_ACCOUNT_SID"]) &&
          (hasAnyEnv(["TWILIO_AUTH_TOKEN"]) || hasAllEnv(["TWILIO_API_KEY", "TWILIO_API_SECRET"])),
      }),
      configured:
        hasAnyEnv(["TWILIO_VERIFY_SERVICE_SID"]) &&
        hasAnyEnv(["TWILIO_ACCOUNT_SID"]) &&
        (hasAnyEnv(["TWILIO_AUTH_TOKEN"]) || hasAllEnv(["TWILIO_API_KEY", "TWILIO_API_SECRET"])),
      envVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN or TWILIO_API_KEY/SECRET", "TWILIO_PHONE_NUMBER", "TWILIO_VERIFY_SERVICE_SID"],
      dataCategories: ["phone signup verification", "SMS notifications"],
      consumedBy: ["signup", "password reset SMS", "World Cup notifications"],
      storage: ["verification/password reset records", "notifications"],
      importedRows: null,
      costProtection: ["Twilio errors sanitized for users", "SMS skipped/fails cleanly when not configured"],
      note: "Admin dashboard checks configuration only.",
      calls,
      rates,
      sync,
    }),
    providerRow({
      id: "analytics",
      name: "Analytics / traffic",
      category: "product analytics",
      status: statusFromConfig({
        configured: hasAnyEnv(["NEXT_PUBLIC_GA_MEASUREMENT_ID", "META_PIXEL_ID", "NEXT_PUBLIC_META_PIXEL_ID"]),
      }),
      configured: hasAnyEnv(["NEXT_PUBLIC_GA_MEASUREMENT_ID", "META_PIXEL_ID", "NEXT_PUBLIC_META_PIXEL_ID"]),
      envVars: ["NEXT_PUBLIC_ANALYTICS_ENABLED", "NEXT_PUBLIC_GA_MEASUREMENT_ID", "META_PIXEL_ID", "NEXT_PUBLIC_META_PIXEL_ID"],
      dataCategories: ["traffic", "page views", "product events"],
      consumedBy: ["analytics client/server", "admin metrics when tracked"],
      storage: ["analytics_events", "api_usage_events", "api_usage_rollups"],
      importedRows: null,
      costProtection: ["privacy-safe event storage where used"],
      note: "Traffic/referrer attribution is partial; admin should show Not tracked yet where no rows exist.",
      calls,
      rates,
      sync,
    }),
  ]
}

// ─── AI Interaction Health ────────────────────────────────────────────────────

export type AiInteractionHealthModelRow = {
  model: string
  count: number
}

export type AiInteractionHealthBlockedRow = {
  reason: string
  count: number
}

export type AdminAiInteractionHealth = {
  windowHours: number
  since: string
  total: number
  deterministic: number
  deterministicPct: number
  llmCalls: number
  clean: number
  warned: number
  blocked: number
  blockedPct: number
  unavailable: number
  avgTokenCost: number | null
  modelBreakdown: AiInteractionHealthModelRow[]
  topBlockedReasons: AiInteractionHealthBlockedRow[]
  lastCallAt: string | null
  worldCupTotal: number
  worldCupBlocked: number
}

export async function getAdminAiInteractionHealth(
  windowHours = 24
): Promise<AdminAiInteractionHealth> {
  const since = nowMinusHours(windowHours)
  const sinceIso = since.toISOString()

  try {
    const [
      allRows,
      modelRows,
      blockedReasonRows,
      lastRow,
      wcTotal,
      wcBlocked,
    ] = await Promise.all([
      // aggregate validator result counts
      prisma.aiInteractionLog.groupBy({
        by: ["validatorResult"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // model distribution for LLM calls
      prisma.aiInteractionLog.groupBy({
        by: ["modelUsed"],
        where: {
          createdAt: { gte: since },
          wasDeterministic: false,
          modelUsed: { not: null },
        },
        _count: { _all: true },
        orderBy: { _count: { modelUsed: "desc" } },
        take: 8,
      }),
      // blocked reason breakdown
      prisma.aiInteractionLog.groupBy({
        by: ["blockedReason"],
        where: {
          createdAt: { gte: since },
          validatorResult: "blocked",
          blockedReason: { not: null },
        },
        _count: { _all: true },
        orderBy: { _count: { blockedReason: "desc" } },
        take: 8,
      }),
      // last call time
      prisma.aiInteractionLog.findFirst({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
      // world cup total
      prisma.aiInteractionLog.count({
        where: { sport: "world_cup", createdAt: { gte: since } },
      }),
      // world cup blocked
      prisma.aiInteractionLog.count({
        where: { sport: "world_cup", validatorResult: "blocked", createdAt: { gte: since } },
      }),
    ])

    // aggregate token costs for LLM (non-deterministic) calls
    const tokenAgg = await prisma.aiInteractionLog.aggregate({
      where: {
        createdAt: { gte: since },
        wasDeterministic: false,
        tokenCost: { not: null },
      },
      _avg: { tokenCost: true },
    })

    const countMap: Record<string, number> = {}
    let total = 0
    for (const row of allRows) {
      const key = row.validatorResult ?? "unknown"
      countMap[key] = row._count._all
      total += row._count._all
    }

    const deterministicCount = countMap["deterministic"] ?? 0
    const cleanCount = countMap["clean"] ?? 0
    const warnedCount = countMap["warned"] ?? 0
    const blockedCount = countMap["blocked"] ?? 0
    const unavailableCount = countMap["unavailable"] ?? 0
    const llmCalls = total - deterministicCount

    return {
      windowHours,
      since: sinceIso,
      total,
      deterministic: deterministicCount,
      deterministicPct: total > 0 ? Math.round((deterministicCount / total) * 100) : 0,
      llmCalls,
      clean: cleanCount,
      warned: warnedCount,
      blocked: blockedCount,
      blockedPct: llmCalls > 0 ? Math.round((blockedCount / llmCalls) * 100) : 0,
      unavailable: unavailableCount,
      avgTokenCost: tokenAgg._avg.tokenCost != null ? Math.round(tokenAgg._avg.tokenCost) : null,
      modelBreakdown: (modelRows as Array<{ modelUsed: string | null; _count: { _all: number } }>)
        .filter((r) => r.modelUsed != null)
        .map((r) => ({ model: r.modelUsed as string, count: r._count._all })),
      topBlockedReasons: (blockedReasonRows as Array<{ blockedReason: string | null; _count: { _all: number } }>)
        .filter((r) => r.blockedReason != null)
        .map((r) => ({ reason: r.blockedReason as string, count: r._count._all })),
      lastCallAt: lastRow?.createdAt?.toISOString() ?? null,
      worldCupTotal: wcTotal,
      worldCupBlocked: wcBlocked,
    }
  } catch (err) {
    console.error("[AdminAiInteractionHealth] Failed to query audit logs:", err)
    return {
      windowHours,
      since: sinceIso,
      total: 0,
      deterministic: 0,
      deterministicPct: 0,
      llmCalls: 0,
      clean: 0,
      warned: 0,
      blocked: 0,
      blockedPct: 0,
      unavailable: 0,
      avgTokenCost: null,
      modelBreakdown: [],
      topBlockedReasons: [],
      lastCallAt: null,
      worldCupTotal: 0,
      worldCupBlocked: 0,
    }
  }
}
