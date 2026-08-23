import 'server-only'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

/**
 * gameScoreProviders — score/schedule feeds that actually work, per sport.
 *
 * API-Sports was the only provider wired into /api/cron/import-scores, and it
 * returns, verbatim:
 *
 *   {"plan":"Free plans do not have access to this season, try from 2022 to 2024."}
 *
 * So `synced: 0` for BOTH sports on every run — a billing limit, not a bug, and
 * nothing downstream could tell the difference.
 *
 * Verified live 2026-08-13:
 *   NFL   Rolling Insights  schedule-season + live      real games, live status
 *   NFL   TheSportsDB       eventspastleague id=4391    15 events with scores
 *   NCAAF CollegeFootballData /games                    211 games for 2026 wk1
 *   NCAAF TheSportsDB       eventspastleague id=4479    15 events with scores
 *
 * Rolling Insights is NFL-ONLY here: schedule-season/NCAAF answers 304 with an
 * empty body, so college never falls to it.
 *
 * ⚠ RI must be called over HTTPS with ROLLING_INSIGHTS_RSC_TOKEN. The http://
 * form and the CLIENT_SECRET2 token both answer 304-empty, which reads exactly
 * like "no data" rather than "wrong credentials".
 */

export type ProviderGame = {
  externalId: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | null
  week: number | null
  /**
   * Which slate `week` counts within. Null means the feed did not say — NOT
   * "regular". Preseason week 1 and regular week 1 are otherwise the same row.
   */
  seasonType: CanonicalSeasonType | null
  season: number | null
  raw: unknown
}

export type ProviderResult = {
  source: string
  games: ProviderGame[]
  error: string | null
}

/**
 * Null-safe numeric coercion.
 *
 * NOT `Number.isFinite(Number(v)) ? Number(v) : null` — Number(null) is 0 and
 * Number("") is 0, so absent fields become a confident zero. That is how a
 * SCHEDULED game acquires a 0-0 "score" indistinguishable from a real scoreless
 * result, and it is the same mistake that made the projections cron ask for
 * week 0.
 */
const num = (v: unknown): number | null => {
  if (v == null) return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Football weeks are 0-30; anything else is a provider using the field differently. */
const weekOrNull = (v: unknown): number | null => {
  const n = num(v)
  return n != null && n >= 0 && n <= 30 ? n : null
}

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
  return s.length > 0 ? s : null
}

function toDate(v: unknown): Date | null {
  if (!v) return null
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? null : d
}

/** "2026-2027" -> 2026; "2026" -> 2026. */
function seasonYear(v: unknown): number | null {
  const s = String(v ?? '')
  const m = s.match(/(\d{4})/)
  return m ? Number(m[1]) : null
}

/**
 * Appends a fresh millisecond cache-buster without disturbing existing query
 * params — every RI URL here already carries `?RSC_token=`.
 *
 * ⚠ THE TOKEN IS IN THAT QUERY STRING. Rolling Insights passes its credential as
 * a query parameter, so a URL from here must never reach a log, an error message
 * or a client response. Nothing in this module logs, and it needs to stay that
 * way.
 */
