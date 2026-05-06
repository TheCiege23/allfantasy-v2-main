/**
 * TheSportsDB v1 (key-in-path) and v2 (X-API-KEY header) URL helpers.
 * Never logs API keys. Does not perform HTTP.
 */

export const THE_SPORTS_DB_V1_JSON_BASE = 'https://www.thesportsdb.com/api/v1/json'

export const THE_SPORTS_DB_V2_JSON_BASE = 'https://www.thesportsdb.com/api/v2/json'

/** Common v1 PHP entrypoints from public docs. */
export const THE_SPORTS_DB_V1_FILES = {
  searchTeams: 'searchteams.php',
  searchPlayers: 'searchplayers.php',
  lookupLeague: 'lookupleague.php',
  lookupTeam: 'lookupteam.php',
  lookupPlayer: 'lookupplayer.php',
  lookupHonours: 'lookuphonours.php',
  lookupFormerTeams: 'lookupformerteams.php',
  lookupMilestones: 'lookupmilestones.php',
  lookupContracts: 'lookupcontracts.php',
  playerResults: 'playerresults.php',
  searchAllTeams: 'search_all_teams.php',
  lookupAllPlayers: 'lookup_all_players.php',
  eventsNext: 'eventsnext.php',
  eventsLast: 'eventslast.php',
  eventsNextLeague: 'eventsnextleague.php',
  eventsPastLeague: 'eventspastleague.php',
  eventsDay: 'eventsday.php',
  eventsSeason: 'eventsseason.php',
  lookupEvent: 'lookupevent.php',
  lookupEventStats: 'lookupeventstats.php',
  lookupLineup: 'lookuplineup.php',
  lookupTimeline: 'lookuptimeline.php',
} as const

export type TheSportsDbV1Endpoint = keyof typeof THE_SPORTS_DB_V1_FILES

export type BuildTheSportsDbV1UrlOptions = {
  /** Defaults to public free test key `123` when omitted — swap for premium in production via env at call site. */
  apiKey?: string
  params?: Record<string, string | number | undefined | null>
}

/** v1: API key is first path segment after `/json/`. */
export function buildTheSportsDbV1Url(
  endpoint: TheSportsDbV1Endpoint,
  options: BuildTheSportsDbV1UrlOptions = {},
): string {
  const key = (options.apiKey ?? '123').trim()
  const file = THE_SPORTS_DB_V1_FILES[endpoint]
  const url = new URL(`${THE_SPORTS_DB_V1_JSON_BASE}/${key}/${file}`)
  for (const [k, v] of Object.entries(options.params ?? {})) {
    if (v === undefined || v === null || v === '') continue
    url.searchParams.set(k, String(v))
  }
  return url.toString()
}

export type TheSportsDbV2Endpoint =
  | 'searchLeague'
  | 'searchTeam'
  | 'searchPlayer'
  | 'lookupLeague'
  | 'lookupTeam'
  | 'lookupPlayer'
  | 'lookupPlayerContracts'
  | 'lookupPlayerResults'
  | 'lookupPlayerHonours'
  | 'lookupPlayerMilestones'
  | 'lookupPlayerTeams'
  | 'listTeams'
  | 'listPlayers'
  | 'scheduleLeagueSeason'
  | 'livescoreSport'
  | 'livescoreLeague'
  | 'livescoreAll'

export type BuildTheSportsDbV2PathOptions = {
  query?: string
  idLeague?: string | number
  idTeam?: string | number
  idPlayer?: string | number
  season?: string | number
  sportSlug?: string
}

/** v2 path only — caller adds `X-API-KEY` header when fetching. No key in URL. */
export function buildTheSportsDbV2Path(
  endpoint: TheSportsDbV2Endpoint,
  options: BuildTheSportsDbV2PathOptions = {},
): string {
  const q = encodeURIComponent(String(options.query ?? '').trim())
  const idL = options.idLeague != null ? encodeURIComponent(String(options.idLeague)) : ''
  const idT = options.idTeam != null ? encodeURIComponent(String(options.idTeam)) : ''
  const idP = options.idPlayer != null ? encodeURIComponent(String(options.idPlayer)) : ''
  const season = options.season != null ? encodeURIComponent(String(options.season)) : ''
  const sport = (options.sportSlug ?? '').trim()

  switch (endpoint) {
    case 'searchLeague':
      return `/api/v2/json/search/league/${q || '_'}`
    case 'searchTeam':
      return `/api/v2/json/search/team/${q || '_'}`
    case 'searchPlayer':
      return `/api/v2/json/search/player/${q || '_'}`
    case 'lookupLeague':
      return `/api/v2/json/lookup/league/${idL || '_'}`
    case 'lookupTeam':
      return `/api/v2/json/lookup/team/${idT || '_'}`
    case 'lookupPlayer':
      return `/api/v2/json/lookup/player/${idP || '_'}`
    case 'lookupPlayerContracts':
      return `/api/v2/json/lookup/player_contracts/${idP || '_'}`
    case 'lookupPlayerResults':
      return `/api/v2/json/lookup/player_results/${idP || '_'}`
    case 'lookupPlayerHonours':
      return `/api/v2/json/lookup/player_honours/${idP || '_'}`
    case 'lookupPlayerMilestones':
      return `/api/v2/json/lookup/player_milestones/${idP || '_'}`
    case 'lookupPlayerTeams':
      return `/api/v2/json/lookup/player_teams/${idP || '_'}`
    case 'listTeams':
      return `/api/v2/json/list/teams/${idL || '_'}`
    case 'listPlayers':
      return `/api/v2/json/list/players/${idT || '_'}`
    case 'scheduleLeagueSeason':
      return `/api/v2/json/schedule/league/${idL || '_'}/${season || '_'}`
    case 'livescoreSport':
      return `/api/v2/json/livescore/${sport || '_'}`
    case 'livescoreLeague':
      return `/api/v2/json/livescore/${idL || '_'}`
    case 'livescoreAll':
      return `/api/v2/json/livescore/all`
    default:
      return '/api/v2/json/livescore/all'
  }
}

export function buildTheSportsDbV2Url(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `https://www.thesportsdb.com${p}`
}

export type TheSportsDbImagePreviewSize = 'medium' | 'small' | 'tiny'

/** Append vendor preview segment (`/medium`, `/small`, `/tiny`). Strips prior size suffix if present. */
export function getTheSportsDbImagePreviewUrl(url: string, size: TheSportsDbImagePreviewSize): string {
  const trimmed = url.trim()
  if (!trimmed) return trimmed
  const without = trimmed.replace(/\/(medium|small|tiny)$/i, '')
  return `${without.replace(/\/+$/, '')}/${size}`
}
