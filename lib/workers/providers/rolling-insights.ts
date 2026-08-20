import {
  type ApiChainSport,
  type ApiFetchParams,
  type ChainFetchResult,
  toApiChainSport,
} from '@/lib/workers/api-config'
import { getRollingInsightsConfigFromEnv } from '@/lib/provider-config'

const DEFAULT_RI_GRAPHQL_URL = 'https://datafeeds.rolling-insights.com/graphql'
// These are tried in order as fallbacks. A plaintext entry meant that any TLS
// failure silently downgraded the request — and RSC_token rides in the query
// string, so the downgrade leaks a long-lived credential. https only.
// contracts/rolling-insights/ENDPOINTS.yaml: auth.https_required.
const DEFAULT_RI_REST_BASES = ['https://rest.datafeeds.rolling-insights.com/api/v1'] as const
const SPORT_PATH: Record<ApiChainSport, string> = {
  nfl: 'nfl',
  mlb: 'mlb',
  nhl: 'nhl',
  nba: 'nba',
  ncaab: 'ncaab',
  ncaaf: 'ncaaf',
  soccer_euro: 'soccer/euro',
  soccer_mls: 'soccer/mls',
}

const REST_SPORT_CODES: Record<ApiChainSport, string[]> = {
  nfl: ['NFL'],
  mlb: ['MLB'],
  nhl: ['NHL'],
  nba: ['NBA'],
  ncaab: ['NCAABB', 'NCAAB'],
  ncaaf: ['NCAAFB', 'NCAAF'],
  soccer_euro: ['SOCCER', 'SOCCER_EURO', 'EURO_SOCCER'],
  soccer_mls: ['MLS', 'SOCCER_MLS', 'MLS_SOCCER'],
}

const DATA_TYPE_PATH: Record<string, string> = {
  players: 'players',
  teams: 'teams',
  injuries: 'injuries',
  news: 'news',
  scores: 'scores',
  schedule: 'schedule',
  standings: 'standings',
  projections: 'projections',
  rankings: 'rankings',
  adp: 'adp',
  roster: 'rosters',
}

function pathSegmentForDataType(dataType: string): string {
  if (DATA_TYPE_PATH[dataType]) return DATA_TYPE_PATH[dataType]
  if (dataType === 'games' || dataType === 'live_game') return 'scores'
  if (dataType === 'player_headshots') return 'players'
  if (dataType === 'team_logos') return 'teams'
  if (dataType === 'rolling_insights') return 'feed'
  if (dataType === 'trending') return 'trending'
  return dataType
}

function extractPayload(json: unknown): unknown {
  if (json == null) return null
  if (Array.isArray(json)) return json
  if (typeof json === 'object') {
    const o = json as Record<string, unknown>
    if (Array.isArray(o.data)) return o.data
    if (o.data && typeof o.data === 'object') {
      const nested = o.data as Record<string, unknown>
      for (const value of Object.values(nested)) {
        if (Array.isArray(value)) return value
      }
    }
    if (Array.isArray(o.results)) return o.results
    if (Array.isArray(o.items)) return o.items
  }
  return json
}

interface RollingInsightsAccessToken {
  value: string
  expiresAtMs: number
}

let cachedAccessToken: RollingInsightsAccessToken | null = null
const RI_REQUEST_TIMEOUT_MS = 10_000
const RI_REST_PROBE_BUDGET_MS = 30_000
const RI_SOCCER_REST_PROBE_BUDGET_MS = 12_000

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function splitEnvList(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((v) => normalizeBaseUrl(v))
    .filter(Boolean)
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values))
}

function buildRestBaseCandidates(configBase: string): string[] {
  const explicit = splitEnvList(process.env.ROLLING_INSIGHTS_REST_BASE_URL)
  const normalizedConfig = normalizeBaseUrl(configBase)
  const derivedFromConfig = [normalizedConfig, `${normalizedConfig}/api/v1`]

  return dedupe([...explicit, ...derivedFromConfig, ...DEFAULT_RI_REST_BASES])
}

function requestedYearFromQuery(query: Record<string, unknown>): string {
  const raw = String(query.season ?? query.year ?? '').trim()
  if (/^\d{4}/.test(raw)) return raw.slice(0, 4)
  return String(new Date().getUTCFullYear())
}