export function cacheBusted(url: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`
}

/**
 * ⚠ A 304 IS NOT "NO DATA", AND TREATING IT AS SUCH IS WHAT EMPTIED THE SCORES.
 * This previously did `if (res.status === 304) return null`, rationalised as "an
 * absence of data, not an error worth escalating". Measured consequence on
 * production: 3,331 Rolling Insights game rows, only 497 carrying a score.
 * `schedule-season/NFL` landed once and wrote the games; `live/NFL` then answered
 * 304 and every score silently became null, while ESPN and TheSportsDB had the
 * real numbers for the same fixtures.
 *
 * What a 304 means here is genuinely DISPUTED between two vendor sources — the
 * skill repo calls it a cache artefact to defeat, the newer OpenAPI spec declares
 * a NotModified component meaning "valid request, empty result set". This does
 * not depend on which is right, because the same handling is correct under both:
 *
 *   1. Send no-cache headers AND a fresh millisecond cache-buster every call.
 *   2. Retry ONCE on a 304, cache-busted again.
 *   3. Let the caller detect change by hashing the payload, never by status.
 *
 * If it is a cache artefact, busting defeats it. If it genuinely means empty, we
 * pay one extra request and return null as before. Either way this is right.
 *
 * `cache: 'no-store'` alone was never sufficient: that governs Next's own fetch
 * cache, not the upstream CDN's conditional response.
 */
const NO_CACHE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-cache, no-store, max-age=0',
  Pragma: 'no-cache',
}

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  const attempt = async (): Promise<{ status: number; body: unknown | null }> => {
    const res = await fetch(cacheBusted(url), {
      cache: 'no-store',
      headers: { ...NO_CACHE_HEADERS, ...(headers ?? {}) },
    })
    if (res.status === 304) return { status: 304, body: null }
    if (!res.ok) return { status: res.status, body: null }
    const text = await res.text()
    if (!text.trim()) return { status: res.status, body: null }
    return { status: res.status, body: JSON.parse(text) as unknown }
  }

  try {
    const first = await attempt()
    if (first.status !== 304) return first.body

    // Retry once, with a NEW cache-buster (Date.now() has moved on).
    const second = await attempt()
    return second.body
  } catch {
    return null
  }
}

// ── Rolling Insights (NFL) ───────────────────────────────────────────────────

function riCredentials(): { token: string | null; base: string } {
  const token =
    process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim() ||
    process.env.ROLLING_INSIGHTS_RSC_TOKEN2?.trim() ||
    null
  const base =
    process.env.ROLLING_INSIGHTS_REST_BASE_URL?.trim() ||
    'https://rest.datafeeds.rolling-insights.com/api/v1'
  return { token, base }
}

/**
 * `live` carries in-progress and final scores; `schedule-season` carries the
 * full slate. Both are read so a game that has not started still lands with a
 * start time, and one that has is overwritten with its score.
 */
export async function fetchRollingInsightsNflGames(): Promise<ProviderResult> {
  const { token, base } = riCredentials()
  if (!token) return { source: 'rolling_insights', games: [], error: 'RSC token not configured' }

  const byId = new Map<string, ProviderGame>()
  const q = `?RSC_token=${encodeURIComponent(token)}`

  /*
   * ⚠ BOTH PATHS WERE MISSING A REQUIRED PATH PARAMETER. This called
   * `schedule-season/NFL` and `live/NFL`. Per contracts/rolling-insights/
   * ENDPOINTS.yaml the shapes are:
   *
   *   /schedule-season/{season}/{SPORT}   season: "YYYY", the year the season
   *                                       STARTED — a bare year, not a date
   *   /live/{date}/{SPORT}                date: "YYYY-MM-DD"
   *
   * `/live/{SPORT}` is not an address on this API, which is why player-level box
   * stats never arrived: the contract calls /live "the PRIMARY game-day endpoint"
   * and notes "player box lines live here". Measured symptom before this fix —
   * 3,331 RI game rows on production, only 497 carrying a score, while ESPN and
   * TheSportsDB held the real numbers for the same fixtures.
   *
   * The date is UTC-derived, matching how the rest of this file treats provider
   * timestamps, and /live "returns started AND finished events for the given
   * date" so a single call covers the whole slate.
   */
  const today = new Date()
  const liveDate = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`
  const seasonYearForPath = String(
    // The NFL season is named for the year it STARTED, so January and February
    // still belong to the previous season's schedule.
    today.getUTCMonth() + 1 <= 2 ? today.getUTCFullYear() - 1 : today.getUTCFullYear(),
  )

  for (const endpoint of [`schedule-season/${seasonYearForPath}/NFL`, `live/${liveDate}/NFL`]) {
    const payload = (await getJson(`${base}/${endpoint}${q}`)) as
      | { data?: { NFL?: Record<string, unknown>[] } }
      | null
    const rows = payload?.data?.NFL
    if (!Array.isArray(rows)) continue

    for (const r of rows) {
      const externalId = str(r.game_ID)
      if (!externalId) continue

      // Live rows nest scores under full_box; schedule rows have none yet.
      const box = (r.full_box ?? {}) as Record<string, Record<string, unknown> | undefined>
      const home = str(r.home_team) ?? str(box.home_team?.mascot)
      const away = str(r.away_team) ?? str(box.away_team?.mascot)
      if (!home || !away) continue

      const existing = byId.get(externalId)
      const game: ProviderGame = {
        externalId,
        homeTeam: home,
        awayTeam: away,
        homeScore: num(r.home_score) ?? num(box.home_team?.score) ?? existing?.homeScore ?? null,
        awayScore: num(r.away_score) ?? num(box.away_team?.score) ?? existing?.awayScore ?? null,
        status: str(r.status) ?? str(r.season_type) ?? existing?.status ?? null,
        startTime: toDate(r.game_time) ?? existing?.startTime ?? null,
        week: weekOrNull(r.week) ?? existing?.week ?? null,
        // RI states it outright ("Preseason" | "Regular Season" | "Postseason"),
        // which is why this feed is the reference for the whole column.
        seasonType: normalizeSeasonType(r.season_type) ?? existing?.seasonType ?? null,
        season: seasonYear(r.season) ?? existing?.season ?? null,
        raw: r,
      }
      byId.set(externalId, game)
    }
  }

  return { source: 'rolling_insights', games: [...byId.values()], error: null }
}

