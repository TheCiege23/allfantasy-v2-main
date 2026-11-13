import { prisma } from './prisma'
import { normalizeTeamAbbrev, normalizePosition } from './team-abbrev'
import { rateLimitManager } from '@/lib/workers/rate-limit-manager'

const BASE_URL = 'https://v3.football.api-sports.io'

interface ProviderCallDiagnostic {
  provider: 'api_football'
  endpoint: string
  params: Record<string, string>
  url: string
  status: number | null
  ok: boolean
  error: string | null
  at: string
}

const apiFootballDiagnostics: ProviderCallDiagnostic[] = []
const MAX_DIAGNOSTIC_ROWS = 100

function pushApiFootballDiagnostic(row: ProviderCallDiagnostic) {
  apiFootballDiagnostics.push(row)
  if (apiFootballDiagnostics.length > MAX_DIAGNOSTIC_ROWS) {
    apiFootballDiagnostics.splice(0, apiFootballDiagnostics.length - MAX_DIAGNOSTIC_ROWS)
  }
}

export function clearAPIFootballDiagnostics() {
  apiFootballDiagnostics.length = 0
}

export function getAPIFootballDiagnostics(): ProviderCallDiagnostic[] {
  return apiFootballDiagnostics.map((row) => ({ ...row, params: { ...row.params } }))
}

const requestQueue: Array<() => void> = []
let queueBusy = false

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestQueue.push(async () => {
      try {
        const out = await fn()
        resolve(out)
      } catch (error) {
        reject(error)
      }
    })

    if (!queueBusy) {
      queueBusy = true
      void drainQueue()
    }
  })
}

async function drainQueue() {
  while (requestQueue.length > 0) {
    const next = requestQueue.shift()
    if (next) {
      await next()
      await new Promise((r) => setTimeout(r, 120))
    }
  }
  queueBusy = false
}

function getFootballApiKey(): string {
  const apiKey =
    process.env.API_FOOTBALL_KEY ||
    process.env.APISPORTS_FOOTBALL_KEY ||
    process.env.API_SPORTS_KEY

  if (!apiKey) {
    throw new Error('API_FOOTBALL_KEY/API_SPORTS_KEY not configured')
  }

  return apiKey
}

function getCurrentSoccerSeasonForAPIFootball(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  return month >= 7 ? String(year) : String(year - 1)
}

function getDefaultSoccerLeagueForAPIFootball(): string {
  return process.env.API_FOOTBALL_DEFAULT_LEAGUE || process.env.THESPORTSDB_SOCCER_LEAGUE_ID || '39'
}

interface ApiFootballEnvelope<T> {
  response: T[]
  paging?: {
    current?: number
    total?: number
  }
}

async function apiFootballFetch<T>(endpoint: string, params?: Record<string, string>): Promise<T[]> {
  const out = await apiFootballFetchEnvelope<T>(endpoint, params)
  return out.response || []
}

async function apiFootballFetchEnvelope<T>(endpoint: string, params?: Record<string, string>): Promise<ApiFootballEnvelope<T>> {
  return enqueue(async () => {
    const apiKey = getFootballApiKey()

    if (!(await rateLimitManager.canCall('api_football', endpoint))) {
      await rateLimitManager.recordCall('api_football', endpoint, 429, 0, { cached: true, error: 'rate_limit_guard' })
      const fallbackType = endpoint.includes('fixture')
        ? 'schedule'
        : endpoint.includes('standing')
          ? 'standings'
          : endpoint.includes('team')
            ? 'teams'
            : 'players'
      const fallback = await rateLimitManager.getFallback('api_football', fallbackType)
      return { response: Array.isArray(fallback) ? fallback : [] } as ApiFootballEnvelope<T>
    }

    const url = new URL(`${BASE_URL}/${endpoint}`)
    const paramCopy: Record<string, string> = {}
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v)
        paramCopy[k] = v
      }
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'x-apisports-key': apiKey,
        },
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (!response.ok) {
        await rateLimitManager.recordCall('api_football', endpoint, response.status, 0, { error: response.statusText })
        pushApiFootballDiagnostic({
          provider: 'api_football',
          endpoint,
          params: paramCopy,
          url: url.toString(),
          status: response.status,
          ok: false,
          error: `HTTP ${response.status} ${response.statusText}`,
          at: new Date().toISOString(),
        })
        throw new Error(`API-Football request failed: ${response.status} ${response.statusText}`)
      }

      const parsed = (await response.json()) as ApiFootballEnvelope<T> & { errors?: Record<string, unknown> }
      await rateLimitManager.recordCall('api_football', endpoint, response.status, 0)

      if (parsed.errors && Object.keys(parsed.errors).length > 0) {
        pushApiFootballDiagnostic({
          provider: 'api_football',
          endpoint,
          params: paramCopy,
          url: url.toString(),
          status: response.status,
          ok: false,
          error: JSON.stringify(parsed.errors),
          at: new Date().toISOString(),
        })
        throw new Error(`API-Football error: ${JSON.stringify(parsed.errors)}`)
      }

      pushApiFootballDiagnostic({
        provider: 'api_football',
        endpoint,
        params: paramCopy,
        url: url.toString(),
        status: response.status,
        ok: true,
        error: null,
        at: new Date().toISOString(),
      })

      return {
        response: parsed.response || [],
        paging: parsed.paging,
      }
    } catch (error) {
      clearTimeout(timeout)
      pushApiFootballDiagnostic({
        provider: 'api_football',
        endpoint,
        params: paramCopy,
        url: url.toString(),
        status: null,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      })
      await rateLimitManager.recordCall('api_football', endpoint, 500, 0, {
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  })
}

