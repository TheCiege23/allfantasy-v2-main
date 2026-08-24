import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'
/**
 * Read-only NBA/NHL playoff provider proof audit.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/audit-playoff-provider-data.ts --season 2026
 *
 * This script does not write to the database and never prints API tokens.
 */

type Sport = "NBA" | "NHL"
type Confidence = "high" | "medium" | "low"

type ProviderSummary = {
  provider: string
  sport: Sport
  seasonYear: number
  endpointType: string
  rowsReturned: number
  postseasonRowsReturned: number
  firstTeamPairs: Array<{ homeTeam: string | null; awayTeam: string | null }>
  fieldsPresent: {
    teamIds: boolean
    teamNames: boolean
    scores: boolean
    status: boolean
    startsAtDate: boolean
    seasonType: boolean
    round: boolean
    eventName: boolean
    gameEventId: boolean
    leagueTournament: boolean
  }
  usableForPlayoffBracketSeries: boolean
  confidence: Confidence
  reason: string
  error?: string
}

type NormalizedGame = {
  gameId: string | null
  homeTeam: string | null
  awayTeam: string | null
  homeTeamId: string | null
  awayTeamId: string | null
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startsAt: string | null
  seasonType: string | number | null
  round: string | number | null
  eventName: string | null
  league: string | null
}

const SPORTS: Sport[] = ["NBA", "NHL"]
const ESPN_PATH: Record<Sport, string> = {
  NBA: "basketball/nba",
  NHL: "hockey/nhl",
}
const THESPORTSDB_LEAGUE_ID: Record<Sport, string> = {
  NBA: process.env.THESPORTSDB_NBA_LEAGUE_ID?.trim() || process.env.SPORTSDB_NBA_LEAGUE_ID?.trim() || "4387",
  NHL: process.env.THESPORTSDB_NHL_LEAGUE_ID?.trim() || process.env.SPORTSDB_NHL_LEAGUE_ID?.trim() || "4380",
}

function argValue(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter(Number.isFinite))).sort((a, b) => b - a)
}

function candidateSeasons(baseSeason: number): number[] {
  const currentYear = new Date().getUTCFullYear()
  return uniqueNumbers([baseSeason, baseSeason - 1, currentYear, currentYear - 1])
}

function seasonRangeEnding(year: number): string {
  return `${year - 1}-${year}`
}

function value(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] != null && record[key] !== "") return record[key]
  }
  return null
}

function text(input: unknown): string | null {
  const out = String(input ?? "").trim()
  return out || null
}

