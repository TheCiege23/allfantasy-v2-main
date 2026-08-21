import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import type { LeagueSport } from '@prisma/client'
import { DEFAULT_SPORT, isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'
import { fetchWithChain } from '@/lib/workers/api-chain'
import { legacySupportedSportToApiChain } from '@/lib/workers/api-config'

export const LIVE_SCORES_FRESHNESS_MS = 60 * 1000

/** ESPN site.api path segments (after sports/) — scoreboard, standings, etc. */
export const ESPN_SPORT_SITE_PATH: Record<LeagueSport, string | null> = {
  NFL: 'football/nfl',
  NBA: 'basketball/nba',
  NHL: 'hockey/nhl',
  MLB: 'baseball/mlb',
  NCAAF: 'football/college-football',
  NCAAB: 'basketball/mens-college-basketball',
  SOCCER: 'soccer/usa.1',
}

export interface LiveScoreRow {
  gameId: string
  homeTeam: string
  homeTeamId?: string | null
  homeTeamFull: string
  homeLogo: string
  homeScore: number
  homeRecord: string | null
  awayTeam: string
  awayTeamId?: string | null
  awayTeamFull: string
  awayLogo: string
  awayScore: number
  awayRecord: string | null
  status: string
  statusDetail: string
  period: number
  clock: string
  completed: boolean
  startTime: string
  venue: string | null
  broadcast: string | null
  odds: string | null
  overUnder: number | null
  week: number | null
  season: number
  /**
   * Best statistical performer in this game, or null when the feed names none
   * (which is normal before kickoff). Never inferred from box-score guesses.
   */
  topPerformer: LiveScoreLeader | null
}

/** One named performer with the feed's own stat line, verbatim. */
export type LiveScoreLeader = {
  name: string
  /** e.g. "18 CAR, 92 YDS, 1 TD" — ESPN's own displayValue, never recomposed. */
  statLine: string
  position: string | null
  headshot: string | null
  /** Which category won: "rushingYards", "passingYards", … */
  category: string | null
}

export interface RollingInsightsScheduleGameRow {
  sport: LeagueSport
  gameId: string
  season: number
  seasonType: string
  eventName: string
  round: number | null
  homeTeam: string
  awayTeam: string
  homeTeamId: string | null
  awayTeamId: string | null
  homeScore: number | null
  awayScore: number | null
  startsAt: string
  status: string
  statusDetail?: string | null
  venue?: string | null
  broadcast?: string | null
  completed: boolean
}

export interface RollingInsightsScheduleShapeDiagnostics {
  httpStatus?: number | null
  contentType?: string | null
  topLevelKeys: string[]
  dataKeys: string[]
  firstItemKeys: string[]
  firstItemSafeFields: Record<string, unknown>
  textPreview?: string | null
  rollingInsightsTokenPresent: boolean
  tokenEnvNameUsed: string | null
  baseUrlUsed: string
  endpointKind: 'schedule-season'
  sanitizedUrl: string
}

export interface RollingInsightsScheduleSeasonResult {
  rows: RollingInsightsScheduleGameRow[]
  diagnostics: RollingInsightsScheduleShapeDiagnostics
}

function asFiniteInt(v: unknown): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : 0
}

function asNullableFiniteInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? n : null
}

