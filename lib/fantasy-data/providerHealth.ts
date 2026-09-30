import "server-only"

import { prisma } from "@/lib/prisma"
import { computeFantasyFreshness, type FantasyFreshnessReport } from "./fantasyFreshness"
import { loadFantasyDataEvidence } from "./fantasyDataEvidence"

export type FantasyProviderSport = "NFL" | "NCAAF"

export type FantasyDataDomain =
  | "players"
  | "teams"
  | "player_headshots"
  | "team_logos"
  | "schedules"
  | "scores"
  | "standings"
  | "injuries"
  | "depth_charts"
  | "news"
  | "weather"
  | "adp"
  | "projections"
  | "fantasy_values"
  | "season_stats"
  | "game_logs"
  | "idp_stats"

export type EnvGroupStatus = {
  name: string
  keys: string[]
  presentKeys: string[]
  configured: boolean
  requiredFor: string[]
}

export type ProviderDomainHealth = {
  domain: FantasyDataDomain
  sport: FantasyProviderSport
  providerPriority: string[]
  envVarRequired: string[]
  dbModels: string[]
  count: number
  lastSyncedAt: string | null
  freshness: FantasyFreshnessReport["tier"]
  status: "working" | "partial" | "missing" | "provider-unavailable" | "stale"
  evidenceReturnedToAI: boolean
  uiConsumer: string[]
  cronAdminRoute: string[]
  warnings: string[]
  fixNeeded: string | null
}

export type ProviderHealth = {
  id: string
  name: string
  priority: number
  configured: boolean
  canConstructClient: boolean
  publicFallback: boolean
  envVars: EnvGroupStatus[]
  domains: FantasyDataDomain[]
  fallbackProviderAvailable: boolean
  lastSuccessfulImport: string | null
  lastFailure: string | null
  recordsImported: number
  freshness: FantasyFreshnessReport["tier"]
  status: "working" | "partial" | "pending" | "provider-unavailable" | "error" | "stale"
}

export type FantasyProviderHealthReport = {
  sport: FantasyProviderSport
  providers: ProviderHealth[]
  domains: ProviderDomainHealth[]
  counts: Record<FantasyDataDomain | "total", number>
  lastSyncedAt: string | null
  freshness: FantasyFreshnessReport
  missingEnv: string[]
  stale: boolean
  errors: string[]
  warnings: string[]
}

type ModelMetric = {
  model: string
  where?: Record<string, unknown>
  dateField: string
  sourceField?: string
}

type ProviderDefinition = {
  id: string
  name: string
  priority: number
  envGroups: string[]
  domains: FantasyDataDomain[]
  sports: FantasyProviderSport[]
  publicFallback?: boolean
}

type DomainDefinition = {
  domain: FantasyDataDomain
  providerPriority: string[]
  envGroups: string[]
  models: string[]
  evidenceReturnedToAI: boolean
  uiConsumer: string[]
  cronAdminRoute: string[]
  fixNeededWhenMissing: string
}

const ALL_DOMAINS: FantasyDataDomain[] = [
  "players",
  "teams",
  "player_headshots",
  "team_logos",
  "schedules",
  "scores",
  "standings",
  "injuries",
  "depth_charts",
  "news",
  "weather",
  "adp",
  "projections",
  "fantasy_values",
  "season_stats",
  "game_logs",
  "idp_stats",
]

const ENV_GROUPS: Record<string, { keys: string[]; requiredFor: string[] }> = {
  rolling_insights: {
    keys: [
      "ROLLING_INSIGHTS_API_KEY",
      "ROLLING_INSIGHTS_CLIENT_ID + ROLLING_INSIGHTS_CLIENT_SECRET",
      "ROLLING_INSIGHTS_CLIENT_ID2 + ROLLING_INSIGHTS_CLIENT_SECRET2",
    ],
    requiredFor: ["NFL players", "NFL teams", "NFL schedules", "NFL depth charts", "NFL team/player stats"],
  },
  api_sports: {
    keys: ["APISPORTS_API_KEY", "API_SPORTS_KEY"],
    requiredFor: ["NFL/NCAAF teams", "games", "scores", "standings", "injuries", "stats"],
  },
  cfbd: {
    keys: ["CFBD_API_KEY", "CFBD_KEY"],
    requiredFor: ["NCAAF players", "teams", "schedules", "rankings"],
  },
  thesportsdb: {
    keys: ["THESPORTSDB_API_KEY", "SPORTSDB_API_KEY", "THE_SPORTS_DB_API_KEY", "THEAUDIODB_API_KEY"],
    requiredFor: ["logos", "headshots", "teams", "events"],
  },
  clearsports: {
    keys: ["CLEARSPORTS_API_KEY", "CLEAR_SPORTS_API_KEY"],
    requiredFor: ["ClearSports fallback sports data"],
  },
  newsapi: {
    keys: ["NEWS_API_KEY", "NEWSAPI_KEY"],
    requiredFor: ["external fantasy news fallback"],
  },
  openweathermap: {
    keys: ["OPENWEATHERMAP_API_KEY"],
    requiredFor: ["game weather"],
  },
  sleeper: {
    keys: [],
    requiredFor: ["public NFL players", "headshots", "ADP fallback"],
  },
  espn: {
    keys: [],
    requiredFor: ["public news/injury fallback"],
  },
}