interface APIFootballTeam {
  team: {
    id: number
    name: string
    code?: string | null
    country?: string | null
    logo?: string | null
  }
  venue?: {
    city?: string | null
  }
}

interface APIFootballFixture {
  fixture: {
    id: number
    date?: string | null
    timestamp?: number | null
    venue?: {
      name?: string | null
    }
    status?: {
      long?: string | null
      short?: string | null
    }
  }
  league: {
    id: number
    season: number
    round?: string | null
  }
  teams: {
    home: { id: number; name: string }
    away: { id: number; name: string }
  }
  goals?: {
    home?: number | null
    away?: number | null
  }
}

interface APIFootballStanding {
  rank: number
  points: number
  team: {
    id: number
    name: string
    logo?: string | null
  }
  all?: {
    played?: number
    win?: number
    draw?: number
    lose?: number
    goals?: {
      for?: number
      against?: number
    }
  }
  group?: string | null
}

interface APIFootballPlayerRecord {
  player: {
    id: number
    name: string
    age?: number | null
    height?: string | null
    weight?: string | null
    photo?: string | null
  }
  statistics?: Array<{
    team?: { id?: number; name?: string }
    league?: { season?: number }
    games?: {
      position?: string | null
      number?: number | null
    }
  }>
}

async function fetchAPIFootballTeams(league: string, season: string): Promise<APIFootballTeam[]> {
  return apiFootballFetch<APIFootballTeam>('teams', { league, season })
}

async function fetchAPIFootballFixtures(league: string, season: string): Promise<APIFootballFixture[]> {
  return apiFootballFetch<APIFootballFixture>('fixtures', { league, season })
}

async function fetchAPIFootballStandings(league: string, season: string): Promise<APIFootballStanding[]> {
  const response = await apiFootballFetch<{ league?: { standings?: APIFootballStanding[][] } }>('standings', {
    league,
    season,
  })

  const out: APIFootballStanding[] = []
  for (const row of response) {
    const groups = row?.league?.standings || []
    for (const g of groups) {
      for (const standing of g) {
        out.push(standing)
      }
    }
  }
  return out
}

async function fetchAPIFootballPlayersByTeam(teamId: string, season: string, maxPages = 2): Promise<APIFootballPlayerRecord[]> {
  const out: APIFootballPlayerRecord[] = []
  let page = 1

  while (page <= maxPages) {
    const pageResult = await apiFootballFetchEnvelope<APIFootballPlayerRecord>('players', {
      team: teamId,
      season,
      page: String(page),
    })

    const rows = pageResult.response || []
    if (rows.length === 0) break
    out.push(...rows)

    const total = pageResult.paging?.total || page
    if (page >= total) break
    page++
  }

  return out
}

function soccerTeamAbbrev(name: string, code?: string | null): string {
  const normalizedCode = normalizeTeamAbbrev(code || '')
  if (normalizedCode) return normalizedCode

  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length === 0) return name.slice(0, 3).toUpperCase()
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase()

  return parts
    .slice(0, 3)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
}