/** Map Rolling Insights / chain score rows into the widget contract. */
export function mapChainScoreToLiveScore(raw: Record<string, unknown>, _sport: LeagueSport): LiveScoreRow | null {
  const gameId = String(raw.gameId ?? raw.id ?? raw.game_id ?? raw.externalId ?? '').trim()
  const homeRaw = String(raw.homeTeam ?? raw.home_team ?? raw.home ?? '').trim()
  const awayRaw = String(raw.awayTeam ?? raw.away_team ?? raw.away ?? '').trim()
  if (!gameId || !homeRaw || !awayRaw) return null

  const homeTeam = normalizeTeamAbbrev(homeRaw) || homeRaw
  const awayTeam = normalizeTeamAbbrev(awayRaw) || awayRaw
  const status =
    String(raw.status ?? raw.game_status ?? raw.state ?? 'scheduled') || 'scheduled'
  const dateRaw = raw.date ?? raw.startTime ?? raw.start_time
  const startTime =
    typeof dateRaw === 'string'
      ? dateRaw
      : dateRaw instanceof Date
        ? dateRaw.toISOString()
        : new Date().toISOString()

  return {
    gameId,
    homeTeam,
    homeTeamId: typeof raw.homeTeamId === 'string' ? raw.homeTeamId : typeof raw.home_team_ID === 'string' ? raw.home_team_ID : null,
    homeTeamFull: String(raw.homeTeamFull ?? raw.homeName ?? homeRaw),
    homeLogo: String(raw.homeLogo ?? raw.home_logo ?? ''),
    homeScore: asFiniteInt(raw.homeScore ?? raw.home_score),
    homeRecord: typeof raw.homeRecord === 'string' ? raw.homeRecord : null,
    awayTeam,
    awayTeamId: typeof raw.awayTeamId === 'string' ? raw.awayTeamId : typeof raw.away_team_ID === 'string' ? raw.away_team_ID : null,
    awayTeamFull: String(raw.awayTeamFull ?? raw.awayName ?? awayRaw),
    awayLogo: String(raw.awayLogo ?? raw.away_logo ?? ''),
    awayScore: asFiniteInt(raw.awayScore ?? raw.away_score),
    awayRecord: typeof raw.awayRecord === 'string' ? raw.awayRecord : null,
    status,
    statusDetail: String(raw.statusDetail ?? raw.status ?? status),
    period: asFiniteInt(raw.period ?? raw.periodNumber),
    clock: String(raw.clock ?? raw.displayClock ?? ''),
    completed: Boolean(raw.completed ?? String(status).toLowerCase().includes('final')),
    startTime,
    venue: typeof raw.venue === 'string' ? raw.venue : null,
    broadcast: typeof raw.broadcast === 'string' ? raw.broadcast : null,
    odds: typeof raw.odds === 'string' ? raw.odds : null,
    overUnder: typeof raw.overUnder === 'number' ? raw.overUnder : null,
    week: typeof raw.week === 'number' ? raw.week : raw.week != null ? asFiniteInt(raw.week) : null,
    season:
      typeof raw.season === 'number'
        ? raw.season
        : asFiniteInt(raw.season) || new Date().getFullYear(),
    // This feed carries no per-game leaders. Null says so; it does not borrow
    // one from another game or synthesise it from the box score.
    topPerformer: null,
  }
}

interface ESPNCompetitor {
  team: { abbreviation: string; displayName: string; logo: string; id: string }
  score: string
  homeAway: 'home' | 'away'
  records?: Array<{ summary: string }>
}

/**
 * ESPN's per-category statistical leaders for a game.
 *
 * The scoreboard payload has carried these all along; the mapper simply dropped
 * them, so "who is actually doing something in this game" had no source despite
 * already being fetched and parsed on every poll.
 */
interface ESPNLeaderCategory {
  name?: string
  displayName?: string
  leaders?: Array<{
    displayValue?: string
    value?: number
    athlete?: { displayName?: string; shortName?: string; headshot?: string; position?: { abbreviation?: string } }
  }>
}

interface ESPNCompetition {
  competitors: ESPNCompetitor[]
  status: {
    type: { name: string; shortDetail: string; completed: boolean }
    period: number
    displayClock: string
  }
  leaders?: ESPNLeaderCategory[]
  venue?: { fullName: string }
  odds?: Array<{ details: string; overUnder: number }>
  broadcasts?: Array<{ names: string[] }>
  startDate: string
}

interface ESPNEvent {
  id: string
  date: string
  season: { year: number }
  week?: { number: number }
  competitions: ESPNCompetition[]
}

/**
 * The single most notable performer in a game.
 *
 * ⚠ RANKS BY CATEGORY, NOT BY RAW `value`. ESPN's `value` is in the units of its
 * own category, so comparing them numerically would rank 3 passing touchdowns
 * (3) below 92 rushing yards (92) — the bigger number is simply the one measured
 * in smaller units. The category order below is a fantasy-relevance ordering, and
 * within the winning category the feed's own top leader is taken as-is.
 *
 * ⚠ RETURNS NULL RATHER THAN A BEST GUESS. Before kickoff ESPN sends leaders with
 * no athlete attached; a card showing a name with an empty stat line reads as a
 * data bug, and inventing a line to fill it would be worse.
 */
