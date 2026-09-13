import type {
  FleaflickerImportPayload,
  FleaflickerSport,
  FleaflickerStandingsResponse,
  FleaflickerRostersResponse,
  FleaflickerScoreboardResponse,
  FleaflickerScoreboardGame,
  FleaflickerRulesResponse,
  FleaflickerDraftBoardResponse,
} from '@/lib/league-import/fleaflicker/types'

const API_BASE = 'https://www.fleaflicker.com/api'

export class FleaflickerImportLeagueNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FleaflickerImportLeagueNotFoundError'
  }
}

/**
 * The provider was reachable-in-principle but did not answer — a rate limit, a 5xx, or a
 * network failure.
 *
 * 🛑 DISTINCT FROM "NOT FOUND", AND THE COLLECTOR ACTS ON THE DIFFERENCE. Every non-404
 * HTTP status used to be raised as `FleaflickerImportLeagueNotFoundError`, which the
 * pipeline maps to `LEAGUE_NOT_FOUND` — and the collector treats that as "the league is
 * gone: stop, skip, note it" rather than "retry later". So a Fleaflicker throttle or a
 * five-minute outage read as a deleted league. This mirrors `SleeperImportUnavailableError`,
 * which exists in this repo for exactly the same misdiagnosis.
 */
export class FleaflickerImportUnavailableError extends Error {
  readonly status: number | null

  constructor(message: string, status: number | null = null) {
    super(message)
    this.name = 'FleaflickerImportUnavailableError'
    this.status = status
  }
}

const SPORT_SET = new Set<string>(['NFL', 'MLB', 'NBA', 'NHL'])

/**
 * `sourceId` forms:
 * - `206154` — defaults to NFL, current calendar year as season
 * - `NFL:206154` — explicit sport + league id
 * - `NFL:206154:2024` — explicit season year
 */
export function parseFleaflickerSourceId(sourceId: string): {
  sport: FleaflickerSport
  leagueId: number
  season: number
} {
  const raw = sourceId.trim()
  const parts = raw.split(':').map((p) => p.trim()).filter(Boolean)
  let sport: FleaflickerSport = 'NFL'
  let leagueIdNum: number
  let season = new Date().getFullYear()

  if (parts.length >= 2 && SPORT_SET.has(parts[0]!.toUpperCase())) {
    sport = parts[0]!.toUpperCase() as FleaflickerSport
    leagueIdNum = Number(parts[1])
    if (parts[2]) season = Math.max(2000, Math.min(2100, Number(parts[2]) || season))
  } else {
    leagueIdNum = Number(raw.replace(/[^\d]/g, '') || raw)
  }

  if (!Number.isFinite(leagueIdNum) || leagueIdNum <= 0) {
    throw new FleaflickerImportLeagueNotFoundError('Invalid Fleaflicker league id.')
  }

  return { sport, leagueId: leagueIdNum, season }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  if (res.status === 404) {
    throw new FleaflickerImportLeagueNotFoundError('Fleaflicker league not found (404).')
  }
  if (!res.ok) {
    /*
     * ⚠ ONLY 404 MEANS THE LEAGUE IS NOT THERE. A 429 or 5xx is a transient provider
     * condition and must stay retryable; reporting it as "not found" retires a live league.
     */
    throw new FleaflickerImportUnavailableError(
      `Fleaflicker API error (${res.status}).`,
      res.status,
    )
  }
  return res.json() as Promise<T>
}

/**
 * Public JSON API — no user OAuth required.
 */