function num(input: unknown): number | null {
  const parsed = typeof input === "number" ? input : Number.parseInt(String(input ?? ""), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function flattenRows(payload: unknown, preferredKeys: string[] = []): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord)
  if (!isRecord(payload)) return []
  for (const key of [...preferredKeys, "events", "event", "games", "data", "results", "items", "schedule"]) {
    const nested = payload[key]
    if (Array.isArray(nested)) return nested.filter(isRecord)
    if (isRecord(nested)) {
      const deeper = flattenRows(nested, preferredKeys)
      if (deeper.length) return deeper
    }
  }
  for (const nested of Object.values(payload)) {
    const rows = flattenRows(nested, preferredKeys)
    if (rows.length) return rows
  }
  return []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function isPostseason(game: NormalizedGame): boolean {
  const joined = [game.seasonType, game.eventName, game.league, game.round, game.status]
    .map((part) => String(part ?? "").toLowerCase())
    .join(" ")
  return /\b(postseason|playoff|play-offs|finals?|conference finals?|semifinals?|semi-finals?|stanley cup)\b/.test(joined) ||
    String(game.seasonType ?? "") === "3"
}

function hasPlayoffRoundContext(game: NormalizedGame): boolean {
  if (game.round != null && game.round !== "") return true
  const eventName = String(game.eventName ?? "").toLowerCase()
  return /\b(first round|second round|semifinals?|semi-finals?|conference finals?|nba finals?|stanley cup final|finals?)\b/.test(eventName)
}

function normalizeGenericRow(raw: Record<string, unknown>): NormalizedGame {
  const homeNested = isRecord(raw.homeTeam) ? raw.homeTeam : isRecord(raw.home_team) ? raw.home_team : {}
  const awayNested = isRecord(raw.awayTeam) ? raw.awayTeam : isRecord(raw.away_team) ? raw.away_team : {}
  return {
    gameId: text(value(raw, ["game_ID", "gameId", "game_id", "idEvent", "id", "externalId"])),
    homeTeam: text(value(raw, ["home_team", "homeTeam", "home", "strHomeTeam", "home_name"])) ?? text(value(homeNested, ["displayName", "name", "strTeam"])),
    awayTeam: text(value(raw, ["away_team", "awayTeam", "away", "strAwayTeam", "away_name"])) ?? text(value(awayNested, ["displayName", "name", "strTeam"])),
    homeTeamId: text(value(raw, ["home_team_ID", "homeTeamId", "home_team_id", "idHomeTeam"])) ?? text(value(homeNested, ["id", "idTeam"])),
    awayTeamId: text(value(raw, ["away_team_ID", "awayTeamId", "away_team_id", "idAwayTeam"])) ?? text(value(awayNested, ["id", "idTeam"])),
    homeScore: num(value(raw, ["homeScore", "home_score", "home_team_score", "home_points", "intHomeScore"])),
    awayScore: num(value(raw, ["awayScore", "away_score", "away_team_score", "away_points", "intAwayScore"])),
    status: text(value(raw, ["status", "game_status", "state", "strStatus", "strProgress"])),
    startsAt: text(value(raw, ["game_time", "startTime", "start_time", "date", "dateEvent", "strTimestamp", "strEventTime"])),
    seasonType: value(raw, ["season_type", "seasonType", "season_type_id", "intSeasonType"]),
    round: value(raw, ["round", "intRound", "strRound"]),
    eventName: text(value(raw, ["event_name", "eventName", "round_name", "strEvent", "strRound"])),
    league: text(value(raw, ["league", "strLeague", "tournament", "competition", "event_type"])),
  }
}

function normalizeEspnEvent(raw: Record<string, unknown>): NormalizedGame {
  const competitions = Array.isArray(raw.competitions) ? raw.competitions.filter(isRecord) : []
  const comp = competitions[0] ?? {}
  const competitors = Array.isArray(comp.competitors) ? comp.competitors.filter(isRecord) : []
  const home = competitors.find((item) => item.homeAway === "home") ?? {}
  const away = competitors.find((item) => item.homeAway === "away") ?? {}
  const homeTeam = isRecord(home.team) ? home.team : {}
  const awayTeam = isRecord(away.team) ? away.team : {}
  const status = isRecord(comp.status) ? comp.status : {}
  const statusType = isRecord(status.type) ? status.type : {}
  const season = isRecord(raw.season) ? raw.season : {}
  return {
    gameId: text(raw.id),
    homeTeam: text(homeTeam.displayName ?? homeTeam.name ?? homeTeam.abbreviation),
    awayTeam: text(awayTeam.displayName ?? awayTeam.name ?? awayTeam.abbreviation),
    homeTeamId: text(homeTeam.id),
    awayTeamId: text(awayTeam.id),
    homeScore: num(home.score),
    awayScore: num(away.score),
    status: text(statusType.name ?? statusType.shortDetail),
    startsAt: text(comp.startDate ?? raw.date),
    seasonType: value(season, ["type", "slug"]),
    round: value(raw, ["week"]),
    eventName: text(raw.name ?? raw.shortName),
    league: text(value(raw, ["league", "uid"])),
  }
}

function fieldSummary(games: NormalizedGame[]): ProviderSummary["fieldsPresent"] {
  return {
    teamIds: games.some((game) => !!game.homeTeamId && !!game.awayTeamId),
    teamNames: games.some((game) => !!game.homeTeam && !!game.awayTeam),
    scores: games.some((game) => game.homeScore != null || game.awayScore != null),
    status: games.some((game) => !!game.status),
    startsAtDate: games.some((game) => !!game.startsAt),
    seasonType: games.some((game) => game.seasonType != null && game.seasonType !== ""),
    round: games.some((game) => game.round != null && game.round !== ""),
    eventName: games.some((game) => !!game.eventName),
    gameEventId: games.some((game) => !!game.gameId),
    leagueTournament: games.some((game) => !!game.league),
  }
}

function assess(games: NormalizedGame[], postseasonRows: number): Pick<ProviderSummary, "usableForPlayoffBracketSeries" | "confidence" | "reason"> {
  const fields = fieldSummary(games)
  const hasRoundContext = games.some(hasPlayoffRoundContext)
  if (postseasonRows > 0 && fields.teamNames && fields.status && fields.startsAtDate && hasRoundContext) {
    return {
      usableForPlayoffBracketSeries: true,
      confidence: fields.scores ? "high" : "medium",
      reason: fields.scores
        ? "Postseason rows include teams, status, dates, round/event context, and scores."
        : "Postseason rows include teams and round/event context, but scores were not present in the sample.",
    }
  }
  if (games.length > 0 && fields.teamNames && fields.status && fields.startsAtDate) {
    return {
      usableForPlayoffBracketSeries: false,
      confidence: "medium",
      reason: "Rows can identify games, but playoff round/series/postseason context is missing or incomplete.",
    }
  }
  return {
    usableForPlayoffBracketSeries: false,
    confidence: "low",
    reason: games.length === 0 ? "No rows returned for this candidate season." : "Rows lack enough team/status/date fields for reliable series mapping.",
  }
}

function summarize(input: {
  provider: string
  sport: Sport
  seasonYear: number
  endpointType: string
  games: NormalizedGame[]
  error?: string
}): ProviderSummary {
  const postseasonRows = input.games.filter(isPostseason).length
  const assessment = assess(input.games, postseasonRows)
  return {
    provider: input.provider,
    sport: input.sport,
    seasonYear: input.seasonYear,
    endpointType: input.endpointType,
    rowsReturned: input.games.length,
    postseasonRowsReturned: postseasonRows,
    firstTeamPairs: input.games.slice(0, 5).map((game) => ({ homeTeam: game.homeTeam, awayTeam: game.awayTeam })),
    fieldsPresent: fieldSummary(input.games),
    ...assessment,
    error: input.error,
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, cache: "no-store" })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json()
}