const LEADER_CATEGORY_PRIORITY = [
  'rushingYards',
  'receivingYards',
  'passingYards',
  'rushingTouchdowns',
  'receivingTouchdowns',
  'passingTouchdowns',
]

function pickTopPerformer(categories: ESPNLeaderCategory[] | undefined): LiveScoreLeader | null {
  if (!Array.isArray(categories) || categories.length === 0) return null

  const ranked = [...categories].sort((a, b) => {
    const ai = LEADER_CATEGORY_PRIORITY.indexOf(String(a.name ?? ''))
    const bi = LEADER_CATEGORY_PRIORITY.indexOf(String(b.name ?? ''))
    // Unlisted categories sort last rather than to the front.
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
  })

  for (const category of ranked) {
    const leader = category.leaders?.[0]
    const name = leader?.athlete?.displayName ?? leader?.athlete?.shortName
    const statLine = leader?.displayValue
    // Both halves required: a name with no line, or a line with no name, is not
    // a performer — it is a partially populated pre-game row.
    if (!name || !statLine) continue
    return {
      name: String(name),
      statLine: String(statLine),
      position: leader?.athlete?.position?.abbreviation ?? null,
      headshot: leader?.athlete?.headshot ?? null,
      category: category.name ?? null,
    }
  }
  return null
}