// ── CollegeFootballData (NCAAF) ──────────────────────────────────────────────

export async function fetchCfbdGames(season: number, week?: number): Promise<ProviderResult> {
  const key = process.env.CFBD_KEY?.trim() || process.env.CFBD_API_KEY?.trim() || null
  if (!key) return { source: 'cfbd', games: [], error: 'CFBD key not configured' }

  const weekParam = week != null && week > 0 ? `&week=${week}` : ''
  const rows = (await getJson(
    `https://api.collegefootballdata.com/games?year=${season}&seasonType=regular${weekParam}`,
    { Authorization: `Bearer ${key}` },
  )) as Record<string, unknown>[] | null

  if (!Array.isArray(rows)) return { source: 'cfbd', games: [], error: 'no games returned' }

  const games: ProviderGame[] = []
  for (const r of rows) {
    const externalId = str(r.id)
    const home = str(r.homeTeam)
    const away = str(r.awayTeam)
    if (!externalId || !home || !away) continue
    games.push({
      externalId,
      homeTeam: home,
      awayTeam: away,
      homeScore: num(r.homePoints),
      awayScore: num(r.awayPoints),
      status: r.completed === true ? 'final' : 'scheduled',
      startTime: toDate(r.startDate),
      week: weekOrNull(r.week),
      // The query string above pins `seasonType=regular`, so every row here IS
      // regular season — asserted from the request, not guessed from the payload.
      seasonType: normalizeSeasonType(r.seasonType) ?? 'regular',
      season: num(r.season),
      raw: r,
    })
  }
  return { source: 'cfbd', games, error: null }
}

// ── TheSportsDB (both sports) ────────────────────────────────────────────────


/**
 * One status vocabulary across providers.
 *
 * Measured in production, sports_games.status held all of these at once:
 * "scheduled", "Finished", "NS", "FT", "completed", "After Over Time", "AOT",
 * "Final", "TBD" — and one NCAAF row whose status was the literal string
 * "9/6 - 7:30 PM EDT". Every provider speaks its own dialect, so any downstream
 * "is this game over?" check was guesswork, and the safe-looking default (treat
 * unknown as not-final) silently mislabels finished games.
 *
 * Unrecognised input returns null rather than a guess. A null status is legible
 * as "we do not know"; "scheduled" would be a claim.
 */
export type CanonicalGameStatus = 'scheduled' | 'in_progress' | 'final' | 'postponed' | 'canceled'