function rollingInsightsTokenCandidates(): string[] {
  return Array.from(new Set([
    process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim(),
    process.env.ROLLING_INSIGHTS_RSC_TOKEN2?.trim(),
    process.env.RSC_TOKEN?.trim(),
    process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim(),
    process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim(),
  ].filter(Boolean) as string[]))
}

async function auditRollingInsights(sport: Sport, seasonYear: number): Promise<ProviderSummary> {
  const tokens = rollingInsightsTokenCandidates()
  if (tokens.length === 0) {
    return summarize({ provider: "Rolling Insights", sport, seasonYear, endpointType: "schedule-season", games: [], error: "Skipped: no Rolling Insights RSC token env var found." })
  }
  const base = (process.env.ROLLING_INSIGHTS_REST_BASE_URL || "https://rest.datafeeds.rolling-insights.com/api/v1").replace(/\/+$/, "")
  const errors: string[] = []
  for (const token of tokens) {
    try {
      const url = `${base}/schedule-season/${seasonYear}/${sport}?RSC_token=${encodeURIComponent(token)}`
      const payload = await fetchJson(url)
      const rows = flattenRows(payload, [sport, sport.toLowerCase()])
      return summarize({
        provider: "Rolling Insights",
        sport,
        seasonYear,
        endpointType: "schedule-season",
        games: rows.map(normalizeGenericRow),
      })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unknown error")
    }
  }
  return summarize({ provider: "Rolling Insights", sport, seasonYear, endpointType: "schedule-season", games: [], error: `Failed without exposing token: ${errors[0] ?? "unknown error"}` })
}