const PROVIDERS: ProviderDefinition[] = [
  {
    id: "rolling_insights",
    name: "Rolling Insights",
    priority: 1,
    envGroups: ["rolling_insights"],
    sports: ["NFL", "NCAAF"],
    domains: ["players", "teams", "schedules", "depth_charts", "season_stats", "fantasy_values"],
  },
  {
    id: "thesportsdb",
    name: "TheSportsDB",
    priority: 2,
    envGroups: ["thesportsdb"],
    sports: ["NFL", "NCAAF"],
    publicFallback: true,
    domains: ["teams", "team_logos", "player_headshots", "schedules", "scores", "news"],
  },
  {
    id: "api_sports",
    name: "API-Sports",
    priority: 3,
    envGroups: ["api_sports"],
    sports: ["NFL", "NCAAF"],
    domains: ["players", "teams", "schedules", "scores", "standings", "injuries", "season_stats", "game_logs", "idp_stats"],
  },
  {
    id: "cfbd",
    name: "CollegeFootballData",
    priority: 4,
    envGroups: ["cfbd"],
    sports: ["NCAAF"],
    domains: ["players", "teams", "schedules", "scores", "standings", "season_stats", "game_logs"],
  },
  {
    id: "clearsports",
    name: "ClearSports",
    priority: 5,
    envGroups: ["clearsports"],
    sports: ["NFL", "NCAAF"],
    domains: ["players", "teams", "player_headshots", "team_logos", "news", "projections"],
  },
  {
    id: "sleeper",
    name: "Sleeper",
    priority: 6,
    envGroups: ["sleeper"],
    sports: ["NFL"],
    publicFallback: true,
    domains: ["players", "player_headshots", "adp", "game_logs"],
  },
  {
    id: "espn",
    name: "ESPN",
    priority: 7,
    envGroups: ["espn"],
    sports: ["NFL", "NCAAF"],
    publicFallback: true,
    domains: ["news", "injuries", "player_headshots"],
  },
  {
    id: "openweathermap",
    name: "OpenWeatherMap",
    priority: 8,
    envGroups: ["openweathermap"],
    sports: ["NFL", "NCAAF"],
    domains: ["weather"],
  },
  {
    id: "newsapi",
    name: "NewsAPI",
    priority: 9,
    envGroups: ["newsapi"],
    sports: ["NFL", "NCAAF"],
    domains: ["news"],
  },
]