export async function fetchFleaflickerLeagueForImport(sourceId: string): Promise<FleaflickerImportPayload> {
  const { sport, leagueId, season } = parseFleaflickerSourceId(sourceId)

  const standingsUrl = `${API_BASE}/FetchLeagueStandings?sport=${encodeURIComponent(sport)}&league_id=${leagueId}&season=${season}`
  const rostersUrl = `${API_BASE}/FetchLeagueRosters?sport=${encodeURIComponent(sport)}&league_id=${leagueId}&season=${season}`
  /*
   * Same request plus `external_id_type=SPORTRADAR`, which adds `proPlayer.externalIds` —
   * a Sportradar UUID per player that joins `Player.provider_ids.sportradar` by exact id
   * (693/761 = 91.1% measured in production; G-11 in contracts/fleaflicker).
   */
  const rostersWithIdsUrl = `${rostersUrl}&external_id_type=SPORTRADAR`

  /*
   * ⚠ RULES FAIL SOFT, LIKE ROSTERS AND UNLIKE STANDINGS. Standings carry the
   * league identity this import is built on; rosters and rules are enrichments.
   * An import that can name the league and its teams must not die because the
   * scoring endpoint had a bad minute.
   */
  const [standings, rosters, rules, draftBoard] = await Promise.all([
    fetchJson<FleaflickerStandingsResponse>(standingsUrl),
    /*
     * 🛑 THE SPORTRADAR IDS ARE AN ENRICHMENT OF THE ROSTERS, SO THEY MUST NEVER COST THE
     * ROSTERS. If the parameter is ever rejected, fall back to the plain request before
     * falling back to no rosters at all. Without the middle step, a vendor change to one
     * optional parameter would import every league with zero players — and an empty
     * roster list looks like a league that has not drafted, not like a failure.
     */
    fetchJson<FleaflickerRostersResponse>(rostersWithIdsUrl)
      .catch(() => fetchJson<FleaflickerRostersResponse>(rostersUrl))
      .catch(() => ({ rosters: [] })),
    fetchFleaflickerRules(sport, leagueId).catch(() => null),
    /*
     * ⚠ THE DRAFT BOARD FAILS SOFT TO `null`, AND `null` IS NOT THE SAME AS THE `{}`
     * THE ENDPOINT ITSELF RETURNS. `null` here means the call did not succeed; `{}`
     * means it succeeded and there is no board for this season. Collapsing them would
     * turn "we could not ask" into "this league never drafted", which is the more
     * confident and more wrong of the two.
     */
    fetchFleaflickerDraftBoard(sport, leagueId, season).catch(() => null),
  ])

  if (!standings?.league?.id) {
    throw new FleaflickerImportLeagueNotFoundError('Fleaflicker response missing league object.')
  }

  return {
    sport,
    season: standings.season ?? season,
    standings,
    rosters,
    rules,
    draftBoard,
  }
}

/**
 * Raised when the provider answered 200 with a body describing a DIFFERENT
 * SEASON from the one requested.
 *
 * 🛑 THIS IS NOT A HYPOTHETICAL, AND IT IS WHY THIS ERROR EXISTS AT ALL.
 * Fleaflicker silently CLAMPS a `season` past the league's last to the last
 * season it has, and returns that season's complete, played data under HTTP
 * 200 — no 404, no empty envelope, no warning. Measured 2026-09-11 against
 * league 206154, whose final season is 2021: `season=` 2021, 2024, 2025, 2026
 * and even 2099 returned byte-identical games, the same eight ids and the same
 * final scores. Within range the parameter IS honoured (2019, 2020 and 2021
 * each differ), so this only fires past the end of a league's life.
 *
 * ⚠ AND YOU CANNOT DETECT IT FROM THE FIELD THAT LOOKS LIKE IT SHOULD.
 * `FetchLeagueStandings` returns a top-level `season` that reads back whatever
 * you asked for. `schedulePeriod.low.season` on the SCOREBOARD is the only
 * authority, which is why this check lives here and not in the standings path.
 *
 * Without this refusal a weekly sync of any dormant Fleaflicker league would
 * persist five-year-old finals as the current season's results, and every
 * downstream surface would render them as this week's scores. Nothing else in
 * the stack could tell.
 */
export class FleaflickerSeasonMismatchError extends Error {
  readonly requestedSeason: number
  readonly returnedSeason: number | null

  constructor(requestedSeason: number, returnedSeason: number | null) {
    super(
      `Fleaflicker returned season ${returnedSeason ?? 'unknown'} for a request for ${requestedSeason} ` +
        `(a season past the league's last is silently clamped) — refusing the payload.`,
    )
    this.name = 'FleaflickerSeasonMismatchError'
    this.requestedSeason = requestedSeason
    this.returnedSeason = returnedSeason
  }
}

export interface FleaflickerScoreboardWeek {
  /** The scoring period, 1-indexed. */
  week: number
  /** Taken from `schedulePeriod.low.season`, never from the request. */
  season: number
  games: FleaflickerScoreboardGame[]
}

/**
 * One scoring period of a league's scoreboard.
 *
 * `scoringPeriod` omitted means "the league's current period" — confirmed
 * behaviour, not an assumption: omitting it and passing the current period's
 * own value returned byte-identical responses.
 *
 * ⚠ ASSERTS THE SEASON AND THROWS RATHER THAN RETURNING A BEST EFFORT. See
 * `FleaflickerSeasonMismatchError`. A caller that would rather skip than fail
 * should catch it — but it must not be silently swallowed, because the payload
 * underneath looks completely healthy.
 */
