import 'server-only'

import { prisma } from '@/lib/prisma'
import { redactSecrets } from '@/lib/security/redactSecrets'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import type { LeagueSport } from '@prisma/client'
import { DEFAULT_SPORT, isSupportedSport, normalizeToSupportedSport } from '@/lib/sport-scope'
import { fetchWithChain } from '@/lib/workers/api-chain'
import { legacySupportedSportToApiChain } from '@/lib/workers/api-config'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'
import { normalizeGameStatus, type CanonicalGameStatus } from '@/lib/scores/gameScoreProviders'
import { loadCollegeTeamIndex } from '@/lib/sport-teams/collegeTeamIndexStore'
import { resolveCollegeTeam } from '@/lib/sport-teams/collegeTeamIdentity'

export const LIVE_SCORES_FRESHNESS_MS = 60 * 1000

/**
 * The widget contract speaks ESPN's status vocabulary — `ScoresTab.tsx` and
 * `LiveScoringWidget.tsx` both branch on the literal `STATUS_IN_PROGRESS` /
 * `STATUS_HALFTIME`. Rows coming back out of `SportsGame` do NOT: every writer
 * puts its own spelling in that column ("Match Finished" from TheSportsDB,
 * "8/27 - 7:00 PM EDT" from the ESPN live sync, lowercase "scheduled" from
 * others). Mapping through the canonical vocabulary is what lets a cached row
 * light the live badge at all — a raw display string can never equal
 * `STATUS_IN_PROGRESS`, so before this the DB fallback reported zero live games
 * no matter what was actually being played.
 */
const CANONICAL_TO_ESPN_STATUS: Record<CanonicalGameStatus, string> = {
  scheduled: 'STATUS_SCHEDULED',
  in_progress: 'STATUS_IN_PROGRESS',
  final: 'STATUS_FINAL',
  postponed: 'STATUS_POSTPONED',
  canceled: 'STATUS_CANCELED',
}

/** Human label for the cached view, which has no clock to show. */
const CANONICAL_STATUS_LABEL: Record<CanonicalGameStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  final: 'Final',
  postponed: 'Postponed',
  canceled: 'Canceled',
}

/**
 * ESPN's own `type.name` tokens, for READING. These arrive on the live fetch
 * path and still sit in rows written before this module stopped storing them;
 * they are deliberately NOT what gets written now — see `syncLiveScoresToDb`
 * for why the lowercase canonical vocabulary goes into the column instead.
 *
 * The shared `normalizeGameStatus` covers most of them incidentally
 * ("status_final" is in its final list, "STATUS_HALFTIME" is caught by its
 * `includes('half')` rule), but not all: `STATUS_END_PERIOD` matches none of
 * its patterns and would come back null — i.e. a game between quarters would be
 * read as "not started yet" and have its score nulled out. Mapping the vendor's
 * own vocabulary explicitly is cheaper than widening a shared helper that four
 * other providers depend on.
 */
const ESPN_STATUS_TOKENS: Record<string, CanonicalGameStatus> = {
  STATUS_SCHEDULED: 'scheduled',
  STATUS_PRE: 'scheduled',
  STATUS_IN_PROGRESS: 'in_progress',
  STATUS_HALFTIME: 'in_progress',
  STATUS_END_PERIOD: 'in_progress',
  STATUS_END_OF_EXTRATIME: 'in_progress',
  STATUS_OVERTIME: 'in_progress',
  STATUS_FINAL: 'final',
  STATUS_FINAL_OT: 'final',
  STATUS_FULL_TIME: 'final',
  STATUS_POSTPONED: 'postponed',
  STATUS_DELAYED: 'postponed',
  STATUS_RAIN_DELAY: 'postponed',
  STATUS_SUSPENDED: 'postponed',
  STATUS_CANCELED: 'canceled',
  STATUS_FORFEIT: 'canceled',
  STATUS_ABANDONED: 'canceled',
}

/**
 * Short vendor codes, mostly TheSportsDB's soccer vocabulary.
 *
 * Measured against all 25,586 production rows: without these, 186 of them —
 * `AP` (128), `CANC` (52), `PST` (6) — resolve to nothing and their games
 * become undeterminable on the live tab. They are NOT exotic: every one of them
 * is already in `lib/sports/gameStatus.ts`'s sets. The two normalizers simply
 * have complementary blind spots, which is the hazard of having three of them
 * and the reason this layer consults more than one.
 */