function buildRestPathCandidates(
  dataSeg: string,
  chainSport: ApiChainSport,
  requestedYear = String(new Date().getUTCFullYear()),
): string[] {
  const sportCodes = REST_SPORT_CODES[chainSport]
  const sportLower = SPORT_PATH[chainSport]
  const year = requestedYear
  const today = new Date().toISOString().slice(0, 10)

  // Soccer endpoints are significantly less consistent; keep probes intentionally narrow
  // to avoid long tail timeouts from broad host/path permutations.
  if (chainSport === 'soccer_euro') {
    const soccerCode = 'SOCCER'
    const byDataSeg: Record<string, string[]> = {
      players: [`player-info/${soccerCode}`],
      teams: [`team-info/${soccerCode}`],
      injuries: [`injuries/${soccerCode}`],
      schedule: [`schedule-season/${year}/${soccerCode}`, `schedule/${today}/${soccerCode}`],
      scores: [`live/${today}/${soccerCode}`],
      standings: [`standings/${year}/${soccerCode}`],
      projections: [`player-stats/${year}/${soccerCode}`],
      adp: [`adp/${soccerCode}`],
      rosters: [`depth-charts/${soccerCode}`],
    }

    return dedupe([
      ...(byDataSeg[dataSeg] ?? []),
      `${dataSeg}/${soccerCode}`,
      `${soccerCode}/${dataSeg}`,
    ])
  }

  if (chainSport === 'soccer_mls') {
    const soccerCode = 'MLS'
    const byDataSeg: Record<string, string[]> = {
      players: [`player-info/${soccerCode}`],
      teams: [`team-info/${soccerCode}`],
      injuries: [`injuries/${soccerCode}`],
      schedule: [`schedule-season/${year}/${soccerCode}`, `schedule/${today}/${soccerCode}`],
      scores: [`live/${today}/${soccerCode}`],
      standings: [`standings/${year}/${soccerCode}`],
      projections: [`player-stats/${year}/${soccerCode}`],
      adp: [`adp/${soccerCode}`],
      rosters: [`depth-charts/${soccerCode}`],
    }

    return dedupe([
      ...(byDataSeg[dataSeg] ?? []),
      `${dataSeg}/${soccerCode}`,
      `${soccerCode}/${dataSeg}`,
    ])
  }

  const pathBySportCode = (sportCode: string): Record<string, string[]> => ({
    players: [`player-info/${sportCode}`],
    injuries: [`injuries/${sportCode}`],
    teams: [`team-info/${sportCode}`],
    /**
     * Rolling Insights has NO projections feed. Verified 2026-08-10 against the
     * official NFL docs (schedule, live feed, team info, team stats, player info,
     * player stats, injuries, depth charts, DK fantasy points, play-by-play) and
     * by probing every candidate below — only `player-stats` resolves, and it
     * returns HISTORICAL production, not a forecast.
     *
     * `player-stats` was previously the FIRST candidate here, which made the
     * `projections` dataType silently resolve to last season's actuals. It never
     * shipped bad numbers only because those rows carry no
     * projectedPoints/points/fpts field for persistProjectionRows() to read, and
     * because the current-season lookup 304s before kickoff. Both are accidents,
     * not safeguards.
     *
     * Do NOT re-add player-stats here. It is an INPUT to the AF projection engine
     * (see AF_PROJECTIONS_ENGINE_BRIEF.md), consumed under the `player_stats`
     * dataType and written to AFProjectionSnapshot after computation — never
     * echoed straight into a field the product labels "projected".
     */
    projections: [
      `projections/${year}/${sportCode}`,
      `projection-stats/${year}/${sportCode}`,
      `projected-stats/${year}/${sportCode}`,
      `fantasy-projections/${year}/${sportCode}`,
    ],
    /** Historical production — the projection engine's base. Confirmed 2182 NFL rows for 2025. */
    player_stats: [`player-stats/${year}/${sportCode}`, `player-stats/${sportCode}`],
    adp: [
      `adp/${sportCode}`,
      `adp/${year}/${sportCode}`,
      `average-draft-position/${sportCode}`,
      `average-draft-position/${year}/${sportCode}`,
      `player-adp/${sportCode}`,
      `draft-adp/${sportCode}`,
    ],
    scores: [`live/${today}/${sportCode}`],
    schedule: [
      `schedule-season/${year}/${sportCode}`,
      `schedule-week/${today}/${sportCode}`,
      `schedule/${today}/${sportCode}`,
    ],
    rosters: [`depth-charts/${sportCode}`],
  })

  const allCandidates: string[] = []
  for (const sportCode of sportCodes) {
    const byDataSeg = pathBySportCode(sportCode)
    allCandidates.push(
      ...(byDataSeg[dataSeg] ?? []),
      `${dataSeg}/${sportCode}`,
      `${sportCode}/${dataSeg}`,
      `${dataSeg}/${sportLower}`
    )
  }

  return dedupe(allCandidates)
}