export async function syncAPIFootballTeamsToDb(opts?: { season?: string; league?: string }): Promise<number> {
  const season = opts?.season || getCurrentSoccerSeasonForAPIFootball()
  const league = opts?.league || getDefaultSoccerLeagueForAPIFootball()

  let teams: APIFootballTeam[]
  try {
    teams = await fetchAPIFootballTeams(league, season)
  } catch (error) {
    console.error('[API-Football] Failed to fetch teams:', error)
    return 0
  }

  let synced = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  for (const row of teams) {
    const team = row.team
    const shortName = soccerTeamAbbrev(team.name, team.code)

    try {
      await prisma.sportsTeam.upsert({
        where: {
          sport_externalId_source: {
            sport: 'SOCCER',
            externalId: String(team.id),
            source: 'api_football',
          },
        },
        update: {
          name: team.name,
          shortName,
          city: row.venue?.city || team.country || null,
          logo: team.logo || null,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport: 'SOCCER',
          externalId: String(team.id),
          name: team.name,
          shortName,
          city: row.venue?.city || team.country || null,
          logo: team.logo || null,
          source: 'api_football',
          fetchedAt: now,
          expiresAt,
        },
      })
      synced++
    } catch (error) {
      console.error(`[API-Football] Failed to upsert team ${team.name}:`, error)
    }
  }

  console.log(`[API-Football] Synced ${synced}/${teams.length} teams for league ${league} season ${season}`)
  return synced
}

export async function syncAPIFootballFixturesToDb(opts?: { season?: string; league?: string }): Promise<number> {
  const season = opts?.season || getCurrentSoccerSeasonForAPIFootball()
  const league = opts?.league || getDefaultSoccerLeagueForAPIFootball()

  let fixtures: APIFootballFixture[]
  try {
    fixtures = await fetchAPIFootballFixtures(league, season)
  } catch (error) {
    console.error('[API-Football] Failed to fetch fixtures:', error)
    return 0
  }

  let synced = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 2 * 60 * 1000)

  for (const f of fixtures) {
    const homeTeam = soccerTeamAbbrev(f.teams.home.name)
    const awayTeam = soccerTeamAbbrev(f.teams.away.name)

    try {
      await prisma.sportsGame.upsert({
        where: {
          sport_externalId_source: {
            sport: 'SOCCER',
            externalId: String(f.fixture.id),
            source: 'api_football',
          },
        },
        update: {
          homeTeam,
          awayTeam,
          homeTeamId: String(f.teams.home.id),
          awayTeamId: String(f.teams.away.id),
          homeScore: f.goals?.home ?? null,
          awayScore: f.goals?.away ?? null,
          status: f.fixture.status?.long || f.fixture.status?.short || null,
          startTime: f.fixture.timestamp ? new Date(f.fixture.timestamp * 1000) : (f.fixture.date ? new Date(f.fixture.date) : null),
          venue: f.fixture.venue?.name || null,
          season: f.league?.season ?? (Number.parseInt(season, 10) || null),
          raw: f as unknown as object,
          fetchedAt: now,
          expiresAt,
        },
        create: {
          sport: 'SOCCER',
          externalId: String(f.fixture.id),
          homeTeam,
          awayTeam,
          homeTeamId: String(f.teams.home.id),
          awayTeamId: String(f.teams.away.id),
          homeScore: f.goals?.home ?? null,
          awayScore: f.goals?.away ?? null,
          status: f.fixture.status?.long || f.fixture.status?.short || null,
          startTime: f.fixture.timestamp ? new Date(f.fixture.timestamp * 1000) : (f.fixture.date ? new Date(f.fixture.date) : null),
          venue: f.fixture.venue?.name || null,
          season: f.league?.season ?? (Number.parseInt(season, 10) || null),
          source: 'api_football',
          raw: f as unknown as object,
          fetchedAt: now,
          expiresAt,
        },
      })
      synced++
    } catch (error) {
      console.error(`[API-Football] Failed to upsert fixture ${f.fixture.id}:`, error)
    }
  }

  console.log(`[API-Football] Synced ${synced}/${fixtures.length} fixtures for league ${league} season ${season}`)
  return synced
}