function formatEspnDate(date: Date): string {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

function dedupeLiveScoreRows(rows: LiveScoreRow[]): LiveScoreRow[] {
  const byId = new Map<string, LiveScoreRow>()
  for (const row of rows) {
    byId.set(row.gameId, row)
  }
  return Array.from(byId.values())
}

export async function fetchEspnScoreboard(
  sport: LeagueSport,
  options: { dates?: string[] } = {},
): Promise<LiveScoreRow[]> {
  const path = ESPN_SPORT_SITE_PATH[sport]
  if (!path) return []

  try {
    const dates = options.dates?.length ? options.dates : [null]
    const rows: LiveScoreRow[] = []
    for (const date of dates) {
      const url = new URL(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard`)
      if (date) url.searchParams.set('dates', date)
      const response = await fetch(url.toString(), { cache: 'no-store' })
      if (!response.ok) continue
      const data = (await response.json()) as { events?: ESPNEvent[] }
      const events = data.events || []
      rows.push(...events.map((event) => {
      const comp = event.competitions[0]
      const home = comp.competitors.find((c) => c.homeAway === 'home')!
      const away = comp.competitors.find((c) => c.homeAway === 'away')!
      return {
        gameId: event.id,
        homeTeam: normalizeTeamAbbrev(home.team.abbreviation) || home.team.abbreviation,
        homeTeamId: home.team.id,
        homeTeamFull: home.team.displayName,
        homeLogo: home.team.logo,
        homeScore: parseInt(home.score, 10) || 0,
        homeRecord: home.records?.[0]?.summary ?? null,
        awayTeam: normalizeTeamAbbrev(away.team.abbreviation) || away.team.abbreviation,
        awayTeamId: away.team.id,
        awayTeamFull: away.team.displayName,
        awayLogo: away.team.logo,
        awayScore: parseInt(away.score, 10) || 0,
        awayRecord: away.records?.[0]?.summary ?? null,
        status: comp.status.type.name,
        statusDetail: comp.status.type.shortDetail,
        period: comp.status.period,
        clock: comp.status.displayClock,
        completed: comp.status.type.completed,
        startTime: comp.startDate || event.date,
        venue: comp.venue?.fullName ?? null,
        broadcast: comp.broadcasts?.[0]?.names?.join(', ') ?? null,
        odds: comp.odds?.[0]?.details ?? null,
        overUnder: comp.odds?.[0]?.overUnder ?? null,
        week: event.week?.number ?? null,
        season: event.season.year,
        topPerformer: pickTopPerformer(comp.leaders),
      }
      }))
    }
    return dedupeLiveScoreRows(rows)
  } catch (e) {
    console.error('[LiveScores] ESPN fetch failed:', sport, e)
    return []
  }
}

export function buildEspnScoreboardDateWindow(days = 7, start = new Date()): string[] {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + index)
    return formatEspnDate(date)
  })
}

export async function fetchRollingInsightsScoreboard(
  sport: LeagueSport,
  options: { forceRefresh?: boolean } = {},
): Promise<LiveScoreRow[]> {
  const chainSport = legacySupportedSportToApiChain(sport)
  const ri = await fetchWithChain({
    sport: chainSport,
    dataType: 'scores',
    query: { season: String(new Date().getFullYear()) },
    forceRefresh: options.forceRefresh === true,
  })

  const rawList = Array.isArray(ri.data) ? ri.data : []
  const fromRi: LiveScoreRow[] = []
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const row = mapChainScoreToLiveScore(item as Record<string, unknown>, sport)
    if (row) fromRi.push(row)
  }
  return fromRi
}

export function mapRollingInsightsScheduleRow(
  raw: Record<string, unknown>,
  sport: LeagueSport,
  seasonYear: number,
): RollingInsightsScheduleGameRow | null {
  const gameId = String(raw.game_ID ?? raw.gameId ?? raw.game_id ?? raw.id ?? raw.externalId ?? '').trim()
  const homeRaw = String(raw.home_team ?? raw.homeTeam ?? raw.home ?? '').trim()
  const awayRaw = String(raw.away_team ?? raw.awayTeam ?? raw.away ?? '').trim()
  if (!gameId || !homeRaw || !awayRaw) return null

  const status = String(raw.status ?? raw.game_status ?? raw.state ?? 'scheduled').trim() || 'scheduled'
  const statusLower = status.toLowerCase()
  const dateRaw = raw.game_time ?? raw.startTime ?? raw.start_time ?? raw.date
  const startsAt =
    typeof dateRaw === 'string'
      ? dateRaw
      : dateRaw instanceof Date
        ? dateRaw.toISOString()
        : ''

  return {
    sport,
    gameId,
    season: asFiniteInt(raw.season ?? raw.season_year) || seasonYear,
    seasonType: String(raw.season_type ?? raw.seasonType ?? '').trim(),
    eventName: String(raw.event_name ?? raw.eventName ?? raw.round_name ?? '').trim(),
    round: asNullableFiniteInt(raw.round),
    homeTeam: homeRaw,
    awayTeam: awayRaw,
    homeTeamId: raw.home_team_ID != null || raw.homeTeamId != null ? String(raw.home_team_ID ?? raw.homeTeamId) : null,
    awayTeamId: raw.away_team_ID != null || raw.awayTeamId != null ? String(raw.away_team_ID ?? raw.awayTeamId) : null,
    homeScore: asNullableFiniteInt(raw.homeScore ?? raw.home_score ?? raw.home_team_score ?? raw.home_points),
    awayScore: asNullableFiniteInt(raw.awayScore ?? raw.away_score ?? raw.away_team_score ?? raw.away_points),
    startsAt,
    status,
    statusDetail: String(raw.statusDetail ?? raw.status_detail ?? raw.game_status_detail ?? raw.status ?? '').trim() || null,
    venue: typeof (raw.venue ?? raw.venue_name ?? raw.site) === 'string' ? String(raw.venue ?? raw.venue_name ?? raw.site) : null,
    broadcast: typeof (raw.broadcast ?? raw.broadcast_network ?? raw.tv ?? raw.network) === 'string' ? String(raw.broadcast ?? raw.broadcast_network ?? raw.tv ?? raw.network) : null,
    completed: statusLower.includes('final') || statusLower.includes('completed'),
  }
}

function collectScheduleItems(value: unknown, sport: LeagueSport): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const obj = value as Record<string, unknown>
  const preferredKeys = [
    sport,
    sport.toLowerCase(),
    sport.toUpperCase(),
    'data',
    'results',
    'items',
    'schedule',
    'games',
  ]
  for (const key of preferredKeys) {
    const nested = obj[key]
    if (Array.isArray(nested)) return nested
    const nestedRows = collectScheduleItems(nested, sport)
    if (nestedRows.length > 0) return nestedRows
  }
  return Object.values(obj).flatMap((nested) => collectScheduleItems(nested, sport))
}

const DEFAULT_ROLLING_INSIGHTS_REST_BASE_URL = 'https://rest.datafeeds.rolling-insights.com/api/v1'

function rollingInsightsScheduleTokenCandidates(): Array<{ name: string; value: string }> {
  return [
    { name: 'ROLLING_INSIGHTS_RSC_TOKEN', value: process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim() ?? '' },
    { name: 'ROLLING_INSIGHTS_RSC_TOKEN2', value: process.env.ROLLING_INSIGHTS_RSC_TOKEN2?.trim() ?? '' },
    { name: 'RSC_TOKEN', value: process.env.RSC_TOKEN?.trim() ?? '' },
    { name: 'ROLLING_INSIGHTS_CLIENT_SECRET', value: process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim() ?? '' },
    { name: 'ROLLING_INSIGHTS_CLIENT_SECRET2', value: process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim() ?? '' },
  ].filter((candidate) => candidate.value)
}

/**
 * Both spellings exist in the wild — README documents them as interchangeable —
 * but they carry DIFFERENT semantics: `ROLLING_INSIGHTS_REST_BASE` is the host
 * root (see lib/sports-data/playerAssetsService.ts) while
 * `ROLLING_INSIGHTS_REST_BASE_URL` already includes `/api/v1`. Reading only the
 * latter meant a deployment configured with the FORMER was silently ignored and
 * fell through to the default — the same class of failure as the ClearSports
 * base-URL override pointing at a host that no longer resolves. Accept either
 * and normalize, matching scripts/force-ri-sport-ingest-pg.mjs.
 */
function rollingInsightsScheduleBaseUrl(): string {
  const raw =
    process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() ||
    process.env.ROLLING_INSIGHTS_REST_BASE?.trim() ||
    DEFAULT_ROLLING_INSIGHTS_REST_BASE_URL
  const trimmed = raw.replace(/\/+$/, '')
  return /\/api\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`
}

export function buildRollingInsightsScheduleSeasonUrl(input: {
  sport: LeagueSport
  seasonYear: number
  token?: string
  redacted?: boolean
}): string {
  const baseUrl = rollingInsightsScheduleBaseUrl()
  const url = new URL(`${baseUrl}/schedule-season/${input.seasonYear}/${input.sport}`)
  url.searchParams.set('RSC_token', input.redacted ? '<redacted>' : input.token ?? '')
  return url.toString()
}

function redactTokens(value: string): string {
  return value.replace(/RSC_token=([^&\s]+)/gi, 'RSC_token=<redacted>')
}

function safeObjectKeys(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>).slice(0, 20)
    : []
}

function firstScheduleItem(value: unknown, sport: LeagueSport): unknown {
  return collectScheduleItems(value, sport)[0] ?? null
}

function scheduleShapeDiagnostics(input: {
  payload: unknown
  sport: LeagueSport
  seasonYear: number
  httpStatus?: number | null
  contentType?: string | null
  textPreview?: string | null
  tokenEnvNameUsed: string | null
  tokenPresent: boolean
}): RollingInsightsScheduleShapeDiagnostics {
  const first = firstScheduleItem(input.payload, input.sport)
  const firstRecord = first && typeof first === 'object' && !Array.isArray(first)
    ? first as Record<string, unknown>
    : {}
  const dataValue = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? (input.payload as Record<string, unknown>).data
    : null
  return {
    httpStatus: input.httpStatus ?? null,
    contentType: input.contentType ?? null,
    topLevelKeys: safeObjectKeys(input.payload),
    dataKeys: safeObjectKeys(dataValue),
    firstItemKeys: Object.keys(firstRecord).slice(0, 30),
    firstItemSafeFields: {
      season_type: firstRecord.season_type,
      season: firstRecord.season,
      status: firstRecord.status,
      event_name: firstRecord.event_name,
      round: firstRecord.round,
      home_team: firstRecord.home_team,
      away_team: firstRecord.away_team,
    },
    textPreview: input.textPreview ? redactTokens(input.textPreview).slice(0, 120) : null,
    rollingInsightsTokenPresent: input.tokenPresent,
    tokenEnvNameUsed: input.tokenEnvNameUsed,
    baseUrlUsed: rollingInsightsScheduleBaseUrl(),
    endpointKind: 'schedule-season',
    sanitizedUrl: buildRollingInsightsScheduleSeasonUrl({ sport: input.sport, seasonYear: input.seasonYear, redacted: true }),
  }
}

export async function fetchRollingInsightsScheduleSeasonWithDiagnostics(
  sport: LeagueSport,
  seasonYear: number,
): Promise<RollingInsightsScheduleSeasonResult> {
  const tokens = rollingInsightsScheduleTokenCandidates()
  if (tokens.length === 0) {
    return {
      rows: [],
      diagnostics: scheduleShapeDiagnostics({
        payload: null,
        sport,
        seasonYear,
        tokenEnvNameUsed: null,
        tokenPresent: false,
        textPreview: 'Missing Rolling Insights RSC token environment variable.',
      }),
    }
  }

  let lastDiagnostics: RollingInsightsScheduleShapeDiagnostics | null = null
  for (const token of tokens) {
    const url = buildRollingInsightsScheduleSeasonUrl({ sport, seasonYear, token: token.value })
    try {
      const response = await fetch(url, { cache: 'no-store' })
      const contentType = response.headers.get('content-type')
      const rawText = await response.text()
      let payload: unknown = rawText
      if (contentType?.toLowerCase().includes('json')) {
        try {
          payload = JSON.parse(rawText)
        } catch {
          payload = rawText
        }
      }
      const rawList = collectScheduleItems(payload, sport)
      const rows: RollingInsightsScheduleGameRow[] = []
      for (const item of rawList) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue
        const row = mapRollingInsightsScheduleRow(item as Record<string, unknown>, sport, seasonYear)
        if (row) rows.push(row)
      }
      lastDiagnostics = scheduleShapeDiagnostics({
        payload,
        sport,
        seasonYear,
        httpStatus: response.status,
        contentType,
        textPreview: typeof payload === 'string' ? payload : rawText,
        tokenEnvNameUsed: token.name,
        tokenPresent: true,
      })
      if (response.ok) {
        return { rows, diagnostics: lastDiagnostics }
      }
    } catch (error) {
      lastDiagnostics = scheduleShapeDiagnostics({
        payload: null,
        sport,
        seasonYear,
        tokenEnvNameUsed: token.name,
        tokenPresent: true,
        textPreview: error instanceof Error ? error.message : 'Request failed',
      })
    }
  }

  return {
    rows: [],
    diagnostics: lastDiagnostics ?? scheduleShapeDiagnostics({
      payload: null,
      sport,
      seasonYear,
      tokenEnvNameUsed: null,
      tokenPresent: tokens.length > 0,
      textPreview: 'No successful Rolling Insights schedule-season response.',
    }),
  }
}

export async function fetchRollingInsightsScheduleSeason(
  sport: LeagueSport,
  seasonYear: number,
  options: { forceRefresh?: boolean } = {},
): Promise<RollingInsightsScheduleGameRow[]> {
  void options
  return (await fetchRollingInsightsScheduleSeasonWithDiagnostics(sport, seasonYear)).rows
}

async function syncLiveScoresToDb(sport: LeagueSport, scores: LiveScoreRow[], source: string): Promise<number> {
  let synced = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + LIVE_SCORES_FRESHNESS_MS * 5)

  for (const score of scores) {
    try {
      await prisma.sportsGame.upsert({
        where: {
          sport_externalId_source: {
            sport,
            externalId: score.gameId,
            source,
          },
        },
        update: {
          homeTeam: score.homeTeam,
          awayTeam: score.awayTeam,
          homeScore: score.homeScore,
          awayScore: score.awayScore,
          status: score.statusDetail,
          startTime: new Date(score.startTime),
          venue: score.venue,
          week: score.week,
          season: score.season,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport,
          externalId: score.gameId,
          homeTeam: score.homeTeam,
          awayTeam: score.awayTeam,
          homeScore: score.homeScore,
          awayScore: score.awayScore,
          status: score.statusDetail,
          startTime: new Date(score.startTime),
          venue: score.venue,
          week: score.week,
          season: score.season,
          source,
          fetchedAt: now,
          expiresAt,
        },
      })
      synced++
    } catch (err) {
      console.error(`[LiveScores] Failed to sync game ${score.gameId}:`, err)
    }
  }

  return synced
}

/**
 * The cached DB fallback. `SportsGame` stores no per-game leaders, so
 * `topPerformer` is null here — the row is a real score with one fewer field,
 * not a reason to invent a performer from a table that does not have one.
 */
function dbRowToLiveScore(g: {
  externalId: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | null
  venue: string | null
  week: number | null
  season: number | null
  fetchedAt: Date
}): LiveScoreRow {
  return {
    gameId: g.externalId,
    homeTeam: g.homeTeam,
    homeTeamFull: g.homeTeam,
    homeLogo: '',
    homeScore: g.homeScore ?? 0,
    homeRecord: null,
    awayTeam: g.awayTeam,
    awayTeamFull: g.awayTeam,
    awayLogo: '',
    awayScore: g.awayScore ?? 0,
    awayRecord: null,
    status: g.status ?? 'STATUS_SCHEDULED',
    statusDetail: g.status ?? 'Scheduled',
    period: 0,
    clock: '0:00',
    completed: (g.status ?? '').toLowerCase().includes('final'),
    startTime: g.startTime?.toISOString() ?? '',
    venue: g.venue,
    broadcast: null,
    odds: null,
    overUnder: null,
    week: g.week,
    season: g.season ?? new Date().getFullYear(),
    topPerformer: null,
  }
}

async function readCachedLiveScoreRows(options: {
  sport: LeagueSport
  team?: string | null
}) {
  const team = options.team?.trim() || null
  return prisma.sportsGame.findMany({
    where: {
      sport: options.sport,
      // `api_sports` is written every 2 minutes by the import-scores cron and is both the
      // freshest and most-complete source in production (335/335 rows carry score+status+start,
      // newest 2026-07-21; vs rolling_insights 497/3010 with scores, newest 2026-05-19). It was
      // omitted only because this filter (2026-04-14) predates the api_sports cron (2026-06-09)
      // — an oversight, not a data-quality exclusion. `thesportsdb`/`e2e` stay out: null scores.
      source: { in: ['rolling_insights', 'espn_live', 'api_sports'] },
      ...(team
        ? {
            OR: [
              { homeTeam: normalizeTeamAbbrev(team) || team },
              { awayTeam: normalizeTeamAbbrev(team) || team },
            ],
          }
        : {}),
    },
    orderBy: { startTime: 'asc' },
  })
}

export async function getCachedLiveScoresForSport(options: {
  sport: string
  team?: string | null
}): Promise<{
  scores: LiveScoreRow[]
  source: string
  refreshed: false
  hasLiveGames: boolean
  nextRefreshMs: number
  fetchedAt: string | null
  lastSyncedAt: string | null
  isStale: boolean
  message: string | null
}> {
  const sport = normalizeToSupportedSport(options.sport)
  const team = options.team?.trim() || null
  const cachedGames = await readCachedLiveScoreRows({ sport, team })
  const preferredRi = cachedGames.filter((g) => g.source === 'rolling_insights')
  const useRows = preferredRi.length > 0 ? preferredRi : cachedGames
  const scores = useRows.map(dbRowToLiveScore)
  const now = Date.now()
  const latestFetched =
    cachedGames
      .map((g) => g.fetchedAt)
      .filter((value): value is Date => Boolean(value))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const isStale =
    cachedGames.length > 0 &&
    cachedGames.some((g) => g.fetchedAt && now - g.fetchedAt.getTime() > LIVE_SCORES_FRESHNESS_MS)
  const hasLiveGames = scores.some(
    (s) => s.status === 'STATUS_IN_PROGRESS' || s.status === 'STATUS_HALFTIME'
  )

  return {
    scores,
    source: useRows[0]?.source === 'rolling_insights' ? 'db_cache_ri' : 'db_cache',
    refreshed: false,
    hasLiveGames,
    nextRefreshMs: hasLiveGames ? LIVE_SCORES_FRESHNESS_MS : LIVE_SCORES_FRESHNESS_MS * 5,
    fetchedAt: latestFetched?.toISOString() ?? null,
    lastSyncedAt: latestFetched?.toISOString() ?? null,
    isStale,
    message:
      cachedGames.length === 0
        ? `No cached ${sport} live scores are available yet.`
        : isStale
          ? 'Cached live scores are stale. Admin/cron sync must refresh provider data.'
          : null,
  }
}

/**
 * DB-first live scores: prefer Rolling Insights (`fetchWithChain` scores), then ESPN, persisted under distinct `source` keys.
 */
export async function getLiveScoresForSport(options: {
  sport: string
  team?: string | null
  forceRefresh?: boolean
  /**
   * Try ESPN before Rolling Insights on refresh.
   *
   * ⚠ RI "HAS ROWS" IS NOT THE SAME AS RI "HAS A LIVE SLATE". For NFL its
   * scoreboard returns the ENTIRE SEASON with no scores, no clock, no logos and
   * no records — enough rows to satisfy the default `length > 0` check and win
   * the race, while carrying none of the fields a live surface renders. Callers
   * that need live game state opt into ESPN first; every existing caller keeps
   * the RI-first order untouched, because their data is fine and changing it
   * under them is not this flag's job.
   */
  preferEspn?: boolean
}): Promise<{
  scores: LiveScoreRow[]
  source: string
  refreshed: boolean
  hasLiveGames: boolean
  nextRefreshMs: number
  fetchedAt: string | null
}> {
  const sport = normalizeToSupportedSport(options.sport)
  const team = options.team?.trim() || null
  const refresh = options.forceRefresh === true

  const cachedGames = await readCachedLiveScoreRows({ sport, team })

  const now = new Date()
  const stale =
    cachedGames.length === 0 ||
    cachedGames.some(
      (g) => g.fetchedAt && now.getTime() - g.fetchedAt.getTime() > LIVE_SCORES_FRESHNESS_MS
    )

  let scores: LiveScoreRow[] = []
  let refreshed = false
  let source: string = 'db_cache'
  let fetchedAt: string | null = cachedGames[0]?.fetchedAt?.toISOString() ?? null

  if (refresh || stale) {
    /*
     * Both branches persist through `syncLiveScoresToDb`, so whichever feed wins,
     * the next reader is served from the database. That is the point of routing
     * every provider read through this function instead of letting a page fetch
     * a scoreboard on its own request path.
     */
    const order: Array<'rolling_insights' | 'espn_live'> = options.preferEspn
      ? ['espn_live', 'rolling_insights']
      : ['rolling_insights', 'espn_live']

    for (const candidate of order) {
      const rows =
        candidate === 'rolling_insights'
          ? await fetchRollingInsightsScoreboard(sport, { forceRefresh: refresh })
          : await fetchEspnScoreboard(sport)
      if (rows.length === 0) continue
      await syncLiveScoresToDb(sport, rows, candidate)
      scores = rows
      refreshed = true
      source = candidate
      fetchedAt = new Date().toISOString()
      break
    }
  }

  if (scores.length === 0) {
    const preferredRi = cachedGames.filter((g) => g.source === 'rolling_insights')
    const useRows = preferredRi.length > 0 ? preferredRi : cachedGames
    scores = useRows.map(dbRowToLiveScore)
    source = useRows[0]?.source === 'rolling_insights' ? 'db_cache_ri' : 'db_cache'
    fetchedAt = useRows[0]?.fetchedAt?.toISOString() ?? null
  }

  const filtered = team
    ? scores.filter((s) => {
        const norm = normalizeTeamAbbrev(team) || team
        return s.homeTeam === norm || s.awayTeam === norm
      })
    : scores

  const hasLiveGames = filtered.some(
    (s) => s.status === 'STATUS_IN_PROGRESS' || s.status === 'STATUS_HALFTIME'
  )

  return {
    scores: filtered,
    source,
    refreshed,
    hasLiveGames,
    nextRefreshMs: hasLiveGames ? LIVE_SCORES_FRESHNESS_MS : LIVE_SCORES_FRESHNESS_MS * 5,
    fetchedAt,
  }
}

export function parseSportQueryParam(raw: string | null | undefined): LeagueSport {
  if (!raw || raw.trim() === '') return DEFAULT_SPORT
  const u = raw.trim().toUpperCase()
  if (isSupportedSport(u)) return normalizeToSupportedSport(u)
  return DEFAULT_SPORT
}