const DOMAIN_DEFINITIONS: DomainDefinition[] = [
  {
    domain: "players",
    providerPriority: ["rolling_insights", "api_sports", "cfbd", "clearsports", "sleeper"],
    envGroups: ["rolling_insights", "api_sports", "cfbd"],
    models: ["SportsPlayerRecord", "SportsPlayer"],
    evidenceReturnedToAI: true,
    uiConsumer: ["PlayersTab", "DraftTab", "draft room", "mock draft", "player cards", "AI league chat"],
    cronAdminRoute: ["/api/admin/fantasy-data/import", "/api/cron/import-players", "/api/admin/sports/sync"],
    fixNeededWhenMissing: "Run fantasy-data import and verify provider player endpoints returned rows.",
  },
  {
    domain: "teams",
    providerPriority: ["rolling_insights", "thesportsdb", "api_sports", "cfbd", "clearsports"],
    envGroups: ["rolling_insights", "api_sports", "cfbd", "thesportsdb"],
    models: ["SportsTeam", "TeamAsset"],
    evidenceReturnedToAI: true,
    uiConsumer: ["PlayersTab team filters", "scoreboards", "draft room", "admin diagnostics"],
    cronAdminRoute: ["/api/admin/sports/sync", "/api/sports/sync"],
    fixNeededWhenMissing: "Run team sync through api-chain; team assets may need a logo backfill.",
  },
  {
    domain: "player_headshots",
    providerPriority: ["thesportsdb", "sleeper", "api_sports", "clearsports", "rolling_insights", "espn"],
    envGroups: ["thesportsdb", "api_sports", "clearsports", "rolling_insights"],
    models: ["SportsPlayerRecord", "SportsPlayer"],
    evidenceReturnedToAI: false,
    uiConsumer: ["PlayersTab", "draft room", "mock draft", "player cards"],
    cronAdminRoute: ["/api/admin/sports/sync", "/api/sports/sync"],
    fixNeededWhenMissing: "Run player/image sync; provider may not expose headshots for the sport.",
  },
  {
    domain: "team_logos",
    providerPriority: ["thesportsdb", "clearsports", "api_sports", "rolling_insights"],
    envGroups: ["thesportsdb", "clearsports", "api_sports", "rolling_insights"],
    models: ["TeamAsset", "SportsTeam"],
    evidenceReturnedToAI: false,
    uiConsumer: ["team logos", "scoreboards", "draft room", "league UI"],
    cronAdminRoute: ["/api/admin/sports/sync", "/api/sports/sync"],
    fixNeededWhenMissing: "Run team/logo sync and verify TeamAsset/SportsTeam logo URLs.",
  },
  {
    domain: "schedules",
    providerPriority: ["rolling_insights", "thesportsdb", "api_sports", "cfbd"],
    envGroups: ["rolling_insights", "api_sports", "cfbd", "thesportsdb"],
    models: ["SportsGame", "GameSchedule"],
    evidenceReturnedToAI: true,
    uiConsumer: ["ScoresTab", "player cards", "AI league chat", "weather projections"],
    cronAdminRoute: ["/api/cron/import-schedules", "/api/admin/sports/sync", "/api/sports/sync"],
    fixNeededWhenMissing: "Run schedule import for current season.",
  },
  {
    domain: "scores",
    providerPriority: ["thesportsdb", "api_sports", "cfbd"],
    envGroups: ["api_sports", "cfbd", "thesportsdb"],
    models: ["SportsGame", "GameSchedule"],
    evidenceReturnedToAI: true,
    uiConsumer: ["ScoresTab", "league chat", "matchup context"],
    cronAdminRoute: ["/api/cron/import-scores", "/api/admin/sports/sync", "/api/sports/sync"],
    fixNeededWhenMissing: "Run score import; out-of-season sports may have no live/final rows.",
  },
  {
    domain: "standings",
    providerPriority: ["api_sports", "cfbd", "thesportsdb"],
    envGroups: ["api_sports", "cfbd"],
    models: ["SportsDataCache"],
    evidenceReturnedToAI: true,
    uiConsumer: ["AI league chat", "admin diagnostics"],
    cronAdminRoute: ["/api/cron/import-standings", "/api/admin/sports/sync", "/api/sports/sync"],
    fixNeededWhenMissing: "Standings currently persist to SportsDataCache; add a normalized model only if UI requires row-level queries.",
  },
  {
    domain: "injuries",
    providerPriority: ["api_sports", "espn", "rolling_insights"],
    envGroups: ["api_sports"],
    models: ["InjuryReportRecord", "SportsInjury"],
    evidenceReturnedToAI: true,
    uiConsumer: ["PlayersTab", "player cards", "draft room", "start/sit", "AI league chat"],
    cronAdminRoute: ["/api/cron/import-injuries", "/api/admin/fantasy-data/import"],
    fixNeededWhenMissing: "Run injury import; NCAAF provider support may be limited.",
  },
  {
    domain: "depth_charts",
    providerPriority: ["rolling_insights"],
    envGroups: ["rolling_insights"],
    models: ["DepthChart"],
    evidenceReturnedToAI: true,
    uiConsumer: ["draft advisor", "player cards", "AI league chat"],
    cronAdminRoute: ["/api/cron/import-depth-charts", "/api/admin/fantasy-data/import"],
    fixNeededWhenMissing: "Depth charts are currently NFL/Rolling Insights only.",
  },
  {
    domain: "news",
    providerPriority: ["rolling_insights", "thesportsdb", "espn", "newsapi", "clearsports"],
    envGroups: ["newsapi", "thesportsdb", "clearsports"],
    models: ["PlayerNewsRecord", "SportsNews"],
    evidenceReturnedToAI: true,
    uiConsumer: ["player cards", "AI league chat", "start/sit analyzer"],
    cronAdminRoute: ["/api/cron/import-news", "/api/admin/fantasy-data/import"],
    fixNeededWhenMissing: "Run news import and verify provider news rows are normalized to PlayerNewsRecord.",
  },
  {
    domain: "weather",
    providerPriority: ["openweathermap"],
    envGroups: ["openweathermap"],
    models: ["WeatherCache", "GameSchedule"],
    evidenceReturnedToAI: true,
    uiConsumer: ["ScoresTab", "start/sit", "AI league chat", "projection adjustments"],
    cronAdminRoute: ["/api/sports/weather"],
    fixNeededWhenMissing: "Weather is attached opportunistically to games; add cron coverage if stale during season.",
  },
  {
    domain: "adp",
    providerPriority: ["sleeper", "fantasycalc", "allfantasy"],
    envGroups: ["sleeper"],
    models: ["AdpDataRecord"],
    evidenceReturnedToAI: true,
    uiConsumer: ["DraftTab", "draft room", "mock draft", "AI league chat"],
    cronAdminRoute: ["/api/cron/adp-refresh", "/api/admin/fantasy-data/import"],
    fixNeededWhenMissing: "Run ADP refresh; NCAAF ADP is provider-limited.",
  },
  {
    domain: "projections",
    providerPriority: ["clearsports", "rolling_insights", "allfantasy"],
    envGroups: ["clearsports", "rolling_insights"],
    models: ["FantasyProjection", "AFProjectionSnapshot"],
    evidenceReturnedToAI: true,
    uiConsumer: ["player cards", "start/sit", "draft advisor", "AI league chat"],
    cronAdminRoute: ["/api/admin/sports/sync", "/api/sports/sync"],
    fixNeededWhenMissing: "Projection rows need a provider-backed sync; do not compute projections from memory.",
  },
  {
    domain: "fantasy_values",
    providerPriority: ["rolling_insights", "sleeper", "allfantasy"],
    envGroups: ["rolling_insights"],
    models: ["SportsPlayerRecord", "AdpDataRecord"],
    evidenceReturnedToAI: true,
    uiConsumer: ["DraftTab", "draft room", "mock draft", "AI league chat"],
    cronAdminRoute: ["/api/admin/fantasy-data/import", "/api/cron/adp-refresh"],
    fixNeededWhenMissing: "Use ADP/dynastyValue rows as value evidence until a dedicated valuation provider is normalized.",
  },
  {
    domain: "season_stats",
    providerPriority: ["rolling_insights", "api_sports", "cfbd"],
    envGroups: ["rolling_insights", "api_sports", "cfbd"],
    models: ["PlayerSeasonStats", "TeamSeasonStats"],
    evidenceReturnedToAI: true,
    uiConsumer: ["draft room", "player cards", "AI league chat", "sports OS advisor"],
    cronAdminRoute: ["/api/admin/fantasy-data/import", "/api/admin/sports/sync"],
    fixNeededWhenMissing: "Run provider stats sync; NCAAF stat coverage depends on CFBD/API-Sports endpoints.",
  },
  {
    domain: "game_logs",
    providerPriority: ["sleeper", "api_sports", "cfbd"],
    envGroups: ["api_sports", "cfbd"],
    models: ["PlayerGameLogCache", "PlayerGameStat"],
    evidenceReturnedToAI: true,
    uiConsumer: ["player cards", "start/sit", "AI league chat"],
    cronAdminRoute: ["/api/admin/sports/sync"],
    fixNeededWhenMissing: "Game logs are DB-first cache rows; add per-game stat import for full coverage.",
  },
  {
    domain: "idp_stats",
    providerPriority: ["api_sports", "rolling_insights"],
    envGroups: ["api_sports", "rolling_insights"],
    models: ["PlayerSeasonStats", "PlayerGameStat"],
    evidenceReturnedToAI: true,
    uiConsumer: ["IDP leagues", "AI league chat", "draft advisor"],
    cronAdminRoute: ["/api/admin/sports/sync"],
    fixNeededWhenMissing: "IDP stats need defensive positions in PlayerSeasonStats/PlayerGameStat.",
  },
]