export async function fetchFleaflickerScoreboard(
  sport: FleaflickerSport,
  leagueId: number,
  season: number,
  scoringPeriod?: number,
): Promise<{ week: FleaflickerScoreboardWeek | null; periods: number[]; currentPeriod: number | null }> {
  let url =
    `${API_BASE}/FetchLeagueScoreboard?sport=${encodeURIComponent(sport)}` +
    `&league_id=${leagueId}&season=${season}`
  if (scoringPeriod != null) url += `&scoring_period=${scoringPeriod}`

  const body = await fetchJson<FleaflickerScoreboardResponse>(url)

  const returnedSeason = body.schedulePeriod?.low?.season ?? null
  if (returnedSeason !== season) {
    throw new FleaflickerSeasonMismatchError(season, returnedSeason)
  }

  const periods = (body.eligibleSchedulePeriods ?? [])
    .map((p) => p.value ?? p.ordinal)
    .filter((n): n is number => Number.isInteger(n) && (n as number) > 0)
  const currentPeriod = body.schedulePeriod?.value ?? body.schedulePeriod?.ordinal ?? null

  /*
   * ⚠ NO `games` KEY IS A REAL, NON-ERROR STATE — a league that has not drafted
   * has no generated schedule and the key is ABSENT, not empty. Returning null
   * for the week (rather than an empty games array) keeps that distinguishable
   * from "this week exists and has no games", which is what a bye week might
   * look like if G-06 ever gets observed.
   */
  const games = body.games
  const week =
    games == null
      ? null
      : {
          week: scoringPeriod ?? currentPeriod ?? 0,
          season: returnedSeason,
          games,
        }

  return { week, periods, currentPeriod }
}

/**
 * The league's scoring rules and roster shape.
 *
 * ⚠ TAKES NO `season`, AND THAT IS THE MODEL RATHER THAN AN OVERSIGHT: rules
 * belong to the league, not to a year. Sending one would document a response to
 * a request nobody makes — see `contracts/fleaflicker/ENDPOINTS.yaml`.
 *
 * ⚠ SO THE SEASON-CLAMP GUARD THAT `fetchFleaflickerScoreboard` CARRIES DOES NOT
 * APPLY HERE, and its absence is deliberate rather than forgotten. There is no
 * season to be clamped and no `schedulePeriod` to check one against.
 */
export async function fetchFleaflickerRules(
  sport: FleaflickerSport,
  leagueId: number,
): Promise<FleaflickerRulesResponse> {
  const url =
    `${API_BASE}/FetchLeagueRules?sport=${encodeURIComponent(sport)}&league_id=${leagueId}`
  return fetchJson<FleaflickerRulesResponse>(url)
}

/**
 * The league's draft board for one season.
 *
 * ⚠ THIS ONE *DOES* TAKE A SEASON, UNLIKE `fetchFleaflickerRules` DIRECTLY ABOVE,
 * and the two sit together deliberately so the difference is visible. Fleaflicker's
 * endpoints split into a family that accepts `season` and a family that returns
 * HTTP 400 if you send one — see `common_query_params.season` in
 * `contracts/fleaflicker/ENDPOINTS.yaml`. One shared URL builder breaks both.
 *
 * 🛑 AND THE SEASON-CLAMP GUARD CANNOT BE APPLIED HERE, WHICH IS A GAP RATHER THAN
 * A DECISION. `fetchFleaflickerScoreboard` can verify what it got because a
 * scoreboard carries `schedulePeriod.low.season`. A draft board carries NO season
 * marker in either envelope — `{draftOrder, rows, rosters}` and
 * `{orderedSelections}` both lack one. So a request for a season past the league's
 * last is silently clamped exactly as elsewhere, and nothing in the response can
 * detect it. Callers get whatever season Fleaflicker decided to serve, and this
 * function cannot tell them which. Do not add a guard that reads back the requested
 * season and calls it verified — that is the circular check the standings note in
 * ENDPOINTS.yaml already retracts.
 *
 * `draft_number` defaults to 1. ⚠ Without it the endpoint still answers 200, so its
 * absence is not the cause of an empty board — measured both ways.
 */
export async function fetchFleaflickerDraftBoard(
  sport: FleaflickerSport,
  leagueId: number,
  season: number,
  draftNumber = 1,
): Promise<FleaflickerDraftBoardResponse> {
  const url =
    `${API_BASE}/FetchLeagueDraftBoard?sport=${encodeURIComponent(sport)}` +
    `&league_id=${leagueId}&season=${season}&draft_number=${draftNumber}`
  return fetchJson<FleaflickerDraftBoardResponse>(url)
}