function collectRscTokenCandidates(accessToken: string): string[] {
  return dedupe(
    [
      process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim(),
      process.env.ROLLING_INSIGHTS_RSC_TOKEN2?.trim(),
      process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim(),
      process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim(),
      accessToken,
    ].filter(Boolean) as string[]
  )
}

interface RiGraphqlPlayer {
  id?: string | number
  player?: string
  position?: string
  status?: string
  team?: { abbrv?: string | null } | null
  // NFL fields
  regularSeason?: Array<{
    DK_fantasy_points?: number | null
    DK_fantasy_points_per_game?: number | null
    games_played?: number | null
    // MLB fields
    gamesPlayed?: number | null
    batting?: {
      HR?: number | null
      RBI?: number | null
      H?: number | null
      SB?: number | null
    } | null
  }> | null
}

// Sports supported by RI GraphQL roster queries
const RI_GRAPHQL_ROSTER_QUERY: Partial<Record<ApiChainSport, string>> = {
  nfl: 'nflRoster',
  mlb: 'mlbRoster',
}

// Sport-specific GraphQL query bodies
const RI_GRAPHQL_QUERY_BODY: Partial<Record<ApiChainSport, string>> = {
  nfl: `{
    nflRoster {
      id
      player
      position
      status
      team { abbrv }
      regularSeason {
        DK_fantasy_points
        DK_fantasy_points_per_game
        games_played
      }
    }
  }`,
  mlb: `{
    mlbRoster {
      id
      player
      position
      status
      team { abbrv }
      regularSeason {
        batting { HR RBI H SB }
      }
    }
  }`,
}

/** Fetch a fresh bearer token for an arbitrary client_id/client_secret pair. */
async function fetchRiToken(clientId: string, clientSecret: string): Promise<string | null> {
  if (!clientId || !clientSecret) return null
  try {
    const res = await fetch('https://datafeeds.rolling-insights.com/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(RI_REQUEST_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      access_token?: string
      token?: string
      rsc_token?: string
      RSC_token?: string
    }
    return json.access_token ?? json.token ?? json.rsc_token ?? json.RSC_token ?? null
  } catch {
    return null
  }
}

/** Collect all available bearer tokens (primary + secondary credentials). */
async function collectAllRiTokens(passedToken: string): Promise<string[]> {
  const [primary, secondary] = await Promise.all([
    fetchRiToken(
      process.env.ROLLING_INSIGHTS_CLIENT_ID?.trim() ?? '',
      process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim() ?? ''
    ),
    fetchRiToken(
      process.env.ROLLING_INSIGHTS_CLIENT_ID2?.trim() ?? '',
      process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim() ?? ''
    ),
  ])
  return dedupe([passedToken, primary, secondary].filter(Boolean) as string[])
}

/**
 * Generic GraphQL roster fallback for RI-supported sports (NFL, MLB).
 * Tries every available token × every GraphQL endpoint.
 */
async function fetchPlayersFromGraphql(
  sport: ApiChainSport,
  passedToken: string,
  configBase: string
): Promise<unknown[] | null> {
  const queryName = RI_GRAPHQL_ROSTER_QUERY[sport]
  const queryBody = RI_GRAPHQL_QUERY_BODY[sport]
  if (!queryName || !queryBody) return null

  const explicitGraphqlUrl = process.env.ROLLING_INSIGHTS_GRAPHQL_URL?.trim()
  const urls = dedupe(
    [explicitGraphqlUrl, `${normalizeBaseUrl(configBase)}/graphql`, DEFAULT_RI_GRAPHQL_URL].filter(
      Boolean
    ) as string[]
  )

  const tokens = await collectAllRiTokens(passedToken)

  for (const gqlUrl of urls) {
    for (const token of tokens) {
      try {
        const res = await fetch(gqlUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ query: queryBody }),
          cache: 'no-store',
          signal: AbortSignal.timeout(RI_REQUEST_TIMEOUT_MS),
        })

        if (!res.ok) continue
        const json = (await res.json()) as {
          data?: Record<string, RiGraphqlPlayer[]>
          errors?: Array<{ message?: string }>
        }
        if (json.errors?.length) continue

        const players = json.data?.[queryName] ?? []
        if (!players.length) continue

        return players.map((p) => {
          const season = Array.isArray(p.regularSeason) ? p.regularSeason[0] : null
          return {
            id: p.id,
            full_name: p.player,
            position: p.position,
            team_abbr: p.team?.abbrv ?? null,
            status: p.status,
            season_stats: {
              // NFL DraftKings fantasy points
              fantasy_points: season?.DK_fantasy_points ?? null,
              fantasy_points_per_game: season?.DK_fantasy_points_per_game ?? null,
              games_played: season?.games_played ?? season?.gamesPlayed ?? null,
              // MLB batting stats
              hr: season?.batting?.HR ?? null,
              rbi: season?.batting?.RBI ?? null,
              hits: season?.batting?.H ?? null,
              sb: season?.batting?.SB ?? null,
            },
          }
        })
      } catch {
        // try next token / host
      }
    }
  }

  return null
}