function envValue(key: string): string {
  return process.env[key]?.trim() ?? ""
}

function groupConfigured(name: string): boolean {
  if (name === "rolling_insights") {
    return Boolean(envValue("ROLLING_INSIGHTS_API_KEY")) ||
      (Boolean(envValue("ROLLING_INSIGHTS_CLIENT_ID")) && Boolean(envValue("ROLLING_INSIGHTS_CLIENT_SECRET"))) ||
      (Boolean(envValue("ROLLING_INSIGHTS_CLIENT_ID2")) && Boolean(envValue("ROLLING_INSIGHTS_CLIENT_SECRET2")))
  }
  if (name === "api_sports") return Boolean(envValue("APISPORTS_API_KEY") || envValue("API_SPORTS_KEY"))
  if (name === "cfbd") return Boolean(envValue("CFBD_API_KEY") || envValue("CFBD_KEY"))
  if (name === "thesportsdb") {
    return Boolean(
      envValue("THESPORTSDB_API_KEY") ||
        envValue("SPORTSDB_API_KEY") ||
        envValue("THE_SPORTS_DB_API_KEY") ||
        envValue("THEAUDIODB_API_KEY"),
    )
  }
  if (name === "clearsports") return Boolean(envValue("CLEARSPORTS_API_KEY") || envValue("CLEAR_SPORTS_API_KEY"))
  if (name === "newsapi") return Boolean(envValue("NEWS_API_KEY") || envValue("NEWSAPI_KEY"))
  if (name === "openweathermap") return Boolean(envValue("OPENWEATHERMAP_API_KEY"))
  return true
}