export function normalizeGameStatus(raw: unknown): CanonicalGameStatus | null {
  if (raw == null) return null
  const v = String(raw).trim().toLowerCase()
  if (!v) return null

  // A date/time in the status column is a scheduling artefact, not a state.
  if (/\d{1,2}\/\d{1,2}/.test(v) || /\b(am|pm)\b/.test(v)) return 'scheduled'

  if (['ft', 'aot', 'final', 'finished', 'completed', 'complete', 'closed', 'full time',
       'after over time', 'final/ot', 'final ot', 'status_final', 'post'].includes(v)) return 'final'
  if (v.startsWith('final')) return 'final'
  // "Match Finished" is the single most common legacy value in this column (334
  // rows), and an exact-match list missed it entirely.
  if (v.includes('finished') || v.includes('full time')) return 'final'

  if (['ns', 'tbd', 'scheduled', 'pre', 'pregame', 'not started', 'status_scheduled',
       'upcoming'].includes(v)) return 'scheduled'

  if (['live', 'in progress', 'inprogress', 'in_progress', 'status_in_progress', 'halftime',
       'ht', 'q1', 'q2', 'q3', 'q4', 'ot', '1h', '2h'].includes(v)) return 'in_progress'
  if (/^(q[1-4]|p[1-4]|ot\d*)$/.test(v)) return 'in_progress'
  // sports_games carries every sport, so the column also holds baseball and
  // period markers: "Top 2nd", "Mid 2nd", "IN8", "3:00 - 1st". A game with an
  // inning or a clock on it is being played.
  if (/^(top|bot|bottom|mid|end)\s/.test(v)) return 'in_progress'
  if (/^in\d+$/.test(v)) return 'in_progress'
  // "Second Half", "1st Half" — a half in play is a game in play. 'halftime' is
  // already handled above and lands in the same state.
  if (v.includes('half')) return 'in_progress'
  if (/^\d{1,2}:\d{2}\s*-\s*/.test(v)) return 'in_progress'
  // A delay interrupts a game in progress; it is not a postponement of one that
  // has not started.
  if (v.includes('delay') && /(top|bot|mid|end|\d(st|nd|rd|th))/.test(v)) return 'in_progress'

  if (v.includes('postpon') || v.includes('delay') || v.includes('suspend')) return 'postponed'
  if (v.includes('cancel') || v.includes('abandon') || v.includes('forfeit')) return 'canceled'

  return null
}

/**
 * One season-type vocabulary, the same way `normalizeGameStatus` gives statuses one.
 *
 * Every feed spells this differently: API-Sports puts "Pre Season" in `game.stage`
 * and repeats it inside the week label ("Pre Season - 1"), Rolling Insights sends
 * `season_type: "Preseason" | "Regular Season" | "Postseason"`, ESPN uses a numeric
 * `seasontype` (1/2/3), and CFBD says `seasonType: "regular" | "postseason"`.
 *
 * ⚠ RETURNS NULL FOR ANYTHING UNRECOGNISED, INCLUDING EMPTY INPUT. A default of
 * 'regular' here would be a claim, and it is exactly the claim that made preseason
 * games indistinguishable from regular ones in the first place. Callers decide what
 * to do with "we do not know"; this function does not decide for them.
 */
export type CanonicalSeasonType = 'pre' | 'regular' | 'post'

export function normalizeSeasonType(raw: unknown): CanonicalSeasonType | null {
  if (raw == null) return null
  // ESPN's numeric form. 1 = preseason, 2 = regular, 3 = postseason.
  if (typeof raw === 'number') {
    return raw === 1 ? 'pre' : raw === 2 ? 'regular' : raw === 3 ? 'post' : null
  }
  const v = String(raw).trim().toLowerCase()
  if (!v) return null

  // Order matters: "postseason" contains "season", and "pre season" contains
  // "season" too, so the specific prefixes have to be tested before the generic.
  if (v.includes('preseason') || v.includes('pre season') || v.includes('pre-season')) return 'pre'
  if (v === 'pre' || v === '1') return 'pre'
  if (v.includes('postseason') || v.includes('post season') || v.includes('post-season')) return 'post'
  if (v.includes('playoff') || v.includes('championship')) return 'post'
  if (v === 'post' || v === '3') return 'post'
  if (v.includes('regular')) return 'regular'
  if (v === 'reg' || v === '2') return 'regular'
  return null
}

const THE_SPORTS_DB_LEAGUE: Record<string, string> = {
  NFL: '4391',
  NCAAF: '4479',
}

/**
 * Past results and the upcoming slate. TheSportsDB is the third opinion here —
 * thin on player data (its NCAAF rosters are effectively empty) but genuinely
 * good at fixtures and scores for both leagues.
 */