async function getClientCredentialsAccessToken(baseUrl: string): Promise<string> {
  const directRscToken = process.env.ROLLING_INSIGHTS_RSC_TOKEN?.trim()

  if (cachedAccessToken && cachedAccessToken.expiresAtMs > Date.now() + 60_000) {
    return cachedAccessToken.value
  }

  // Try primary credentials, then secondary credentials (CLIENT_ID2 / CLIENT_SECRET2)
  const credentialPairs = [
    {
      clientId: process.env.ROLLING_INSIGHTS_CLIENT_ID?.trim() ?? '',
      clientSecret: process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim() ?? '',
    },
    {
      clientId: process.env.ROLLING_INSIGHTS_CLIENT_ID2?.trim() ?? '',
      clientSecret: process.env.ROLLING_INSIGHTS_CLIENT_SECRET2?.trim() ?? '',
    },
  ].filter((p) => p.clientId && p.clientSecret)

  if (!credentialPairs.length) {
    if (directRscToken) return directRscToken
    throw new Error('Rolling Insights client credentials not configured')
  }

  const authEndpoints = dedupe([
    process.env.ROLLING_INSIGHTS_AUTH_URL?.trim() ?? '',
    'https://datafeeds.rolling-insights.com/auth/token',
    `${baseUrl}/auth/token`,
    'https://rest.datafeeds.rolling-insights.com/oauth/token',
  ].filter(Boolean))

  let lastStatus: number | null = null
  for (const { clientId, clientSecret } of credentialPairs) {
    for (const endpoint of authEndpoints) {
      try {
        const tokenRes = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
          }),
          cache: 'no-store',
          signal: AbortSignal.timeout(RI_REQUEST_TIMEOUT_MS),
        })

        lastStatus = tokenRes.status
        if (!tokenRes.ok) continue

        const tokenJson = (await tokenRes.json()) as {
          access_token?: string
          token?: string
          rsc_token?: string
          RSC_token?: string
          expires_in?: number
          expiry?: string
        }
        const token = tokenJson.access_token ?? tokenJson.token ?? tokenJson.rsc_token ?? tokenJson.RSC_token
        if (!token) continue

        const expiresInSec = Number(tokenJson.expires_in ?? 3600)
        cachedAccessToken = {
          value: token,
          expiresAtMs: Date.now() + Math.max(expiresInSec, 300) * 1000,
        }
        return token
      } catch {
        // try next credentials / endpoint
      }
    }
  }

  if (directRscToken) return directRscToken
  throw new Error(`Auth failed${lastStatus ? ` (${lastStatus})` : ''}`)
}

/**
 * Primary Rolling Insights REST fetch for all 7 sports.
 * Always returns { data, fromCache: false, error? }.
 */