function presentKeysForGroup(name: string): string[] {
  if (name === "rolling_insights") {
    const present: string[] = []
    if (envValue("ROLLING_INSIGHTS_API_KEY")) present.push("ROLLING_INSIGHTS_API_KEY")
    if (envValue("ROLLING_INSIGHTS_CLIENT_ID") && envValue("ROLLING_INSIGHTS_CLIENT_SECRET")) {
      present.push("ROLLING_INSIGHTS_CLIENT_ID + ROLLING_INSIGHTS_CLIENT_SECRET")
    }
    if (envValue("ROLLING_INSIGHTS_CLIENT_ID2") && envValue("ROLLING_INSIGHTS_CLIENT_SECRET2")) {
      present.push("ROLLING_INSIGHTS_CLIENT_ID2 + ROLLING_INSIGHTS_CLIENT_SECRET2")
    }
    return present
  }
  const group = ENV_GROUPS[name]
  if (!group) return []
  return group.keys.filter((key) => envValue(key))
}

function envGroupStatus(name: string): EnvGroupStatus {
  const group = ENV_GROUPS[name] ?? { keys: [], requiredFor: [] }
  return {
    name,
    keys: group.keys,
    presentKeys: presentKeysForGroup(name),
    configured: groupConfigured(name),
    requiredFor: group.requiredFor,
  }
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value
  }
  return null
}

function latestIso(values: Array<string | null>): string | null {
  const timestamps = values
    .map((v) => (v ? Date.parse(v) : Number.NaN))
    .filter((v) => Number.isFinite(v))
  if (timestamps.length === 0) return null
  return new Date(Math.max(...timestamps)).toISOString()
}

function tierFromDate(lastSyncedAt: string | null, count: number): FantasyFreshnessReport["tier"] {
  if (count === 0) return "unavailable"
  if (!lastSyncedAt) return "pending"
  const ageHours = (Date.now() - Date.parse(lastSyncedAt)) / 3_600_000
  if (!Number.isFinite(ageHours)) return "pending"
  if (ageHours < 6) return "fresh"
  if (ageHours < 24) return "recent"
  if (ageHours < 24 * 7) return "stale"
  return "very_stale"
}

function statusFromFreshness(
  freshness: FantasyFreshnessReport["tier"],
  configured: boolean,
): ProviderDomainHealth["status"] {
  if (!configured && freshness === "unavailable") return "provider-unavailable"
  if (freshness === "fresh" || freshness === "recent") return "working"
  if (freshness === "stale" || freshness === "very_stale") return "stale"
  if (freshness === "pending") return "partial"
  return "missing"
}