export async function syncAPIFootballStandingsToDb(opts?: { season?: string; league?: string }): Promise<number> {
  const season = opts?.season || getCurrentSoccerSeasonForAPIFootball()
  const league = opts?.league || getDefaultSoccerLeagueForAPIFootball()

  let standings: APIFootballStanding[]
  try {
    standings = await fetchAPIFootballStandings(league, season)
  } catch (error) {
    console.error('[API-Football] Failed to fetch standings:', error)
    return 0
  }

  let synced = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 6 * 60 * 60 * 1000)

  for (const s of standings) {
    const teamAbbrev = soccerTeamAbbrev(s.team.name)
    const cacheKey = `SOCCER:standings:${season}:${league}:${s.team.id}`

    try {
      await (prisma.sportsDataCache as any).upsert({
        where: { cacheKey },
        update: {
          data: {
            team: teamAbbrev,
            teamName: s.team.name,
            logo: s.team.logo || null,
            position: s.rank,
            won: s.all?.win ?? null,
            lost: s.all?.lose ?? null,
            tied: s.all?.draw ?? null,
            pointsFor: s.all?.goals?.for ?? null,
            pointsAgainst: s.all?.goals?.against ?? null,
            points: s.points,
            group: s.group || null,
            season,
            league,
            source: 'api_football',
          } as object,
          expiresAt,
        },
        create: {
          cacheKey,
          data: {
            team: teamAbbrev,
            teamName: s.team.name,
            logo: s.team.logo || null,
            position: s.rank,
            won: s.all?.win ?? null,
            lost: s.all?.lose ?? null,
            tied: s.all?.draw ?? null,
            pointsFor: s.all?.goals?.for ?? null,
            pointsAgainst: s.all?.goals?.against ?? null,
            points: s.points,
            group: s.group || null,
            season,
            league,
            source: 'api_football',
          } as object,
          expiresAt,
        },
      })
      synced++
    } catch (error) {
      console.error(`[API-Football] Failed to upsert standings for ${s.team.name}:`, error)
    }
  }

  console.log(`[API-Football] Synced ${synced}/${standings.length} standings rows for league ${league} season ${season}`)
  return synced
}

export async function syncAPIFootballPlayersToDb(opts?: {
  season?: string
  league?: string
  maxPagesPerTeam?: number
}): Promise<number> {
  const season = opts?.season || getCurrentSoccerSeasonForAPIFootball()
  const league = opts?.league || getDefaultSoccerLeagueForAPIFootball()
  const maxPagesPerTeam = opts?.maxPagesPerTeam ?? 2

  const teams = await prisma.sportsTeam.findMany({
    where: {
      sport: 'SOCCER',
      source: 'api_football',
    },
    select: {
      externalId: true,
      shortName: true,
      name: true,
    },
  })

  if (teams.length === 0) {
    await syncAPIFootballTeamsToDb({ season, league })
  }

  const teamsToSync =
    teams.length > 0
      ? teams
      : await prisma.sportsTeam.findMany({
          where: { sport: 'SOCCER', source: 'api_football' },
          select: { externalId: true, shortName: true, name: true },
        })

  let synced = 0
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  for (const team of teamsToSync) {
    let players: APIFootballPlayerRecord[] = []
    try {
      players = await fetchAPIFootballPlayersByTeam(team.externalId, season, maxPagesPerTeam)
    } catch (error) {
      console.error(`[API-Football] Failed to fetch players for ${team.name}:`, error)
      continue
    }

    for (const row of players) {
      const p = row.player
      const stat = row.statistics?.[0]
      const pos = normalizePosition(stat?.games?.position || null)

      try {
        await prisma.sportsPlayer.upsert({
          where: {
            sport_externalId_source: {
              sport: 'SOCCER',
              externalId: String(p.id),
              source: 'api_football',
            },
          },
          update: {
            name: p.name,
            position: pos,
            team: team.shortName || soccerTeamAbbrev(team.name),
            teamId: team.externalId,
            number: stat?.games?.number ?? null,
            age: p.age ?? null,
            height: p.height ?? null,
            weight: p.weight ?? null,
            imageUrl: p.photo ?? null,
            fetchedAt: now,
            expiresAt,
          },
          create: {
            sport: 'SOCCER',
            externalId: String(p.id),
            name: p.name,
            position: pos,
            team: team.shortName || soccerTeamAbbrev(team.name),
            teamId: team.externalId,
            number: stat?.games?.number ?? null,
            age: p.age ?? null,
            height: p.height ?? null,
            weight: p.weight ?? null,
            imageUrl: p.photo ?? null,
            source: 'api_football',
            fetchedAt: now,
            expiresAt,
          },
        })
        synced++
      } catch (error) {
        console.error(`[API-Football] Failed to upsert player ${p.name}:`, error)
      }
    }
  }

  console.log(`[API-Football] Synced ${synced} players for league ${league} season ${season}`)
  return synced
}