const VENDOR_SHORT_CODES: Record<string, CanonicalGameStatus> = {
  AP: 'final', // after penalties
  AET: 'final', // after extra time
  PEN: 'final',
  F: 'final',
  'F/OT': 'final',
  AWARDED: 'final',
  CANC: 'canceled',
  ABD: 'canceled', // abandoned
  AWD: 'canceled', // awarded / walkover
  WO: 'canceled',
  PST: 'postponed',
  SUSP: 'postponed',
  INT: 'postponed', // interrupted
}

/**
 * A period marker carrying a running clock — "Q2 5:43", "OT 1:12", "2nd 0:48".
 * The shared normalizer only matches a bare period ("Q2"), so the far more
 * common form with the clock attached fell through to null.
 *
 * ⚠ ORDER MATTERS. This is applied ONLY after `normalizeGameStatus` has
 * declined, which is what keeps a kickoff time out of it: "8/27 - 7:00 PM EDT"
 * is claimed by that function's date/meridiem rule and never reaches here. Run
 * these patterns first and every scheduled game with a time on it would be
 * reported as being played right now.
 */
const IN_PLAY_CLOCK_PATTERNS = [
  /^(q[1-4]|p[1-3]|ot\d*)\b/,
  /^\d{1,2}(st|nd|rd|th)\b/,
  /^(end|start)\s+(of\s+)?(q[1-4]|\d(st|nd|rd|th))/,
]

/** ESPN's vocabulary first, then the cross-provider one. Null when neither knows. */
export function resolveGameState(rawStatus: unknown): CanonicalGameStatus | null {
  const raw = String(rawStatus ?? '').trim()
  if (!raw) return null

  const upper = raw.toUpperCase()
  const espn = ESPN_STATUS_TOKENS[upper] ?? VENDOR_SHORT_CODES[upper]
  if (espn) return espn

  const shared = normalizeGameStatus(rawStatus)
  if (shared) return shared

  const v = raw.toLowerCase()
  if (IN_PLAY_CLOCK_PATTERNS.some((re) => re.test(v))) return 'in_progress'

  return null
}

/**
 * True once the ball is in play — the gate for whether a score is a real
 * observation or a placeholder. Deliberately conservative: an unrecognised
 * status returns false, so an unknown vocabulary parks a score at NULL rather
 * than minting a 0-0 nobody measured.
 */
export function hasStarted(rawStatus: unknown): boolean {
  const state = resolveGameState(rawStatus)
  return state === 'in_progress' || state === 'final'
}

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
  /**
   * NULL means "we have no score for this game", NEVER zero.
   *
   * ⚠ THIS FIELD WAS `number`, AND THAT TYPE FORCED THE LIE. The column it is
   * built from is nullable, so `dbRowToLiveScore` had to write `?? 0` to
   * satisfy it — the last unguarded fake zero on this path. Measured
   * 2026-08-29: 47 NFL rows carry status `final` with both scores NULL, 14 of
   * them inside the live window, and every one arrived at a consumer as a 0-0
   * result. `SportsScheduleContextProvider` was already writing
   * `row.homeScore ?? null` for Chimmy — dead code against the old type, and a
   * plain statement that the author expected a null this type refused to allow.
   *
   * A 0-0 is a RESULT. Null is "not played, or not captured". Every other
   * consumer of this shape was already null-safe; the type was the outlier.
   */
  homeScore: number | null
  homeRecord: string | null
  awayTeam: string
  awayTeamId?: string | null
  awayTeamFull: string
  awayLogo: string
  awayScore: number | null
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
      const url = new URL(`${ESPN_SITE_API_BASE}/${path}/scoreboard`)
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

/**
 * Delegates to the shared redactor. This used to strip only `RSC_token=`, so a diagnostic preview
 * carrying any other credential — a bearer header, a connection string — was stored verbatim.
 */