function prismaModel(name: string): any | null {
  const model = (prisma as any)[name]
  return model && typeof model === "object" ? model : null
}

async function safeCount(metric: ModelMetric): Promise<number> {
  const model = prismaModel(metric.model)
  if (!model || typeof model.count !== "function") return 0
  try {
    return Number(await model.count({ where: metric.where ?? {} }).catch(() => 0))
  } catch {
    return 0
  }
}

async function safeLatest(metric: ModelMetric): Promise<string | null> {
  const model = prismaModel(metric.model)
  if (!model || typeof model.findFirst !== "function") return null
  try {
    const row = await model.findFirst({
      where: metric.where ?? {},
      orderBy: { [metric.dateField]: "desc" },
      select: { [metric.dateField]: true },
    }).catch(() => null)
    return toIso(row?.[metric.dateField])
  } catch {
    return null
  }
}

async function domainMetricSummary(metrics: ModelMetric[]): Promise<{ count: number; lastSyncedAt: string | null }> {
  const [counts, latestDates] = await Promise.all([
    Promise.all(metrics.map((metric) => safeCount(metric))),
    Promise.all(metrics.map((metric) => safeLatest(metric))),
  ])
  return {
    count: counts.reduce((sum, count) => sum + count, 0),
    lastSyncedAt: latestIso(latestDates),
  }
}

function domainMetrics(domain: FantasyDataDomain, sport: FantasyProviderSport, season: number): ModelMetric[] {
  const seasonString = String(season)
  const sportLower = sport.toLowerCase()
  const standingsCacheWhere = {
    OR: [
      { cacheKey: { startsWith: `${sport}:standings:` } },
      { cacheKey: { startsWith: `${sportLower}:standings:` } },
    ],
  }
  switch (domain) {
    case "players":
      return [
        { model: "sportsPlayerRecord", where: { sport }, dateField: "lastUpdated" },
        { model: "sportsPlayer", where: { sport }, dateField: "fetchedAt" },
      ]
    case "teams":
      return [
        { model: "sportsTeam", where: { sport }, dateField: "fetchedAt" },
        { model: "teamAsset", where: { sport }, dateField: "lastUpdated" },
      ]
    case "player_headshots":
      return [
        {
          model: "sportsPlayerRecord",
          where: {
            sport,
            OR: [{ headshotUrl: { not: null } }, { headshotUrlSm: { not: null } }, { headshotUrlLg: { not: null } }],
          },
          dateField: "lastUpdated",
        },
        { model: "sportsPlayer", where: { sport, imageUrl: { not: null } }, dateField: "fetchedAt" },
      ]
    case "team_logos":
      return [
        {
          model: "teamAsset",
          where: { sport, OR: [{ logoUrl: { not: null } }, { logoUrlSm: { not: null } }, { logoUrlLg: { not: null } }] },
          dateField: "lastUpdated",
        },
        { model: "sportsTeam", where: { sport, logo: { not: null } }, dateField: "fetchedAt" },
      ]
    case "schedules":
      return [
        { model: "sportsGame", where: { sport, season }, dateField: "fetchedAt" },
        { model: "gameSchedule", where: { sportType: sport, season }, dateField: "updatedAt" },
      ]
    case "scores":
      return [
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
        },
      ]
    case "standings":
      return [{ model: "sportsDataCache", where: standingsCacheWhere, dateField: "createdAt" }]
    case "injuries":
      return [
        { model: "injuryReportRecord", where: { sport }, dateField: "reportDate" },
        { model: "sportsInjury", where: { sport }, dateField: "fetchedAt" },
      ]
    case "depth_charts":
      return [{ model: "depthChart", where: { sport, season: seasonString }, dateField: "fetchedAt" }]
    case "news":
      return [
        { model: "playerNewsRecord", where: { sport }, dateField: "publishedAt" },
        { model: "sportsNews", where: { sport }, dateField: "publishedAt" },
      ]
    case "weather":
      return [
        { model: "weatherCache", where: { sport }, dateField: "fetchedAt" },
        { model: "gameSchedule", where: { sportType: sport, season, weather: { not: null } }, dateField: "updatedAt" },
      ]
    case "adp":
      return [{ model: "adpDataRecord", where: { sport, season }, dateField: "createdAt" }]
    case "projections":
      return [
        { model: "fantasyProjection", where: { sport, season: seasonString }, dateField: "fetchedAt" },
        { model: "aFProjectionSnapshot", where: { sport, season }, dateField: "computedAt" },
      ]
    case "fantasy_values":
      return [
        { model: "sportsPlayerRecord", where: { sport, OR: [{ dynastyValue: { not: null } }, { adp: { not: null } }] }, dateField: "lastUpdated" },
        { model: "adpDataRecord", where: { sport, season }, dateField: "createdAt" },
      ]
    case "season_stats":
      return [
        { model: "playerSeasonStats", where: { sport, season: seasonString }, dateField: "fetchedAt" },
        { model: "teamSeasonStats", where: { sport, season: seasonString }, dateField: "fetchedAt" },
      ]
    case "game_logs":
      return [
        { model: "playerGameLogCache", where: { sport, season: seasonString }, dateField: "syncedAt" },
        { model: "playerGameStat", where: { sportType: sport, season }, dateField: "updatedAt" },
      ]
    case "idp_stats":
      return [
        {
          model: "playerSeasonStats",
          where: { sport, season: seasonString, position: { in: ["DL", "DE", "DT", "LB", "CB", "S", "DB", "IDP"] } },
          dateField: "fetchedAt",
        },
        { model: "playerGameStat", where: { sportType: sport, season }, dateField: "updatedAt" },
      ]
  }
}