export async function rollingInsightsProvider(params: ApiFetchParams): Promise<ChainFetchResult> {
  const config = getRollingInsightsConfigFromEnv()
  if (!config) {
    console.error('[rolling-insights] credentials not configured')
    return { data: null, error: 'credentials not configured', fromCache: false }
  }

  const chainSport = toApiChainSport(params.sport as string)
  if (!chainSport) {
    return { data: null, error: 'Unsupported sport', fromCache: false }
  }

  // Soccer player-info endpoints are inconsistent in RI REST and can induce long probe delays.
  // Fail fast so DB/api-sports fallback can respond quickly in the chain.
  if ((chainSport === 'soccer_euro' || chainSport === 'soccer_mls') && String(params.dataType) === 'players') {
    return {
      data: null,
      error: 'RI soccer players unavailable',
      fromCache: false,
      source: 'rolling_insights',
      latency: 0,
    }
  }

  const base = config.baseUrl
  const dataSeg = pathSegmentForDataType(String(params.dataType))
  const merged = { ...(params.query ?? {}), ...(params.options ?? {}) }

  const started = Date.now()
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
    }
    const hasClientCredentials =
      Boolean(process.env.ROLLING_INSIGHTS_CLIENT_ID?.trim()) &&
      Boolean(process.env.ROLLING_INSIGHTS_CLIENT_SECRET?.trim())

    if (config.authMode === 'api_key') {
      const sportSeg = SPORT_PATH[chainSport]
      const url = new URL(`${base}/${sportSeg}/${dataSeg}`)
      Object.entries(merged).forEach(([k, v]) => {
        if (v == null) return
        url.searchParams.set(k, String(v))
      })

      headers['x-api-key'] = process.env.ROLLING_INSIGHTS_API_KEY ?? ''
      const res = await fetch(url.toString(), {
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(RI_REQUEST_TIMEOUT_MS),
      })
      if (!res.ok) {
        const err = `HTTP ${res.status}`
        if (!hasClientCredentials) {
          console.warn(`[rolling-insights] ${err} ${chainSport}/${params.dataType}`)
          return { data: null, error: err, fromCache: false }
        }
        console.warn(
          `[rolling-insights] ${err} ${chainSport}/${params.dataType}; falling back to client_credentials`
        )
      } else {
        const json = await res.json()
        const data = extractPayload(json)
        return {
          data: data as ChainFetchResult['data'],
          fromCache: false,
          source: 'rolling_insights',
          latency: Date.now() - started,
        }
      }
    }

    const accessToken = await getClientCredentialsAccessToken(base)
    let rscTokenCandidates = collectRscTokenCandidates(accessToken)

    let restBases = buildRestBaseCandidates(base)
    const restPaths = buildRestPathCandidates(dataSeg, chainSport, requestedYearFromQuery(merged))

    if (chainSport === 'soccer_euro' || chainSport === 'soccer_mls') {
      // Keep soccer probing intentionally tight to reduce worst-case latency.
      restBases = restBases.slice(0, 1)
      rscTokenCandidates = rscTokenCandidates.slice(0, 2)
    }

    let lastHttpError: string | null = null
    const probeBudgetMs =
      chainSport === 'soccer_euro' || chainSport === 'soccer_mls'
        ? RI_SOCCER_REST_PROBE_BUDGET_MS
        : RI_REST_PROBE_BUDGET_MS
    const probeDeadlineAt = Date.now() + probeBudgetMs

    restProbe: for (const restBase of restBases) {
      for (const restPath of restPaths) {
        for (const rscToken of rscTokenCandidates) {
          if (Date.now() >= probeDeadlineAt) {
            lastHttpError = `Probe timeout after ${probeBudgetMs}ms`
            break restProbe
          }

          const url = new URL(`${restBase}/${restPath}`)
          Object.entries(merged).forEach(([k, v]) => {
            if (v == null) return
            url.searchParams.set(k, String(v))
          })
          url.searchParams.set('RSC_token', rscToken)

          try {
            const res = await fetch(url.toString(), {
              headers,
              cache: 'no-store',
              signal: AbortSignal.timeout(RI_REQUEST_TIMEOUT_MS),
            })
            if (res.status === 304) {
              const isLiveLike = dataSeg === 'scores' || dataSeg === 'schedule'
              if (isLiveLike) {
                return {
                  data: [] as ChainFetchResult['data'],
                  fromCache: false,
                  source: 'rolling_insights',
                  latency: Date.now() - started,
                }
              }
              lastHttpError = 'HTTP 304'
              continue
            }
            if (!res.ok) {
              lastHttpError = `HTTP ${res.status}`
              continue
            }

            const json = await res.json()
            const data = extractPayload(json)
            return {
              data: data as ChainFetchResult['data'],
              fromCache: false,
              source: 'rolling_insights',
              latency: Date.now() - started,
            }
          } catch {
            // Continue probing other REST host/path/token candidates.
          }
        }
      }
    }

    if (params.dataType === 'players' && RI_GRAPHQL_ROSTER_QUERY[chainSport]) {
      const gqlPlayers = await fetchPlayersFromGraphql(chainSport, accessToken, base)
      if (Array.isArray(gqlPlayers) && gqlPlayers.length > 0) {
        return {
          data: gqlPlayers as ChainFetchResult['data'],
          fromCache: false,
          source: 'rolling_insights',
          latency: Date.now() - started,
        }
      }
    }

    const err = lastHttpError ?? 'No successful Rolling Insights REST/GraphQL response'
    console.warn(`[rolling-insights] ${err} ${chainSport}/${params.dataType}`)
    return { data: null, error: err, fromCache: false }
  } catch (e) {
    console.warn(`[rolling-insights] fetch failed ${chainSport}/${params.dataType}:`, e)
    return { data: null, error: e instanceof Error ? e.message : 'Request failed', fromCache: false }
  }
}

/** @deprecated Use rollingInsightsProvider — kept for incremental migration. */
export async function rollingInsightsProviderFetch(params: ApiFetchParams): Promise<ChainFetchResult> {
  return rollingInsightsProvider(params)
}