export async function fetchTheSportsDbGames(sport: 'NFL' | 'NCAAF'): Promise<ProviderResult> {
  const key = process.env.THESPORTSDB_API_KEY?.trim() || null
  const leagueId = THE_SPORTS_DB_LEAGUE[sport]
  if (!key) return { source: 'thesportsdb', games: [], error: 'API key not configured' }
  if (!leagueId) return { source: 'thesportsdb', games: [], error: `no league id for ${sport}` }

  const byId = new Map<string, ProviderGame>()
  // Season-wide slate FIRST. eventspastleague/eventsnextleague return only ~15
  // and ~20 rows, which is why NCAAF sat at 97 games in the database while
  // TheSportsDB itself carried 866 for the 2026 season and 1,525 for 2025.
  const seasonYearForCall = new Date().getFullYear()
  for (const season of [seasonYearForCall, seasonYearForCall - 1]) {
    const payload = (await getJson(
      `https://www.thesportsdb.com/api/v1/json/${key}/eventsseason.php?id=${leagueId}&s=${season}`,
    )) as { events?: Record<string, unknown>[] } | null
    const rows = payload?.events
    if (!Array.isArray(rows)) continue
    for (const r of rows) {
      const externalId = str(r.idEvent)
      const home = str(r.strHomeTeam)
      const away = str(r.strAwayTeam)
      if (!externalId || !home || !away) continue
      const date = str(r.dateEvent)
      const time = str(r.strTime)
      byId.set(externalId, {
        externalId,
        homeTeam: home,
        awayTeam: away,
        homeScore: num(r.intHomeScore),
        awayScore: num(r.intAwayScore),
        status: normalizeGameStatus(r.strStatus),
        startTime: date ? toDate(`${date}T${time ?? '00:00:00'}Z`) : null,
        week: weekOrNull(r.intRound),
        // TheSportsDB exposes no season-type field. Null says so; it does not
        // let this feed overwrite a slate another provider actually reported.
        seasonType: null,
        season: seasonYear(r.strSeason) ?? (date ? Number(date.slice(0, 4)) : null),
        raw: r,
      })
    }
    // One season with data is enough; the prior year is only a fallback for the
    // gap between seasons.
    if (byId.size > 0) break
  }

  for (const file of ['eventspastleague', 'eventsnextleague']) {
    const payload = (await getJson(
      `https://www.thesportsdb.com/api/v1/json/${key}/${file}.php?id=${leagueId}`,
    )) as { events?: Record<string, unknown>[] } | null
    const rows = payload?.events
    if (!Array.isArray(rows)) continue

    for (const r of rows) {
      const externalId = str(r.idEvent)
      const home = str(r.strHomeTeam)
      const away = str(r.strAwayTeam)
      if (!externalId || !home || !away) continue
      const date = str(r.dateEvent)
      const time = str(r.strTime)
      byId.set(externalId, {
        externalId,
        homeTeam: home,
        awayTeam: away,
        homeScore: num(r.intHomeScore),
        awayScore: num(r.intAwayScore),
        status: normalizeGameStatus(r.strStatus),
        startTime: date ? toDate(`${date}T${time ?? '00:00:00'}Z`) : null,
        // Observed 500 and 200 on real rows — TheSportsDB uses intRound for its
        // own bucketing, not a football week. Rejected rather than stored wrong.
        week: weekOrNull(r.intRound),
        seasonType: null,
        season: seasonYear(r.strSeason) ?? (date ? Number(date.slice(0, 4)) : null),
        raw: r,
      })
    }
  }

  return { source: 'thesportsdb', games: [...byId.values()], error: null }
}


const ESPN_PATH: Record<string, string> = {
  NFL: 'football/nfl',
  NCAAF: 'football/college-football',
}

/**
 * ESPN's public scoreboard. No key, and it is the only one of these feeds that
 * reports in-progress state reliably, so it is what makes "is this game live
 * right now" answerable.
 *
 * Verified live 2026-08-15: NFL 16 events, NCAAF 99 events.
 */