async function providerStates(providerId: string, sport: FantasyProviderSport): Promise<Array<Record<string, unknown>>> {
  const model = prismaModel("providerSyncState")
  if (!model || typeof model.findMany !== "function") return []
  try {
    return await model.findMany({
      where: {
        provider: providerId,
        OR: [{ sport }, { sport: sport.toLowerCase() }, { sport: "GLOBAL" }, { sport: null }],
      },
      orderBy: [{ lastCompletedAt: "desc" }],
      take: 25,
    }).catch(() => [])
  } catch {
    return []
  }
}

async function buildProviderHealth(provider: ProviderDefinition, sport: FantasyProviderSport): Promise<ProviderHealth> {
  const envVars = provider.envGroups.map(envGroupStatus)
  const configured = provider.publicFallback || envVars.every((group) => group.configured)
  const states = await providerStates(provider.id, sport)
  const lastSuccessfulImport = latestIso(states.map((state) => toIso(state.lastSuccessAt)))
  const lastErrorState = states.find((state) => state.lastErrorAt || state.lastError)
  const lastFailure = toIso(lastErrorState?.lastErrorAt)
  const recordsImported = states.reduce((sum, state) => sum + Number(state.recordsImported ?? 0), 0)
  const freshness = tierFromDate(lastSuccessfulImport, recordsImported || (lastSuccessfulImport ? 1 : 0))
  const laterFallback = PROVIDERS
    .filter((candidate) => candidate.priority > provider.priority && candidate.sports.includes(sport))
    .some((candidate) => candidate.publicFallback || candidate.envGroups.every(groupConfigured))

  let status: ProviderHealth["status"] = "pending"
  if (!configured) status = "provider-unavailable"
  else if (lastFailure && !lastSuccessfulImport) status = "error"
  else if (freshness === "fresh" || freshness === "recent") status = "working"
  else if (freshness === "stale" || freshness === "very_stale") status = "stale"
  else if (lastSuccessfulImport || recordsImported > 0) status = "partial"

  return {
    id: provider.id,
    name: provider.name,
    priority: provider.priority,
    configured,
    canConstructClient: configured,
    publicFallback: Boolean(provider.publicFallback),
    envVars,
    domains: provider.domains,
    fallbackProviderAvailable: laterFallback,
    lastSuccessfulImport,
    lastFailure,
    recordsImported,
    freshness,
    status,
  }
}

export function getFantasyProviderEnvStatus(sport: FantasyProviderSport): {
  envGroups: EnvGroupStatus[]
  missingEnv: string[]
} {
  const relevantGroups = new Set<string>()
  for (const provider of PROVIDERS) {
    if (!provider.sports.includes(sport)) continue
    for (const group of provider.envGroups) relevantGroups.add(group)
  }
  const envGroups = [...relevantGroups].map(envGroupStatus)
  const requiredGroups = sport === "NCAAF"
    ? ["cfbd", "api_sports"]
    : ["rolling_insights", "api_sports"]
  const missingEnv = requiredGroups
    .map(envGroupStatus)
    .filter((group) => !group.configured)
    .map((group) => group.keys.join(" or "))
  return { envGroups, missingEnv }
}