async function auditClearSports(sport: Sport, seasonYear: number): Promise<ProviderSummary> {
  const apiKey = process.env.CLEARSPORTS_API_KEY?.trim() || process.env.CLEAR_SPORTS_API_KEY?.trim()
  if (!apiKey) {
    return summarize({ provider: "ClearSports", sport, seasonYear, endpointType: "games", games: [], error: "Skipped: CLEARSPORTS_API_KEY is not set." })
  }
  const base = (process.env.CLEARSPORTS_API_BASE || process.env.CLEAR_SPORTS_API_BASE || "https://api.clearsportsapi.com/api/v1").replace(/\/+$/, "")
  const pathSport = sport.toLowerCase()
  const url = `${base}/${pathSport}/games?season=${seasonYear}&season_type=3`
  try {
    const payload = await fetchJson(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "x-api-key": apiKey,
      },
    })
    return summarize({
      provider: "ClearSports",
      sport,
      seasonYear,
      endpointType: "games?season_type=3",
      games: flattenRows(payload, ["games", "data", pathSport]).map(normalizeGenericRow),
    })
  } catch (error) {
    return summarize({
      provider: "ClearSports",
      sport,
      seasonYear,
      endpointType: "games?season_type=3",
      games: [],
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}

async function auditTheSportsDb(sport: Sport, seasonYear: number): Promise<ProviderSummary> {
  const apiKey = process.env.THESPORTSDB_API_KEY?.trim() || process.env.SPORTSDB_API_KEY?.trim() || process.env.THE_SPORTS_DB_API_KEY?.trim() || "3"
  const leagueId = THESPORTSDB_LEAGUE_ID[sport]
  const season = seasonRangeEnding(seasonYear)
  const url = `https://www.thesportsdb.com/api/v1/json/${encodeURIComponent(apiKey)}/eventsseason.php?id=${encodeURIComponent(leagueId)}&s=${encodeURIComponent(season)}`
  try {
    const payload = await fetchJson(url)
    return summarize({
      provider: "TheSportsDB",
      sport,
      seasonYear,
      endpointType: `eventsseason ${season}`,
      games: flattenRows(payload, ["events", "event"]).map(normalizeGenericRow),
    })
  } catch (error) {
    return summarize({
      provider: "TheSportsDB",
      sport,
      seasonYear,
      endpointType: `eventsseason ${season}`,
      games: [],
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}

async function auditEspn(sport: Sport, seasonYear: number): Promise<ProviderSummary> {
  const url = `${ESPN_SITE_API_BASE}/${ESPN_PATH[sport]}/scoreboard`
  try {
    const payload = await fetchJson(url)
    return summarize({
      provider: "ESPN",
      sport,
      seasonYear,
      endpointType: "scoreboard live",
      games: flattenRows(payload, ["events"]).map(normalizeEspnEvent),
    })
  } catch (error) {
    return summarize({
      provider: "ESPN",
      sport,
      seasonYear,
      endpointType: "scoreboard live",
      games: [],
      error: error instanceof Error ? error.message : "Unknown error",
    })
  }
}

function printHuman(summaries: ProviderSummary[]) {
  for (const summary of summaries) {
    console.log(`\n${summary.provider} | ${summary.sport} | season ${summary.seasonYear} | ${summary.endpointType}`)
    console.log(`rows=${summary.rowsReturned} postseasonRows=${summary.postseasonRowsReturned} confidence=${summary.confidence} usable=${summary.usableForPlayoffBracketSeries}`)
    console.log(`reason=${summary.reason}`)
    if (summary.error) console.log(`note=${summary.error}`)
    console.log(`fields=${JSON.stringify(summary.fieldsPresent)}`)
    console.log(`firstPairs=${JSON.stringify(summary.firstTeamPairs)}`)
  }
}

async function main() {
  const baseSeason = Number.parseInt(argValue("--season") ?? "", 10) || new Date().getUTCFullYear()
  const json = process.argv.includes("--json")
  const seasons = candidateSeasons(baseSeason)
  const summaries: ProviderSummary[] = []
  for (const sport of SPORTS) {
    for (const seasonYear of seasons) {
      summaries.push(await auditRollingInsights(sport, seasonYear))
      summaries.push(await auditClearSports(sport, seasonYear))
      summaries.push(await auditTheSportsDb(sport, seasonYear))
    }
    summaries.push(await auditEspn(sport, baseSeason))
  }

  if (json) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), baseSeason, candidateSeasons: seasons, summaries }, null, 2))
  } else {
    console.log(`NBA/NHL playoff provider proof audit generated ${new Date().toISOString()}`)
    console.log(`Candidate seasons: ${seasons.join(", ")}`)
    printHuman(summaries)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
