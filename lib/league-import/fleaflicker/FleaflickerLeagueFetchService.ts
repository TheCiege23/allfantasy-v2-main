import type { ResourceFetchStatus } from '@/lib/league-import/resourceStatus'
import type {
  FleaflickerImportPayload,
  FleaflickerSport,
  FleaflickerStandingsResponse,
  FleaflickerRostersResponse,
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
   * ⚠ THE ROSTER READ IS STILL ALLOWED TO FAIL WITHOUT SINKING THE IMPORT — a league with
   * readable standings and an unreadable roster endpoint is worth importing. What changed is
   * that the failure is now RECORDED rather than disguised as an empty league.
   */
  let rostersStatus: ResourceFetchStatus = 'fetched'
  const [standings, rosters] = await Promise.all([
    fetchJson<FleaflickerStandingsResponse>(standingsUrl),
    fetchJson<FleaflickerRostersResponse>(rostersUrl).catch((e: unknown) => {
      const status = (e as { status?: number } | undefined)?.status
      rostersStatus = status === 401 || status === 403 ? 'unauthorized' : 'failed'
      return { rosters: [] }
    }),
  ])
  if (rostersStatus === 'fetched' && (rosters.rosters ?? []).length === 0) {
    rostersStatus = 'fetched_empty'
  }

  if (!standings?.league?.id) {
    throw new FleaflickerImportLeagueNotFoundError('Fleaflicker response missing league object.')
  }

  return {
    sport,
    season: standings.season ?? season,
    standings,
    rosters,
    rostersStatus,
  }
}