export async function fetchEspnGames(sport: 'NFL' | 'NCAAF'): Promise<ProviderResult> {
  const path = ESPN_PATH[sport]
  if (!path) return { source: 'espn', games: [], error: `no espn path for ${sport}` }

  // This module exists solely to feed /api/cron/import-scores, which writes
  // sports_games; every read path goes to that table, not to this file.
  const url = `${ESPN_SITE_API_BASE}/${path}/scoreboard?limit=400` // db-first-exception: score ingestion adapter, not a read path
  const payload = (await getJson(url)) as { events?: Record<string, unknown>[]; season?: Record<string, unknown> } | null

  const rows = payload?.events
  if (!Array.isArray(rows)) {
    return { source: 'espn', games: [], error: 'no events in scoreboard payload' }
  }

  const games: ProviderGame[] = []
  for (const r of rows) {
    const externalId = str(r.id)
    const comp = Array.isArray((r as any).competitions) ? (r as any).competitions[0] : null
    const teams = Array.isArray(comp?.competitors) ? comp.competitors : []
    const homeRow = teams.find((t: any) => t?.homeAway === 'home')
    const awayRow = teams.find((t: any) => t?.homeAway === 'away')
    const home = str(homeRow?.team?.displayName ?? homeRow?.team?.name)
    const away = str(awayRow?.team?.displayName ?? awayRow?.team?.name)
    if (!externalId || !home || !away) continue

    // ESPN reports state as pre/in/post alongside a human detail string; the
    // state is the reliable half.
    const state = str(comp?.status?.type?.state)
    const detail = str(comp?.status?.type?.description ?? comp?.status?.type?.shortDetail)
    const status =
      state === 'in' ? 'in_progress'
      : state === 'post' ? 'final'
      : state === 'pre' ? 'scheduled'
      : normalizeGameStatus(detail)

    // ESPN sends score "0" for games that have not kicked off, so reading it
    // unconditionally invents a 0-0 result for every scheduled game — 99 of 99
    // NCAAF rows on first run. Scores are only real once the game is live or
    // finished.
    const played = status === 'in_progress' || status === 'final'

    games.push({
      externalId,
      homeTeam: home,
      awayTeam: away,
      homeScore: played ? num(homeRow?.score) : null,
      awayScore: played ? num(awayRow?.score) : null,
      status,
      startTime: toDate(str(r.date)),
      week: weekOrNull((r as any).week?.number ?? (payload as any)?.week?.number),
      // ESPN encodes the slate numerically (1 pre / 2 regular / 3 post) on both
      // the event and the scoreboard envelope.
      seasonType: normalizeSeasonType(
        (r as any).season?.type ?? (payload as any)?.season?.type,
      ),
      season: num((r as any).season?.year ?? (payload as any)?.season?.year),
      raw: r,
    })
  }

  return { source: 'espn', games, error: null }
}

/**
 * Providers to try, in order, for a sport.
 *
 * API-Sports is deliberately NOT included: it is plan-blocked for the current
 * season and returning zero from it first would just burn a request.
 */
export async function fetchGamesForSport(
  sport: 'NFL' | 'NCAAF',
  season: number,
  week?: number,
): Promise<ProviderResult[]> {
  const attempts: ProviderResult[] = []

  if (sport === 'NFL') {
    attempts.push(await fetchRollingInsightsNflGames())
  } else {
    attempts.push(await fetchCfbdGames(season, week))
  }

  // TheSportsDB always runs: it is the corroborating source, it carries the
  // season-wide slate, and it fills in when the primary has games but no scores.
  attempts.push(await fetchTheSportsDbGames(sport))

  // ESPN last, and for BOTH sports: it is the only feed here that reports
  // in-progress state, so it is what upgrades a stored "scheduled" to live.
  attempts.push(await fetchEspnGames(sport))

  // Normalise centrally rather than per provider. Each feed speaks its own
  // dialect ("completed", "FT", "NS"), and a provider added later would
  // otherwise reintroduce a fourth vocabulary into the same column.
  // normalizeGameStatus is idempotent, so already-canonical values pass through.
  return attempts.map((attempt) => ({
    ...attempt,
    games: attempt.games.map((game) => ({
      ...game,
      status: normalizeGameStatus(game.status),
    })),
  }))
}
