import 'server-only'
import { CFBD_BASE_URL } from '@/lib/cfbd-fetch'
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

/**
 * Why a provider produced nothing.
 *
 * ⚠ "NO GAMES RETURNED" AND "THE PROVIDER REFUSED US" ARE DIFFERENT FACTS, and
 * this file reported both as the first one. `getJson` collapsed a 429, a 401, a
 * 500, an empty body and a parse error all into `null`, so every provider below
 * then said some variant of "no data" — a sentence about the slate, when it was
 * actually a sentence about our quota or our credentials.
 *
 * Not hypothetical: verified 2026-08-25 the CFBD key returns `HTTP 429
 * {"message":"Monthly call quota exceeded."}`, and `fetchCfbdGames` reported
 * `no games returned` for it — indistinguishable from a week with no college
 * football. `/api/cron/import-scores` surfaces that string in
 * `bySource[...].error` and still answers `ok: true`, so the one place the truth
 * could have appeared said the wrong thing.
 */
export type ProviderFailure = {
  kind: 'quota' | 'rate_limit' | 'unauthorized' | 'http' | 'network' | 'empty' | 'parse'
  status: number | null
  /** Safe to log — carries no URL and no credential. */
  message: string
}

type JsonResult = { body: unknown | null; failure: ProviderFailure | null }

function classifyStatus(status: number, body: string): ProviderFailure {
  if (status === 429) {
    /* Monthly exhaustion is terminal for the month; ordinary throttling is not.
       Only the body separates them. */
    const quota = body.toLowerCase().includes('quota')
    return {
      kind: quota ? 'quota' : 'rate_limit',
      status,
      message: quota
        ? 'provider monthly call quota exceeded — this is not a slate with no games'
        : 'provider rate limited this request',
    }
  }
  if (status === 401 || status === 403) {
    return { kind: 'unauthorized', status, message: `provider rejected our key (${status})` }
  }
  return { kind: 'http', status, message: `provider responded ${status}` }
}

/**
 * ⚠ THE 304 HANDLING IS LOAD-BEARING — see the header above and CLAUDE.md: send
 * no-cache plus a fresh millisecond cache-buster, retry once on a 304, and never
 * decide anything from the status alone. That is unchanged; only the reporting
 * of failures is new. A 304 still yields a null body with NO failure, because
 * under both readings of the 304 dispute it is not an error.
 */