function redactTokens(value: string): string {
  return redactSecrets(value)
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
      // ⚠ TWO THINGS THAT LOOK LIKE DATA AND ARE NOT.
      //
      // 1. `status` used to be written from `statusDetail`, which for an
      //    unstarted game is ESPN's DISPLAY string ("8/27 - 7:00 PM EDT") and
      //    during play is a clock ("Q2 5:43"). That is a caption, not a state,
      //    and it made every cached row invisible to the live-game check.
      //    `score.status` is ESPN's own `type.name` and is what belongs here.
      //
      // 2. ESPN sends "0" for both sides of a game that has not kicked off, so
      //    the old write stamped a real-looking 0-0 on every future fixture —
      //    measured on production: 72 scheduled NCAAF rows, all 0-0, plus the
      //    whole NFL preseason slate. NULL is the honest value for a score
      //    nobody has taken yet, and it is what lets a reader tell "0-0 in the
      //    first quarter" apart from "has not started".
      //
      // ⚠ WRITE THE LOWERCASE CANONICAL STATE, NOT ESPN'S TOKEN. Three separate
      //   normalizers read this column and they do NOT agree:
      //     lib/sports/gameStatus.ts        — Chimmy's slate grounding
      //     lib/scores/gameScoreProviders   — this module
      //     lib/sports-data-gateway/runtime/lock
      //   Only the middle one recognises `STATUS_FINAL`; the first returns
      //   'unknown' for it, which would have made Chimmy report every finished
      //   game as a game it could not read. 'final' / 'scheduled' /
      //   'in_progress' / 'postponed' / 'canceled' are understood by all three,
      //   so that is the vocabulary that goes in the database. An unresolvable
      //   status is passed through verbatim rather than defaulted, so a new
      //   vendor spelling stays visible instead of being laundered into a state
      //   nobody observed.
      const state = resolveGameState(score.status)
      const statusForDb = state ?? score.status

      const started = state === 'in_progress' || state === 'final'
      const homeScore = started ? score.homeScore : null
      const awayScore = started ? score.awayScore : null

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
          homeScore,
          awayScore,
          status: statusForDb,
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
          homeScore,
          awayScore,
          status: statusForDb,
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
/**
 * Fill crests on rows that came from the database.
 *
 * `dbRowToLiveScore` returns empty logo strings because `SportsGame` stores no
 * logo — on the LIVE path they arrive inside ESPN's own payload, so only the
 * cached path is blank. That is the whole gap: a slate served from cache had no
 * crests at all.
 *
 * ⚠ NCAAF ONLY, AND BY DESIGN. College is where team naming actually fractures:
 * the 10-day slate carries 1,527 distinct strings for ~660 teams across three
 * conventions at once. The professional leagues use one stable abbreviation set
 * and do not need this.
 *
 * Never throws and never fetches. No index, no match, or a store failure all
 * leave the logo exactly as it was — an empty crest is cosmetic, a scoreboard
 * that fails to render is not.
 */
/**
 * Fill crest and school name from the team directory, for rows that lack them.
 *
 * ⚠ FILLS GAPS, NEVER OVERWRITES. A live ESPN row already carries both, and its
 * spelling is the one the rest of the card is built from.
 *
 * The name half exists because a database row has no full name to carry:
 * `dbRowToLiveScore` sets `homeTeamFull` from `homeTeam`, and `espn_live` stores
 * abbreviations — so the seven fixtures restored by `withOmittedFixtures` read
 * "MEM", "NMSU", "JVST" beside a live row reading "San José State Spartans".
 * The directory has already been consulted for the crest at that point, and the
 * resolved record carries `school`; not using it was leaving the answer on the
 * floor. `homeTeamFull === homeTeam` is the tell that a row never had a
 * distinct full name, rather than one that happens to match.
 */
async function withCollegeTeamIdentity(
  sport: LeagueSport,
  scores: LiveScoreRow[],
): Promise<LiveScoreRow[]> {
  if (sport !== 'NCAAF' || scores.length === 0) return scores
  const incomplete = scores.some(
    (s) =>
      !s.homeLogo ||
      !s.awayLogo ||
      s.homeTeamFull === s.homeTeam ||
      s.awayTeamFull === s.awayTeam,
  )
  if (!incomplete) return scores

  const index = await loadCollegeTeamIndex()
  if (!index) return scores

  return scores.map((s) => {
    const home = resolveCollegeTeam(s.homeTeamFull || s.homeTeam, index)
    const away = resolveCollegeTeam(s.awayTeamFull || s.awayTeam, index)
    return {
      ...s,
      homeLogo: s.homeLogo || home?.logo || '',
      awayLogo: s.awayLogo || away?.logo || '',
      homeTeamFull:
        s.homeTeamFull !== s.homeTeam ? s.homeTeamFull : (home?.school ?? s.homeTeamFull),
      awayTeamFull:
        s.awayTeamFull !== s.awayTeam ? s.awayTeamFull : (away?.school ?? s.awayTeamFull),
    }
  })
}

/**
 * The stored status, but only when it is something worth showing a person.
 *
 * ⚠ OUR OWN VOCABULARY IS A MACHINE TOKEN TOO. This branch exists to keep a
 * human-readable vendor string ("Q2 5:43", "8/27 - 7:00 PM EDT") rather than
 * flatten it to a label — but it only excluded ESPN's `STATUS_*` spelling, so
 * the canonical lowercase words this module WRITES sailed straight through and
 * a card read "scheduled". Both spellings are tokens; neither belongs on screen.
 */
function rawStatusCaption(status: string | null, state: CanonicalGameStatus): string | null {
  const raw = status?.trim()
  if (!raw) return null
  if (raw === CANONICAL_TO_ESPN_STATUS[state]) return null
  if (Object.hasOwn(CANONICAL_STATUS_LABEL, raw)) return null
  return raw
}

export function dbRowToLiveScore(g: {
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
  // Every writer spells this column differently, so translate through the
  // canonical vocabulary instead of comparing raw strings. Without this a
  // TheSportsDB "Match Finished" row and an in-play "Q2 5:43" row both fail
  // every `STATUS_*` check in the UI and fall through to `statusLabel`'s
  // default branch — which renders a played game as UPCOMING with an em-dash
  // where the score should be. Unrecognised stays scheduled, which is the
  // pre-existing default and the safe one.
  const state = resolveGameState(g.status) ?? 'scheduled'

  return {
    gameId: g.externalId,
    homeTeam: g.homeTeam,
    homeTeamFull: g.homeTeam,
    homeLogo: '',
    // Carried through, not defaulted. The column is nullable because the score
    // genuinely can be unknown; `?? 0` turned that into a 0-0 result.
    homeScore: g.homeScore,
    homeRecord: null,
    awayTeam: g.awayTeam,
    awayTeamFull: g.awayTeam,
    awayLogo: '',
    awayScore: g.awayScore,
    awayRecord: null,
    status: CANONICAL_TO_ESPN_STATUS[state],
    // The cached row carries no clock, so the raw string is the better caption
    // when it is human-readable ("Q2 5:43", "8/27 - 7:00 PM EDT"). Fall back to
    // the canonical label rather than echoing a machine token at the user.
    //
    // ⚠ A SCHEDULED ROW IS THE CASE THAT FELL THROUGH. Its stored status is the
    // literal token `scheduled`, which differs from `STATUS_SCHEDULED`, so the
    // pass-through branch printed a machine token — the exact thing the comment
    // above says it avoids. Worse, it hid a kickoff time we hold: seven
    // restored fixtures read "scheduled" beside a live row reading
    // "8/29 - 3:00 PM EDT". The time we know is the better caption.
    statusDetail:
      (state === 'scheduled' ? kickoffCaption(g.startTime) : null) ??
      (rawStatusCaption(g.status, state) ?? CANONICAL_STATUS_LABEL[state]),
    period: 0,
    clock: '0:00',
    completed: state === 'final',
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

/**
 * Which feed wins when several have rows for the same sport.
 *
 * Earlier entries win, but ONLY among sources that are actually current. A
 * preference list alone is not enough: `espn_live` still holds 8 NCAAF rows
 * from 2026-04-26 carrying 0-0, and ranking it above TheSportsDB would show a
 * scoreboard of nil-nils while the real scores sat one row over.
 */
const LIVE_SOURCE_PREFERENCE = ['rolling_insights', 'api_sports', 'espn_live', 'thesportsdb'] as const

/** A feed silent this long is treated as dead, whatever its rank. */
const LIVE_SOURCE_DEAD_AFTER_MS = 6 * 60 * 60 * 1000

/**
 * Feeds updated within this window of each other are treated as equally fresh,
 * and the preference order decides between them. Wider than the 60s refresh so
 * normal jitter between two healthy feeds does not flip the slate back and
 * forth mid-game; far narrower than the 6h dead-feed cutoff, which is a
 * liveness floor rather than a "still worth preferring" test.
 */
const LIVE_SOURCE_STALENESS_BUCKET_MS = 5 * 60 * 1000

type SourcedRow = { source: string | null; fetchedAt: Date | null }

/**
 * Pick one source's rows — never a blend.
 *
 * Mixing sources is what produces a scoreboard where the same fixture appears
 * two or three times with different scores: this table deliberately keeps one
 * row PER SOURCE per game, so an un-deduped read shows a game once per feed.
 */
export function pickFreshestSourceRows<T extends SourcedRow>(rows: T[], now = Date.now()): T[] {
  if (rows.length === 0) return rows

  const bySource = new Map<string, { rows: T[]; newest: number }>()
  for (const row of rows) {
    const key = row.source ?? ''
    const stamp = row.fetchedAt ? row.fetchedAt.getTime() : 0
    const entry = bySource.get(key)
    if (entry) {
      entry.rows.push(row)
      if (stamp > entry.newest) entry.newest = stamp
    } else {
      bySource.set(key, { rows: [row], newest: stamp })
    }
  }

  const all = [...bySource.entries()]
  // Prefer live feeds; fall back to everything only if none is current, so a
  // fully stale sport still renders something rather than an empty screen.
  const live = all.filter(([, v]) => now - v.newest <= LIVE_SOURCE_DEAD_AFTER_MS)
  const pool = live.length > 0 ? live : all

  const rank = (source: string): number => {
    const i = (LIVE_SOURCE_PREFERENCE as readonly string[]).indexOf(source)
    return i === -1 ? LIVE_SOURCE_PREFERENCE.length : i
  }

  // ⚠ FRESHNESS OUTRANKS PREFERENCE, IN BUCKETS.
  //
  // Rank alone put a feed three hours cold ahead of one two seconds old.
  // Measured mid-game on 2026-08-27: rolling_insights held the NFL slate as
  // `scheduled` with no scores from 00:30Z while espn_live had PIT 14 BUF 3 in
  // the second quarter — and rolling_insights is rank 0, so it won. Both were
  // inside the 6h dead-feed window, so that guard never fired. The scoreboard
  // showed kickoff times for a game that was on television.
  //
  // Live scoring is a recency problem before it is a preference problem. Rank
  // still decides between feeds updated at about the same time, which is what
  // the preference list is actually for; it no longer overrides a feed that has
  // simply stopped reporting.
  const bucket = (newest: number): number =>
    Math.floor(Math.max(0, now - newest) / LIVE_SOURCE_STALENESS_BUCKET_MS)

  pool.sort(
    (a, b) =>
      bucket(a[1].newest) - bucket(b[1].newest) ||
      rank(a[0]) - rank(b[0]) ||
      b[1].newest - a[1].newest,
  )

  return pool[0]![1].rows
}

/**
 * How far either side of now a row can sit and still be "live scores".
 *
 * ⚠ THIS QUERY WAS UNBOUNDED, AND WIDENING THE SOURCE LIST MADE THAT FATAL.
 * With only rolling_insights/espn_live/api_sports it returned a few hundred rows
 * per sport. Adding `thesportsdb` took NCAAF to 2,940 and MLB to 8,185 — roughly
 * 21,000 rows across the seven sports the live page loads in one `Promise.all`,
 * every one of them carrying the `raw` provider blob because there was no
 * `select`. That is what took `/live` down to its error boundary.
 *
 * Two bounds fix it, and both are things this query should always have had: ask
 * for the columns the mapper actually reads, and ask only for games near now. A
 * live scoreboard has no use for last season's results.
 */
const LIVE_WINDOW_PAST_MS = 48 * 60 * 60 * 1000
const LIVE_WINDOW_FUTURE_MS = 21 * 24 * 60 * 60 * 1000

/**
 * A KICKOFF NOBODY HAS ANNOUNCED IS NOT MIDNIGHT.
 *
 * College fixtures are published months before their start time is set, and
 * ESPN carries the undecided ones at midnight Eastern. Our writer stored that
 * midnight as though it were a real kickoff — the timestamp version of the 0-0
 * this module already refuses to write, and it fails the same way: silently,
 * and as an observation rather than a gap.
 *
 * Measured on production 2026-08-29: 72 `espn_live` NCAAF rows sat at exactly
 * 00:00 ET, 65 of them still in the future, spanning 08-29 to 09-05 — plus 429
 * `cfbd` rows. Seven were that Saturday's FBS slate (UNC @ TCU, NC State @
 * Virginia, Hawai'i @ Stanford, Memphis @ UNLV, NMSU @ FSU, Jax State @ NDSU,
 * Sac State @ EMU). The live page's slate window opens at now-6h; midnight ET
 * is two hours before that, so a nine-game Saturday rendered as one game.
 *
 * ⚠ NCAAF ONLY, AND ONLY WHERE ANOTHER FEED ALREADY KNOWS. Every midnight-ET
 * row in the table is college football — no NFL, NBA, MLB or NHL row has one —
 * which is what makes this the college TBD convention rather than a parsing
 * bug. Nothing here guesses a time: a placeholder is replaced only by a real
 * kickoff carried on the SAME ESPN event id by a schedule feed. A fixture
 * nobody has timed keeps its placeholder and stays out of the slate, because
 * "we do not know when this starts" is the honest answer in that case.
 */
const PLACEHOLDER_KICKOFF_SPORTS = new Set<string>(['NCAAF'])

/**
 * Schedule authorities, consulted for start times and NOTHING else.
 *
 * ⚠ DELIBERATELY NOT ADDED TO THE `source` FILTER BELOW. `espn` and `cfbd` hold
 * 74 NCAAF rows for a single Saturday against `espn_live`'s 8, because they
 * carry Division II and III — Chowan, Thomas More, Wheeling. They are the right
 * answer to "when does 401856766 start" and the wrong answer to "what is on
 * today's slate", so they are read here and never enter the source pool that
 * `pickFreshestSourceRows` chooses from.
 *
 * The join is exact and needs no name matching: all three ESPN-derived feeds
 * key on the ESPN event id (401856766 is UNC @ TCU in every one of them).
 * TheSportsDB is absent because it does not — its ids look like 2498571.
 */
const KICKOFF_DONOR_SOURCES = ['espn', 'cfbd'] as const

const ET_HOUR_MINUTE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/**
 * ESPN's own caption format, so a row rebuilt from the database reads like a
 * row the live feed supplied. Eastern because that is what the live feed's
 * string already says, and a scoreboard that mixes zones is worse than one that
 * picks the sport's.
 *
 * ⚠ RETURNS NULL FOR AN UNANNOUNCED KICKOFF rather than printing midnight. A
 * placeholder that reached this point unrepaired — no schedule feed knew the
 * time — must not be dressed up as "12:00 AM EDT"; the caller falls back to
 * "Scheduled", which is what we actually know. The check is deliberately
 * sport-independent: this asks whether the timestamp is worth PRINTING, and a
 * genuine midnight-Eastern kickoff in any sport is rare enough that showing
 * "Scheduled" for one costs nothing next to inventing a time for the others.
 */
function kickoffCaption(at: Date | null): string | null {
  if (!at || Number.isNaN(at.getTime())) return null
  if (ET_HOUR_MINUTE.format(at) === '00:00') return null
  const part: Record<string, string> = {}
  for (const p of ET_KICKOFF_CAPTION.formatToParts(at)) part[p.type] = p.value
  if (!part.month || !part.day || !part.hour || !part.minute) return null
  const zone = part.timeZoneName ? ` ${part.timeZoneName}` : ''
  const period = part.dayPeriod ? ` ${part.dayPeriod}` : ''
  return `${part.month}/${part.day} - ${part.hour}:${part.minute}${period}${zone}`
}

const ET_KICKOFF_CAPTION = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

/** True when a start time is ESPN's "kickoff not announced" placeholder. */
export function isPlaceholderKickoff(sport: string, startTime: Date | null): boolean {
  if (!startTime || Number.isNaN(startTime.getTime())) return false
  if (!PLACEHOLDER_KICKOFF_SPORTS.has(sport)) return false
  return ET_HOUR_MINUTE.format(startTime) === '00:00'
}

type KickoffRepairable = {
  externalId: string
  startTime: Date | null
  fetchedAt: Date | null
}

/**
 * Fill placeholder kickoffs from a schedule feed. Never invents, never widens
 * the row set, and returns the input untouched when there is nothing to fix —
 * including the common case, so the extra query is not paid on every load.
 */
async function repairPlaceholderKickoffs<T extends KickoffRepairable>(
  sport: string,
  rows: T[],
): Promise<T[]> {
  if (!PLACEHOLDER_KICKOFF_SPORTS.has(sport)) return rows
  const broken = rows.filter((r) => isPlaceholderKickoff(sport, r.startTime))
  if (broken.length === 0) return rows

  const donors = await prisma.sportsGame.findMany({
    select: { externalId: true, startTime: true, fetchedAt: true },
    where: {
      sport,
      externalId: { in: [...new Set(broken.map((r) => r.externalId))] },
      source: { in: [...KICKOFF_DONOR_SOURCES] },
      startTime: { not: null },
    },
  })

  // Freshest knowledge wins when two schedule feeds disagree. They agreed on
  // all seven of the measured fixtures, so this is a tie-break, not a merge.
  const best = new Map<string, { at: Date; fetched: number }>()
  for (const d of donors) {
    if (!d.startTime || isPlaceholderKickoff(sport, d.startTime)) continue
    const fetched = d.fetchedAt?.getTime() ?? 0
    const current = best.get(d.externalId)
    if (!current || fetched > current.fetched) best.set(d.externalId, { at: d.startTime, fetched })
  }
  if (best.size === 0) return rows

  return rows.map((row) => {
    if (!isPlaceholderKickoff(sport, row.startTime)) return row
    const fix = best.get(row.externalId)
    return fix ? { ...row, startTime: fix.at } : row
  })
}

async function readCachedLiveScoreRows(options: {
  sport: LeagueSport
  team?: string | null
}) {
  const sport = options.sport
  const team = options.team?.trim() || null
  const now = Date.now()
  const rows = await prisma.sportsGame.findMany({
    // Exactly what dbRowToLiveScore reads, plus `source` for the picker below.
    // `raw` is deliberately absent: it is a full provider payload per row and
    // nothing on this path reads it.
    select: {
      externalId: true,
      homeTeam: true,
      awayTeam: true,
      homeScore: true,
      awayScore: true,
      status: true,
      startTime: true,
      venue: true,
      week: true,
      season: true,
      fetchedAt: true,
      source: true,
    },
    where: {
      startTime: {
        gte: new Date(now - LIVE_WINDOW_PAST_MS),
        lte: new Date(now + LIVE_WINDOW_FUTURE_MS),
      },
      sport: options.sport,
      /*
       * ⚠ `thesportsdb` WAS EXCLUDED HERE AND IT IS THE ONLY NCAAF SCORE SOURCE.
       *
       * The exclusion reason on this line — "null scores" — was measured against
       * NFL, where TheSportsDB carries scores on 367 of 658 rows. For NCAAF it
       * carries them on 1,524 of 1,524, and it is the ONLY writer keeping the
       * sport current (881 rows refreshed in the last 6h, 2026-08-27).
       *
       * The other three are all empty or dead for college: rolling_insights has
       * no NCAAF data at all, `api_sports` has zero NCAAF rows because the
       * import-scores freshness gate suppresses it (see that route), and
       * `espn_live` last wrote 2026-04-26. So this filter returned NOTHING for
       * NCAAF while a complete, minutes-old feed sat in the same table.
       *
       * Source SELECTION now happens in pickFreshestSourceRows below rather than
       * here, so adding a source cannot let a stale feed outrank a live one.
       */
      source: { in: ['rolling_insights', 'espn_live', 'api_sports', 'thesportsdb'] },
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

  return repairPlaceholderKickoffs(sport, rows)
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
  // Was: RI-if-present, else EVERY row from every source blended together.
  // That blend is how one fixture rendered once per feed, and how a dead feed's
  // 0-0 rows sat beside a live one's real score.
  const useRows = pickFreshestSourceRows(cachedGames)
  const scores = await withCollegeTeamIdentity(sport, useRows.map(dbRowToLiveScore))
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
 * A LIVE FEED'S ANSWER IS NOT THE SLATE.
 *
 * The provider loop breaks on the first non-empty response and returns it
 * verbatim; the database is consulted only when EVERY provider is silent. A
 * thin answer is not a silent one, so a feed that reports one game out of eight
 * quietly becomes the whole scoreboard.
 *
 * Measured 2026-08-29 08:15 ET: ESPN's college-football scoreboard returned a
 * single in-window fixture (San José State at USC) while our table held the
 * other seven FBS games for that Saturday — written by ESPN ITSELF back on
 * 04-26 and never re-reported since.
 *
 * So fixtures the winning feed told us about earlier and has now dropped are
 * added back. The live row always wins a collision: it owns score and status,
 * and the restored row only fills a hole in coverage.
 *
 * ⚠ SAME SOURCE ONLY — that restriction is what makes this safe. Pulling the
 * gap from a DIFFERENT feed would mean merging id spaces and naming
 * conventions, which is the exact duplicate-fixture failure
 * `pickFreshestSourceRows` exists to prevent, and for NCAAF it would also drag
 * in `cfbd`'s Division III coverage. Restoring a feed's own back-catalogue
 * risks neither.
 *
 * ⚠ NCAAF ONLY. The gap is measured there and nowhere else. The same mechanism
 * could bite any sport whose provider reports a partial slate, but widening it
 * on reasoning alone is how the last four wrong conclusions in this file got
 * made — measure a second sport before extending this.
 */
export async function withOmittedFixtures(
  sport: LeagueSport,
  source: string,
  live: LiveScoreRow[],
  cached: Array<Parameters<typeof dbRowToLiveScore>[0] & { source: string | null }>,
): Promise<LiveScoreRow[]> {
  if (sport !== 'NCAAF') return live
  const reported = new Set(live.map((s) => s.gameId))
  const omitted = cached.filter((r) => r.source === source && !reported.has(r.externalId))
  if (omitted.length === 0) return live
  // Restored rows come from the database, so they need the crest pass the
  // provider rows already got upstream.
  return [...live, ...(await withCollegeTeamIdentity(sport, omitted.map(dbRowToLiveScore)))]
}

/**
 * DB-first live scores: ESPN first, then Rolling Insights, persisted under
 * distinct `source` keys. See the ordering note in the refresh branch below.
 */
export async function getLiveScoresForSport(options: {
  sport: string
  team?: string | null
  forceRefresh?: boolean
  /**
   * Try Rolling Insights before ESPN on refresh. Off by default.
   *
   * ⚠ "HAS ROWS" IS NOT THE SAME AS "HAS A LIVE SLATE", and the provider loop
   * only knows the former. See the ordering note in the refresh branch for what
   * was actually measured and what is still unexplained.
   */
  preferRollingInsights?: boolean
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
    /*
     * ⚠ ESPN FIRST, AND THE LOOP BELOW IS WHY IT HAS TO BE.
     *
     * The loop breaks on `rows.length === 0` — it falls through to the next
     * provider only when this one returns NOTHING. It has no notion of a
     * response that is present but useless, so whichever provider goes first
     * effectively decides the slate, and a wrong first choice is silent.
     *
     * This ordering is about OBSERVED behaviour, not about vendor capability.
     * Rolling Insights genuinely has a live feed and we are genuinely calling
     * it: `dataType: 'scores'` maps to `live/{today}/{SPORT}` in
     * `lib/workers/providers/rolling-insights.ts`, and the contract marks it
     * PRIMARY for game day with NFL and NCAAFB supported at confidence: high.
     *
     * What was measured on 2026-08-28, during PIT @ BUF:
     *   - espn_live carried the game in play (14-3, second quarter).
     *   - rolling_insights wrote today's 4 NFL games at 00:30Z as `scheduled`
     *     with null scores — CORRECT, three hours before kickoff — and then
     *     returned nothing at 03:43Z and 03:47Z, mid-game. Had it returned
     *     anything at all it would have won, being first.
     *   - thesportsdb is not a candidate: 17,052 rows, every one terminal or
     *     pre-game, never once in play.
     *
     * ⚠ WHY RI WENT EMPTY MID-GAME IS NOT ESTABLISHED. The leading candidate is
     * the 304 rule in CLAUDE.md — returning [] on a 304 without a cache-busted
     * retry reports "no data" for what may be a cache hit. Until that is run
     * down, ESPN first is the safe default rather than a verdict on RI. If the
     * live feed is fixed, revisit this ordering instead of assuming it settled.
     *
     * An older note here claimed RI "returns the whole season scoreless". That
     * does not match the path mapping above and is NOT repeated as fact.
     */
    const order: Array<'rolling_insights' | 'espn_live'> = options.preferRollingInsights
      ? ['rolling_insights', 'espn_live']
      : ['espn_live', 'rolling_insights']

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

    if (scores.length > 0) {
      scores = await withOmittedFixtures(sport, source, scores, cachedGames)
    }
  }

  if (scores.length === 0) {
    // Same rule as the cached-only reader: one source, the freshest that ranks
    // highest, never a blend across feeds.
    const useRows = pickFreshestSourceRows(cachedGames)
    scores = await withCollegeTeamIdentity(sport, useRows.map(dbRowToLiveScore))
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