export async function loadFantasyProviderHealth(options: {
  sport: FantasyProviderSport | string
  season?: number
}): Promise<FantasyProviderHealthReport> {
  const sport = String(options.sport).toUpperCase() === "NCAAF" ? "NCAAF" : "NFL"
  const season = options.season ?? new Date().getFullYear()
  const evidence = await loadFantasyDataEvidence({ sport, season })
  const freshness = computeFantasyFreshness(evidence)

  const relevantProviders = PROVIDERS.filter((provider) => provider.sports.includes(sport))
  const providers = await Promise.all(relevantProviders.map((provider) => buildProviderHealth(provider, sport)))

  const domainHealth = await Promise.all(
    DOMAIN_DEFINITIONS.map(async (definition): Promise<ProviderDomainHealth> => {
      const providerPriority = definition.providerPriority.filter((id) =>
        relevantProviders.some((provider) => provider.id === id && provider.domains.includes(definition.domain)),
      )
      const envVarRequired = definition.envGroups
        .map(envGroupStatus)
        .filter((group) => group.keys.length > 0)
        .map((group) => group.keys.join(" or "))
      const configured = providerPriority.some((id) => {
        const provider = relevantProviders.find((candidate) => candidate.id === id)
        return Boolean(provider?.publicFallback) || Boolean(provider?.envGroups.every(groupConfigured))
      })
      const { count, lastSyncedAt } = await domainMetricSummary(domainMetrics(definition.domain, sport, season))
      const domainFreshness = tierFromDate(lastSyncedAt, count)
      const status = statusFromFreshness(domainFreshness, configured)
      const warnings: string[] = []
      if (status === "provider-unavailable") warnings.push("No configured provider/fallback is available for this domain.")
      if (status === "missing") warnings.push("No persisted rows found for this domain.")
      if (status === "stale") warnings.push("Persisted rows are stale.")
      if (definition.domain === "standings") {
        warnings.push("Standings are cached in SportsDataCache; no dedicated SportsStanding model exists.")
      }
      if (definition.domain === "projections" && count === 0) {
        warnings.push("Projection rows must be provider-backed before AI should cite projection values.")
      }

      return {
        domain: definition.domain,
        sport,
        providerPriority,
        envVarRequired,
        dbModels: definition.models,
        count,
        lastSyncedAt,
        freshness: domainFreshness,
        status,
        evidenceReturnedToAI: definition.evidenceReturnedToAI,
        uiConsumer: definition.uiConsumer,
        cronAdminRoute: definition.cronAdminRoute,
        warnings,
        fixNeeded: count === 0 ? definition.fixNeededWhenMissing : null,
      }
    }),
  )

  const counts = ALL_DOMAINS.reduce<Record<FantasyDataDomain | "total", number>>(
    (acc, domain) => {
      const entry = domainHealth.find((item) => item.domain === domain)
      acc[domain] = entry?.count ?? 0
      acc.total += entry?.count ?? 0
      return acc
    },
    { total: 0 } as Record<FantasyDataDomain | "total", number>,
  )

  const providerErrors = providers
    .filter((provider) => provider.lastFailure && provider.status === "error")
    .map((provider) => `${provider.name} last failed at ${provider.lastFailure}`)
  const domainWarnings = domainHealth.flatMap((domain) => domain.warnings.map((warning) => `${domain.domain}: ${warning}`))
  const missingEnv = getFantasyProviderEnvStatus(sport).missingEnv
  const lastSyncedAt = latestIso([
    evidence.lastFullSyncAt,
    ...providers.map((provider) => provider.lastSuccessfulImport),
    ...domainHealth.map((domain) => domain.lastSyncedAt),
  ])
  const stale = freshness.showWarning || domainHealth.some((domain) => domain.freshness === "stale" || domain.freshness === "very_stale")

  return {
    sport,
    providers,
    domains: domainHealth,
    counts,
    lastSyncedAt,
    freshness,
    missingEnv,
    stale,
    errors: providerErrors,
    warnings: [...evidence.warnings, ...domainWarnings],
  }
}

export { ALL_DOMAINS as FANTASY_DATA_DOMAINS }