async function getJson(url: string, headers?: Record<string, string>): Promise<JsonResult> {
  const attempt = async (): Promise<{ status: number; result: JsonResult }> => {
    const res = await fetch(cacheBusted(url), {
      cache: 'no-store',
      headers: { ...NO_CACHE_HEADERS, ...(headers ?? {}) },
    })
    if (res.status === 304) return { status: 304, result: { body: null, failure: null } }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        status: res.status,
        result: { body: null, failure: classifyStatus(res.status, text) },
      }
    }
    const text = await res.text()
    if (!text.trim()) {
      return {
        status: res.status,
        result: {
          body: null,
          failure: { kind: 'empty', status: res.status, message: 'provider returned an empty body' },
        },
      }
    }
    return { status: res.status, result: { body: JSON.parse(text) as unknown, failure: null } }
  }

  try {
    const first = await attempt()
    if (first.status !== 304) return first.result

    // Retry once, with a NEW cache-buster (Date.now() has moved on).
    const second = await attempt()
    return second.result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    /* A malformed payload and a dead socket are different problems. */
    const kind: ProviderFailure['kind'] = /JSON|Unexpected token/i.test(message) ? 'parse' : 'network'
    return { body: null, failure: { kind, status: null, message: `provider request failed (${kind})` } }
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
  /* Kept so an empty result can say WHY it is empty rather than implying the
     provider had nothing to give. */
  let lastFailure: ProviderFailure | null = null

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
    const { body, failure } = await getJson(`${base}/${endpoint}${q}`)
    if (failure) lastFailure = failure
    const payload = body as { data?: { NFL?: Record<string, unknown>[] } } | null
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
      const status = str(r.status) ?? str(r.season_type) ?? existing?.status ?? null

      /*
       * ⚠ RI SENDS 0 BEFORE KICKOFF TOO — the same trap the ESPN block below
       * already guards against, which this one never got. Measured on
       * production: 100 future `rolling_insights` rows carrying a 0-0 that no
       * one played, alongside 285 correctly NULL.
       *
       * Note what `status` can be here: it falls back to `season_type`, so an
       * unmatched row can carry "Preseason", which normalizes to nothing. That
       * lands as not-played and the score stays NULL — the right way to be
       * wrong, because an unreadable state must never mint a result.
       *
       * `existing` is preserved rather than overwritten with null: this loop
       * merges several endpoints into one row, and a schedule row arriving
       * after a finished-game row must not erase a score that was really
       * observed. This refuses to INVENT a score; it does not discard one.
       */
      const state = normalizeGameStatus(status)
      const played = state === 'in_progress' || state === 'final'

      const game: ProviderGame = {
        externalId,
        homeTeam: home,
        awayTeam: away,
        homeScore: played
          ? (num(r.home_score) ?? num(box.home_team?.score) ?? existing?.homeScore ?? null)
          : (existing?.homeScore ?? null),
        awayScore: played
          ? (num(r.away_score) ?? num(box.away_team?.score) ?? existing?.awayScore ?? null)
          : (existing?.awayScore ?? null),
        status,
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

  const riGames = [...byId.values()]
  /* Zero games plus a recorded refusal is a fact about the request, not the slate. */
  return {
    source: 'rolling_insights',
    games: riGames,
    error: riGames.length === 0 ? (lastFailure?.message ?? null) : null,
  }
}

// ── CollegeFootballData (NCAAF) ──────────────────────────────────────────────

export async function fetchCfbdGames(season: number, week?: number): Promise<ProviderResult> {
  const key = process.env.CFBD_KEY?.trim() || process.env.CFBD_API_KEY?.trim() || null
  if (!key) return { source: 'cfbd', games: [], error: 'CFBD key not configured' }

  const weekParam = week != null && week > 0 ? `&week=${week}` : ''
  const { body, failure } = await getJson(
    `${CFBD_BASE_URL}/games?year=${season}&seasonType=regular${weekParam}`,
    { Authorization: `Bearer ${key}` },
  )
  const rows = body as Record<string, unknown>[] | null

  if (!Array.isArray(rows)) {
    /* The refusal, when there was one — not "no games", which is a claim about
       the slate rather than about the request. */
    return { source: 'cfbd', games: [], error: failure?.message ?? 'no games returned' }
  }

  const games: ProviderGame[] = []
  for (const r of rows) {
    const externalId = str(r.id)
    const home = str(r.homeTeam)
    const away = str(r.awayTeam)
    if (!externalId || !home || !away) continue

    /*
     * ⚠ A FINAL NEEDS BOTH HALVES OF THE SCORE.
     *
     * Measured on production 2026-08-29: CFBD returned Delta State at
     * Northeastern State with `completed: true` and `homePoints: 52` against a
     * NULL `awayPoints` — on a game that kicked off four hours later. It was
     * the only row in the table claiming a result before kickoff, and the only
     * one carrying a score for one side and not the other.
     *
     * One vendor row was wrong; transcribing it faithfully is what would have
     * turned it into something the UI repeats. `dbRowToLiveScore` maps a null
     * score to 0, so this row renders as a finished game won 52-0 by a team
     * that has not taken the field.
     *
     * A completion claim we cannot corroborate with BOTH scores is therefore
     * not propagated, and neither score is carried without the other. Nothing
     * here invents the missing half, and nothing asserts a result nobody can
     * read — the vendor's own claim survives in `raw` for anyone auditing it.
     */
    const homePoints = num(r.homePoints)
    const awayPoints = num(r.awayPoints)
    const played = r.completed === true && homePoints !== null && awayPoints !== null

    games.push({
      externalId,
      homeTeam: home,
      awayTeam: away,
      homeScore: played ? homePoints : null,
      awayScore: played ? awayPoints : null,
      status: played ? 'final' : 'scheduled',
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
  /* Kept so an empty result can say WHY it is empty rather than implying the
     provider had nothing to give. */
  let lastFailure: ProviderFailure | null = null

  const byId = new Map<string, ProviderGame>()
  // Season-wide slate FIRST. eventspastleague/eventsnextleague return only ~15
  // and ~20 rows, which is why NCAAF sat at 97 games in the database while
  // TheSportsDB itself carried 866 for the 2026 season and 1,525 for 2025.
  const seasonYearForCall = new Date().getFullYear()
  for (const season of [seasonYearForCall, seasonYearForCall - 1]) {
    const { body, failure } = await getJson(
      `https://www.thesportsdb.com/api/v1/json/${key}/eventsseason.php?id=${leagueId}&s=${season}`,
    )
    if (failure) lastFailure = failure
    const payload = body as { events?: Record<string, unknown>[] } | null
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
    const { body, failure } = await getJson(
      `https://www.thesportsdb.com/api/v1/json/${key}/${file}.php?id=${leagueId}`,
    )
    if (failure) lastFailure = failure
    const payload = body as { events?: Record<string, unknown>[] } | null
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

  const tsdbGames = [...byId.values()]
  return {
    source: 'thesportsdb',
    games: tsdbGames,
    error: tsdbGames.length === 0 ? (lastFailure?.message ?? null) : null,
  }
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
  const { body, failure } = await getJson(url)
  const payload = body as { events?: Record<string, unknown>[]; season?: Record<string, unknown> } | null

  const rows = payload?.events
  if (!Array.isArray(rows)) {
    return { source: 'espn', games: [], error: failure?.message ?? 'no events in scoreboard payload' }
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
