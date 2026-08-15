import 'server-only'

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

async function getJson(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', headers })
    // RI answers 304 with an empty body for sports it does not carry; that is an
    // absence of data, not an error worth escalating.
    if (res.status === 304) return null
    if (!res.ok) return null
    const text = await res.text()
    if (!text.trim()) return null
    return JSON.parse(text) as unknown
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

  for (const endpoint of ['schedule-season/NFL', 'live/NFL']) {
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

  if (['ns', 'tbd', 'scheduled', 'pre', 'pregame', 'not started', 'status_scheduled',
       'upcoming'].includes(v)) return 'scheduled'

  if (['live', 'in progress', 'inprogress', 'in_progress', 'status_in_progress', 'halftime',
       'ht', 'q1', 'q2', 'q3', 'q4', 'ot', '1h', '2h'].includes(v)) return 'in_progress'
  if (/^(q[1-4]|p[1-4]|ot\d*)$/.test(v)) return 'in_progress'

  if (v.includes('postpon') || v.includes('delayed') || v.includes('suspend')) return 'postponed'
  if (v.includes('cancel') || v.includes('abandon') || v.includes('forfeit')) return 'canceled'

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
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?limit=400` // db-first-exception: score ingestion adapter, not a read path
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
