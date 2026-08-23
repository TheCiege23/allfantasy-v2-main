import { prisma } from '@/lib/prisma'
import type { FantasyCalcPlayer, FantasyCalcSettings } from './fantasycalc'
import { readCache, writeCache } from './enrichment-cache'
import { ESPN_SITE_API_BASE } from '@/lib/providers/espnUrls'

type PrismaLike = typeof prisma
type CacheScope = 'news_context' | 'rolling_insights'
type CacheSource = 'news' | 'rolling_insights'
type NewsRelevance = 'direct' | 'team' | 'league' | 'general'
type UpstreamSourceKind =
  | 'db_news'
  | 'injury_report'
  | 'newsapi_headlines'
  | 'newsapi'
  | 'espn'

type JsonRecord = Record<string, unknown>

const DEFAULT_SPORT = 'NFL'
const UNKNOWN_SOURCE = 'unknown'
const NEWS_TIMEOUT_MS = 5000
const MAX_NEWS_PLAYER_NAMES = 15
const MAX_ROLLING_PLAYER_LIVE_LOOKUPS = 5

export interface UpstreamDeps {
  prisma: PrismaLike
  newsApiKey?: string
}

export interface NewsContextItem {
  id: string
  title: string
  source: string
  url: string | null
  team: string | null
  publishedAt: string
  isInjury: boolean
  injuryStatus?: string | null
  playerName?: string | null
  relevance: NewsRelevance
}

export interface NewsContextResult {
  items: NewsContextItem[]
  fetchedAt: string
  sources: string[]
  playerHits: number
  teamHits: number
}

interface DbNewsRow {
  id: string
  title: string
  source: string | null
  sourceUrl: string | null
  team: string | null
  publishedAt: Date | null
}

interface DbInjuryRow {
  id: string
  playerName: string
  team: string | null
  status: string
  type: string | null
  updatedAt: Date
}

interface NewsApiArticle {
  title?: string | null
  url?: string | null
  publishedAt?: string | null
  source?: {
    name?: string | null
  } | null
}

interface NewsApiResponse {
  articles?: NewsApiArticle[]
}

interface EspnArticle {
  id?: string | number | null
  headline?: string | null
  title?: string | null
  published?: string | null
  links?: {
    web?: {
      href?: string | null
    } | null
  } | null
}

interface EspnNewsResponse {
  articles?: EspnArticle[]
}

interface RollingInsightsStatLine {
  passing_yards?: number | undefined
  passing_touchdowns?: number | undefined
  interceptions?: number | undefined
  rushing_yards?: number | undefined
  rushing_touchdowns?: number | undefined
  receiving_yards?: number | undefined
  receiving_touchdowns?: number | undefined
  receptions?: number | undefined
}

interface SportsTeamRow {
  externalId: string
  name: string
  shortName: string | null
}

interface SportsPlayerRow {
  externalId: string
  name: string
  team: string | null
  position: string | null
  status: string | null
  dob: string | null
}

interface PlayerSeasonStatsRow {
  stats: unknown
  fantasyPointsPerGame: number | null
  gamesPlayed: number | null
}

export interface RollingInsightsPlayerContext {
  playerId: string
  name: string
  team: string | null
  position: string | null
  status: string | null
  age: string | null
  fantasyPointsPerGame: number | null
  gamesPlayed: number | null
  seasonStats: Record<string, unknown> | null
}

export interface RollingInsightsTeamContext {
  teamId: string
  name: string
  abbrev: string
  mascot: string
  playerCount: number
}

export interface RollingInsightsResult {
  players: RollingInsightsPlayerContext[]
  teams: RollingInsightsTeamContext[]
  fetchedAt: string
  source: 'db_cache' | 'live_api'
}

export interface CrossSportSignal {
  entity: string
  sport: string
  signalType:
    | 'coaching_change'
    | 'draft_capital'
    | 'market_trend'
    | 'venue_overlap'
    | 'injury_pattern'
  headline: string
  relevance: number
  data: Record<string, unknown>
}

export interface CrossSportResult {
  signals: CrossSportSignal[]
  enabled: boolean
  fetchedAt: string
}

export interface PlayerWeight {
  name: string
  sleeperId: string | null
  position: string
  team: string | null
  dynastyValue: number
  redraftValue: number
  rank: number
  positionRank: number
  trend30Day: number
  tier: { tier: number; label: string; description: string }
  volatility: number | null
  age: number | null
}

export interface PickWeight {
  year: number
  round: number
  dynastyValue: number
  redraftValue: number
  timeMultiplier: number
  yearsOut: number
}

export interface FantasyCalcAIContext {
  players: PlayerWeight[]
  picks: PickWeight[]
  marketMeta: {
    totalPlayers: number
    medianValue: number
    topPositionValues: Record<string, number>
    trendingUp: string[]
    trendingDown: string[]
  }
  fetchedAt: string
  settings: FantasyCalcSettings
}

function nowIso(): string {
  return new Date().toISOString()
}

function toIsoString(value: Date | string | null | undefined): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  return value.toISOString()
}

function normalizeStrings(values: string[], max?: number): string[] {
  const trimmed = values.map((value) => value.trim()).filter(Boolean)
  const deduped = Array.from(new Set(trimmed))
  const sliced = typeof max === 'number' ? deduped.slice(0, max) : deduped
  return sliced.sort((a, b) => a.localeCompare(b))
}

function getNewsApiKey(deps: UpstreamDeps): string | undefined {
  return deps.newsApiKey || process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY
}

function shouldUseFootballHeadline(
  title: string,
  sport: string,
  playerNames: string[],
  teamAbbrevs: string[]
): boolean {
  const lower = title.toLowerCase()
  const normalizedSport = sport.toUpperCase()

  const sportMatches =
    normalizedSport === 'NFL'
      ? lower.includes('nfl') || lower.includes('football')
      : lower.includes(normalizedSport.toLowerCase())

  const playerMatch = playerNames.some((name) =>
    lower.includes(name.toLowerCase())
  )
  const teamMatch = teamAbbrevs.some((team) =>
    lower.includes(team.toLowerCase())
  )

  return sportMatches || playerMatch || teamMatch
}

function determineNewsRelevance(params: {
  title: string
  rowTeam: string | null
  playerNames: string[]
  teamAbbrevs: string[]
}): NewsRelevance {
  const { title, rowTeam, playerNames, teamAbbrevs } = params
  const lowerTitle = title.toLowerCase()

  const matchedPlayer = playerNames.some((name) =>
    lowerTitle.includes(name.toLowerCase())
  )
  if (matchedPlayer) return 'direct'

  const matchedTeam =
    !!rowTeam &&
    teamAbbrevs.some((team) => team.toLowerCase() === rowTeam.toLowerCase())
  if (matchedTeam) return 'team'

  if (playerNames.length > 0 || teamAbbrevs.length > 0) {
    return 'league'
  }

  return 'general'
}

function pushNewsItem(
  items: NewsContextItem[],
  item: NewsContextItem,
  seenKeys: Set<string>
): boolean {
  const dedupeKey = `${item.title.toLowerCase()}|${item.source.toLowerCase()}|${item.url || ''}`
  if (seenKeys.has(dedupeKey)) return false
  seenKeys.add(dedupeKey)
  items.push(item)
  return true
}

function sortNewsItems(items: NewsContextItem[]): void {
  const relevanceOrder: Record<NewsRelevance, number> = {
    direct: 3,
    team: 2,
    league: 1,
    general: 0,
  }

  items.sort((a, b) => {
    const relevanceDiff =
      relevanceOrder[b.relevance] - relevanceOrder[a.relevance]
    if (relevanceDiff !== 0) return relevanceDiff
    return (
      new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    )
  })
}

async function readTypedCache<T>(
  deps: UpstreamDeps,
  scope: CacheScope,
  params: Record<string, unknown>
): Promise<{ data: T; fetchedAt: string } | null> {
  return readCache<T>(deps.prisma as never, scope, params)
}

async function writeTypedCache<T>(
  deps: UpstreamDeps,
  scope: CacheScope,
  params: Record<string, unknown>,
  payload: T,
  source: CacheSource
): Promise<void> {
  await writeCache(deps.prisma as never, scope, params, payload, source)
}

async function fetchJson<T>(
  url: string,
  timeoutMs = NEWS_TIMEOUT_MS
): Promise<T | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function nullToUndefined(value: number | null): number | undefined {
  return value ?? undefined
}

function getRollingStatLine(
  stats: Record<string, unknown> | null
): RollingInsightsStatLine | null {
  if (!stats) return null

  return {
    passing_yards: nullToUndefined(asNumber(stats.passing_yards)),
    passing_touchdowns: nullToUndefined(asNumber(stats.passing_touchdowns)),
    interceptions: nullToUndefined(asNumber(stats.interceptions)),
    rushing_yards: nullToUndefined(asNumber(stats.rushing_yards)),
    rushing_touchdowns: nullToUndefined(asNumber(stats.rushing_touchdowns)),
    receiving_yards: nullToUndefined(asNumber(stats.receiving_yards)),
    receiving_touchdowns: nullToUndefined(
      asNumber(stats.receiving_touchdowns)
    ),
    receptions: nullToUndefined(asNumber(stats.receptions)),
  }
}

function getNewsCacheParams(params: {
  playerNames: string[]
  teamAbbrevs: string[]
  sport: string
  hoursBack: number
}): Record<string, unknown> {
  return {
    playerNames: normalizeStrings(params.playerNames, MAX_NEWS_PLAYER_NAMES),
    teamAbbrevs: normalizeStrings(params.teamAbbrevs),
    sport: params.sport,
    hoursBack: params.hoursBack,
  }
}

function getRollingCacheParams(params: {
  playerNames: string[]
  teamAbbrevs: string[]
  sport: string
}): Record<string, unknown> {
  return {
    playerNames: normalizeStrings(params.playerNames),
    teamAbbrevs: normalizeStrings(params.teamAbbrevs),
    sport: params.sport,
  }
}

function getFallbackArticleId(prefix: string, url?: string | null): string {
  return `${prefix}-${url || Math.random().toString(36).slice(2)}`
}

function incrementHits(
  counters: { playerHits: number; teamHits: number },
  relevance: NewsRelevance
): void {
  if (relevance === 'direct') counters.playerHits += 1
  if (relevance === 'team') counters.teamHits += 1
}

function normalizeSourceLabel(
  source: string | null | undefined,
  fallback: UpstreamSourceKind
): string {
  if (source && source.trim()) return source.trim()
  return fallback
}

export async function fetchNewsContext(
  deps: UpstreamDeps,
  params: {
    playerNames?: string[]
    teamAbbrevs?: string[]
    leagueId?: string
    sport?: string
    hoursBack?: number
    limit?: number
    skipCache?: boolean
  }
): Promise<NewsContextResult> {
  const playerNames = normalizeStrings(
    params.playerNames ?? [],
    MAX_NEWS_PLAYER_NAMES
  )
  const teamAbbrevs = normalizeStrings(params.teamAbbrevs ?? [])
  const sport = (params.sport || DEFAULT_SPORT).toUpperCase()
  const hoursBack = params.hoursBack ?? 72
  const limit = params.limit ?? 20
  const skipCache = params.skipCache ?? false
  const newsApiKey = getNewsApiKey(deps)

  const cacheParams = getNewsCacheParams({
    playerNames,
    teamAbbrevs,
    sport,
    hoursBack,
  })

  if (!skipCache) {
    const cached = await readTypedCache<NewsContextResult>(
      deps,
      'news_context',
      cacheParams
    )
    if (cached) {
      return { ...cached.data, fetchedAt: cached.fetchedAt }
    }
  }

  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
  const items: NewsContextItem[] = []
  const seenKeys = new Set<string>()
  const sources = new Set<string>()
  const counters = { playerHits: 0, teamHits: 0 }
  let dbNewsItemCount = 0

  try {
    const entityFilters: Array<
      | { title: { contains: string; mode: 'insensitive' } }
      | { team: { in: string[] } }
    > = []

    for (const name of playerNames) {
      entityFilters.push({
        title: { contains: name, mode: 'insensitive' },
      })
    }

    if (teamAbbrevs.length > 0) {
      entityFilters.push({ team: { in: teamAbbrevs } })
    }

    const newsRows = (await deps.prisma.sportsNews.findMany({
      where: {
        sport,
        AND: [
          {
            OR: [
              { publishedAt: { gte: since } },
              { publishedAt: null, createdAt: { gte: since } },
            ],
          },
          ...(entityFilters.length > 0 ? [{ OR: entityFilters }] : []),
        ],
      },
      orderBy: { publishedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        source: true,
        sourceUrl: true,
        team: true,
        publishedAt: true,
      },
    })) as DbNewsRow[]

    for (const row of newsRows) {
      const relevance = determineNewsRelevance({
        title: row.title,
        rowTeam: row.team,
        playerNames,
        teamAbbrevs,
      })

      const added = pushNewsItem(
        items,
        {
          id: row.id,
          title: row.title,
          source: normalizeSourceLabel(row.source, 'db_news'),
          url: row.sourceUrl,
          team: row.team,
          publishedAt: toIsoString(row.publishedAt),
          isInjury: false,
          relevance,
        },
        seenKeys
      )

      if (added) {
        dbNewsItemCount += 1
        incrementHits(counters, relevance)
        sources.add(normalizeSourceLabel(row.source, 'db_news'))
      }
    }
  } catch (error) {
    console.warn('[UpstreamAPIs] DB news fetch failed:', error)
  }

  try {
    const injuryOr: Array<
      | { playerName: { equals: string; mode: 'insensitive' } }
      | { team: { in: string[] } }
    > = []

    for (const name of playerNames) {
      injuryOr.push({
        playerName: { equals: name, mode: 'insensitive' },
      })
    }

    if (teamAbbrevs.length > 0) {
      injuryOr.push({ team: { in: teamAbbrevs } })
    }

    const injuries = (await deps.prisma.sportsInjury.findMany({
      where: {
        sport,
        status: { not: 'Active' },
        updatedAt: { gte: since },
        ...(injuryOr.length > 0 ? { OR: injuryOr } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(limit, 15),
      select: {
        id: true,
        playerName: true,
        team: true,
        status: true,
        type: true,
        updatedAt: true,
      },
    })) as DbInjuryRow[]

    for (const injury of injuries) {
      const isDirectHit = playerNames.some(
        (name) => name.toLowerCase() === injury.playerName.toLowerCase()
      )
      const relevance: NewsRelevance = isDirectHit ? 'direct' : 'team'

      const added = pushNewsItem(
        items,
        {
          id: injury.id,
          title: `${injury.playerName} (${injury.team || '?'}) — ${injury.status}${injury.type ? `: ${injury.type}` : ''}`,
          source: 'injury_report',
          url: null,
          team: injury.team,
          publishedAt: toIsoString(injury.updatedAt),
          isInjury: true,
          injuryStatus: injury.status,
          playerName: injury.playerName,
          relevance,
        },
        seenKeys
      )

      if (added) {
        incrementHits(counters, relevance)
        sources.add('injury_report')
      }
    }
  } catch (error) {
    console.warn('[UpstreamAPIs] DB injury fetch failed:', error)
  }

  if (dbNewsItemCount === 0 && newsApiKey) {
    const headlinesUrl = `https://newsapi.org/v2/top-headlines?country=us&category=sports&pageSize=${limit}&apiKey=${newsApiKey}` // db-first-exception: emergency fallback when DB news is empty
    const headlinesData = await fetchJson<NewsApiResponse>(headlinesUrl)

    for (const article of headlinesData?.articles ?? []) {
      const title = article.title?.trim()
      if (!title || title === '[Removed]') continue

      const isRelevant = shouldUseFootballHeadline(
        title,
        sport,
        playerNames,
        teamAbbrevs
      )
      if (!isRelevant && playerNames.length > 0) continue

      const relevance = determineNewsRelevance({
        title,
        rowTeam: null,
        playerNames,
        teamAbbrevs,
      })

      const added = pushNewsItem(
        items,
        {
          id: getFallbackArticleId('newsapi-hl', article.url),
          title,
          source: article.source?.name?.trim() || 'NewsAPI Headlines',
          url: article.url || null,
          team: null,
          publishedAt: article.publishedAt || nowIso(),
          isInjury: false,
          relevance,
        },
        seenKeys
      )

      if (added) {
        incrementHits(counters, relevance)
        sources.add('newsapi_headlines')
      }
    }

    const query =
      playerNames.length > 0
        ? playerNames.slice(0, 3).join(' OR ')
        : teamAbbrevs.length > 0
          ? `${teamAbbrevs.slice(0, 5).join(' OR ')} ${sport}`
          : `${sport} fantasy football`

    const everythingUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=${limit}&language=en&apiKey=${newsApiKey}` // db-first-exception: emergency fallback when DB news is empty
    const everythingData = await fetchJson<NewsApiResponse>(everythingUrl)

    for (const article of everythingData?.articles ?? []) {
      const title = article.title?.trim()
      if (!title || title === '[Removed]') continue

      const relevance = determineNewsRelevance({
        title,
        rowTeam: null,
        playerNames,
        teamAbbrevs,
      })

      const added = pushNewsItem(
        items,
        {
          id: getFallbackArticleId('newsapi', article.url),
          title,
          source: article.source?.name?.trim() || 'NewsAPI',
          url: article.url || null,
          team: null,
          publishedAt: article.publishedAt || nowIso(),
          isInjury: false,
          relevance,
        },
        seenKeys
      )

      if (added) {
        incrementHits(counters, relevance)
        sources.add('newsapi')
      }
    }
  }

  if (dbNewsItemCount === 0) {
    const espnData = await fetchJson<EspnNewsResponse>(
      `${ESPN_SITE_API_BASE}/football/nfl/news?limit=15` // db-first-exception: emergency fallback when DB news is empty
    )

    for (const article of espnData?.articles ?? []) {
      const title = article.headline?.trim() || article.title?.trim() || ''
      if (!title) continue

      const relevance = determineNewsRelevance({
        title,
        rowTeam: null,
        playerNames,
        teamAbbrevs,
      })

      const added = pushNewsItem(
        items,
        {
          id: getFallbackArticleId(
            'espn',
            article.id ? String(article.id) : article.links?.web?.href
          ),
          title,
          source: 'ESPN',
          url: article.links?.web?.href || null,
          team: null,
          publishedAt: article.published || nowIso(),
          isInjury: false,
          relevance,
        },
        seenKeys
      )

      if (added) {
        incrementHits(counters, relevance)
        sources.add('espn')
      }
    }
  }

  sortNewsItems(items)

  const result: NewsContextResult = {
    items: items.slice(0, limit),
    fetchedAt: nowIso(),
    sources: Array.from(sources),
    playerHits: counters.playerHits,
    teamHits: counters.teamHits,
  }

  if (!skipCache && result.items.length > 0) {
    writeTypedCache(
      deps,
      'news_context',
      cacheParams,
      result,
      'news'
    ).catch(() => {})
  }

  return result
}

export async function fetchRollingInsights(
  deps: UpstreamDeps,
  params: {
    playerNames?: string[]
    teamAbbrevs?: string[]
    sport?: string
    includeStats?: boolean
    skipCache?: boolean
  }
): Promise<RollingInsightsResult> {
  const playerNames = normalizeStrings(params.playerNames ?? [])
  const teamAbbrevs = normalizeStrings(params.teamAbbrevs ?? [])
  const sport = (params.sport || DEFAULT_SPORT).toUpperCase()
  const includeStats = params.includeStats ?? true
  const skipCache = params.skipCache ?? false

  const cacheParams = getRollingCacheParams({
    playerNames,
    teamAbbrevs,
    sport,
  })

  if (!skipCache) {
    const cached = await readTypedCache<RollingInsightsResult>(
      deps,
      'rolling_insights',
      cacheParams
    )
    if (cached) {
      return { ...cached.data, fetchedAt: cached.fetchedAt }
    }
  }

  const players: RollingInsightsPlayerContext[] = []
  const teams: RollingInsightsTeamContext[] = []
  let source: 'db_cache' | 'live_api' = 'db_cache'

  if (playerNames.length > 0) {
    try {
      const dbPlayers = (await deps.prisma.sportsPlayer.findMany({
        where: {
          sport,
          source: 'rolling_insights',
          OR: playerNames.map((name) => ({
            name: { equals: name, mode: 'insensitive' as const },
          })),
        },
        take: playerNames.length + 5,
        select: {
          externalId: true,
          name: true,
          team: true,
          position: true,
          status: true,
          dob: true,
        },
      })) as SportsPlayerRow[]

      let statsByPlayerId = new Map<string, PlayerSeasonStatsRow>()
      if (includeStats && dbPlayers.length > 0) {
        const playerIds = dbPlayers.map((p) => p.externalId)
        const allStats = (await deps.prisma.playerSeasonStats.findMany({
          where: {
            sport,
            playerId: { in: playerIds },
            source: 'rolling_insights',
            seasonType: 'regular',
          },
          orderBy: { season: 'desc' },
          select: {
            playerId: true,
            stats: true,
            fantasyPointsPerGame: true,
            gamesPlayed: true,
          },
        })) as (PlayerSeasonStatsRow & { playerId: string })[]
        for (const stat of allStats) {
          if (!statsByPlayerId.has(stat.playerId)) {
            statsByPlayerId.set(stat.playerId, {
              stats: stat.stats,
              fantasyPointsPerGame: stat.fantasyPointsPerGame,
              gamesPlayed: stat.gamesPlayed,
            })
          }
        }
      }

      for (const player of dbPlayers) {
        const stat = statsByPlayerId.get(player.externalId)
        let seasonStats: Record<string, unknown> | null = null
        let fantasyPointsPerGame: number | null = null
        let gamesPlayed: number | null = null
        if (stat) {
          seasonStats = asObjectRecord(stat.stats)
          fantasyPointsPerGame = stat.fantasyPointsPerGame ?? null
          gamesPlayed = stat.gamesPlayed ?? null
        }

        players.push({
          playerId: player.externalId,
          name: player.name,
          team: player.team,
          position: player.position,
          status: player.status,
          age: player.dob,
          fantasyPointsPerGame,
          gamesPlayed,
          seasonStats,
        })
      }

      if (players.length === 0 && process.env.ROLLING_INSIGHTS_CLIENT_ID) {
        source = 'live_api'
        const { searchNFLPlayer } = await import('./rolling-insights')

        for (const name of playerNames.slice(
          0,
          MAX_ROLLING_PLAYER_LIVE_LOOKUPS
        )) {
          try {
            const results = await searchNFLPlayer(name)

            for (const result of results.slice(0, 1)) {
              const latestStats =
                result.regularSeason?.[result.regularSeason.length - 1] ?? null

              players.push({
                playerId: result.id,
                name: result.player,
                team: result.team?.abbrv || null,
                position: result.position || null,
                status: result.status || null,
                age: result.dob || null,
                fantasyPointsPerGame:
                  latestStats?.DK_fantasy_points_per_game ?? null,
                gamesPlayed: latestStats?.games_played ?? null,
                seasonStats: latestStats
                  ? ({ ...latestStats } as Record<string, unknown>)
                  : null,
              })
            }
          } catch {
            // ignore single-player live lookup errors
          }
        }
      }
    } catch (error) {
      console.warn('[UpstreamAPIs] Rolling Insights player fetch failed:', error)
    }
  }

  if (teamAbbrevs.length > 0) {
    try {
      const dbTeams = (await deps.prisma.sportsTeam.findMany({
        where: {
          sport,
          source: 'rolling_insights',
          shortName: { in: teamAbbrevs },
        },
        select: {
          externalId: true,
          name: true,
          shortName: true,
        },
      })) as SportsTeamRow[]

      for (const team of dbTeams) {
        const playerCount = await deps.prisma.sportsPlayer.count({
          where: {
            sport,
            team: team.shortName,
            source: 'rolling_insights',
          },
        })

        teams.push({
          teamId: team.externalId,
          name: team.name,
          abbrev: team.shortName || '',
          mascot: team.name.split(' ').pop() || '',
          playerCount,
        })
      }
    } catch (error) {
      console.warn('[UpstreamAPIs] Rolling Insights team fetch failed:', error)
    }
  }

  const result: RollingInsightsResult = {
    players,
    teams,
    fetchedAt: nowIso(),
    source,
  }

  if (!skipCache && (players.length > 0 || teams.length > 0)) {
    writeTypedCache(
      deps,
      'rolling_insights',
      cacheParams,
      result,
      'rolling_insights'
    ).catch(() => {})
  }

  return result
}

export async function fetchCrossSportSignals(
  deps: UpstreamDeps,
  params: {
    entities: Array<{ name: string; type: 'player' | 'team'; sport?: string }>
    enabled?: boolean
  }
): Promise<CrossSportResult> {
  const { entities, enabled = false } = params

  if (!enabled || entities.length === 0) {
    return {
      signals: [],
      enabled: false,
      fetchedAt: nowIso(),
    }
  }

  const signals: CrossSportSignal[] = []

  const teamEntities = entities.filter((entity) => entity.type === 'team')
  for (const entity of teamEntities) {
    try {
      const sharedVenue = await deps.prisma.sportsGame.findMany({
        where: {
          venue: { not: null },
          OR: [
            { homeTeam: { contains: entity.name, mode: 'insensitive' } },
            { awayTeam: { contains: entity.name, mode: 'insensitive' } },
          ],
        },
        select: { venue: true, sport: true, homeTeam: true },
        distinct: ['venue'],
        take: 3,
      })

      if (sharedVenue.length > 1) {
        const sports = Array.from(new Set(sharedVenue.map((game) => game.sport)))
        if (sports.length > 1) {
          signals.push({
            entity: entity.name,
            sport: entity.sport || DEFAULT_SPORT,
            signalType: 'venue_overlap',
            headline: `${entity.name} shares venue across ${sports.join(', ')} — travel/scheduling impact possible`,
            relevance: 0.3,
            data: {
              venues: sharedVenue.map((venue) => venue.venue),
              sports,
            },
          })
        }
      }
    } catch {
      // ignore single-entity errors
    }
  }

  const playerEntities = entities.filter((entity) => entity.type === 'player')
  for (const entity of playerEntities.slice(0, 5)) {
    try {
      const injuryHistory = await deps.prisma.sportsInjury.findMany({
        where: {
          playerName: { equals: entity.name, mode: 'insensitive' },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { status: true, type: true, updatedAt: true },
      })

      if (injuryHistory.length >= 3) {
        const types = injuryHistory
          .map((injury) => injury.type)
          .filter((type): type is string => Boolean(type))

        const uniqueTypes = Array.from(new Set(types))
        const recurring = uniqueTypes.find(
          (type) => types.filter((entry) => entry === type).length >= 2
        )

        if (recurring) {
          signals.push({
            entity: entity.name,
            sport: entity.sport || DEFAULT_SPORT,
            signalType: 'injury_pattern',
            headline: `${entity.name} has recurring ${recurring} injury (${types.filter((entry) => entry === recurring).length}x in history)`,
            relevance: 0.7,
            data: {
              injuryType: recurring,
              totalInjuries: injuryHistory.length,
              history: injuryHistory.slice(0, 5),
            },
          })
        }
      }
    } catch {
      // ignore single-entity errors
    }
  }

  signals.sort((a, b) => b.relevance - a.relevance)

  return {
    signals: signals.slice(0, 10),
    enabled: true,
    fetchedAt: nowIso(),
  }
}

export async function fetchFantasyCalcPlayerAndPickWeights(
  _deps: UpstreamDeps,
  params: {
    playerNames?: string[]
    sleeperIds?: string[]
    picks?: Array<{ year: number; round: number }>
    settings?: Partial<FantasyCalcSettings>
    includeTrending?: boolean
    trendingLimit?: number
  }
): Promise<FantasyCalcAIContext> {
  const {
    playerNames = [],
    sleeperIds = [],
    picks = [],
    settings: partialSettings,
    includeTrending = true,
    trendingLimit = 5,
  } = params

  const {
    fetchFantasyCalcValues,
    findPlayerByName,
    findPlayerBySleeperId,
    getDetailedTier,
    getPickValue,
  } = await import('./fantasycalc')

  const fullSettings: FantasyCalcSettings = {
    isDynasty: partialSettings?.isDynasty ?? true,
    numQbs: partialSettings?.numQbs ?? 2,
    numTeams: partialSettings?.numTeams ?? 12,
    ppr: partialSettings?.ppr ?? 1,
  }

  const allPlayers = await fetchFantasyCalcValues(fullSettings)
  const playerWeights: PlayerWeight[] = []

  for (const name of playerNames) {
    const match = findPlayerByName(allPlayers, name)
    if (match) {
      playerWeights.push(mapFcToWeight(match))
    } else {
      playerWeights.push({
        name,
        sleeperId: null,
        position: 'UNKNOWN',
        team: null,
        dynastyValue: 0,
        redraftValue: 0,
        rank: 999,
        positionRank: 999,
        trend30Day: 0,
        tier: {
          tier: 4,
          label: 'Tier 4 - Depth/Lottery',
          description: 'Not found in FantasyCalc',
        },
        volatility: null,
        age: null,
      })
    }
  }

  for (const sleeperId of sleeperIds) {
    if (playerWeights.some((player) => player.sleeperId === sleeperId)) continue
    const match = findPlayerBySleeperId(allPlayers, sleeperId)
    if (match) {
      playerWeights.push(mapFcToWeight(match))
    }
  }

  const pickWeights: PickWeight[] = []
  const currentYear = new Date().getFullYear()

  for (const pick of picks) {
    const dynastyValue = getPickValue(pick.year, pick.round, true)
    const redraftValue = getPickValue(pick.year, pick.round, false)
    const yearsOut = Math.max(0, pick.year - currentYear)

    const TIME_MULTIPLIER: Record<number, number> = {
      0: 1.0,
      1: 0.92,
      2: 0.85,
      3: 0.8,
    }

    pickWeights.push({
      year: pick.year,
      round: pick.round,
      dynastyValue,
      redraftValue,
      timeMultiplier: TIME_MULTIPLIER[yearsOut] ?? 0.75,
      yearsOut,
    })
  }

  const values = allPlayers.map((player) => player.value).sort((a, b) => a - b)
  const medianValue = values.length > 0 ? values[Math.floor(values.length / 2)] : 0

  const topPositionValues: Record<string, number> = {}
  for (const position of ['QB', 'RB', 'WR', 'TE']) {
    const topPlayer = allPlayers.find(
      (player) => player.player.position.toUpperCase() === position
    )
    topPositionValues[position] = topPlayer?.value || 0
  }

  let trendingUp: string[] = []
  let trendingDown: string[] = []

  if (includeTrending) {
    const sortedByTrend = [...allPlayers].sort(
      (a, b) => b.trend30Day - a.trend30Day
    )

    trendingUp = sortedByTrend
      .slice(0, trendingLimit)
      .map((player) => `${player.player.name} (+${player.trend30Day})`)

    trendingDown = sortedByTrend
      .slice(-trendingLimit)
      .reverse()
      .map((player) => `${player.player.name} (${player.trend30Day})`)
  }

  return {
    players: playerWeights,
    picks: pickWeights,
    marketMeta: {
      totalPlayers: allPlayers.length,
      medianValue,
      topPositionValues,
      trendingUp,
      trendingDown,
    },
    fetchedAt: nowIso(),
    settings: fullSettings,
  }

  function mapFcToWeight(fc: FantasyCalcPlayer): PlayerWeight {
    return {
      name: fc.player.name,
      sleeperId: fc.player.sleeperId || null,
      position: fc.player.position,
      team: fc.player.maybeTeam,
      dynastyValue: fc.value,
      redraftValue: fc.redraftValue,
      rank: fc.overallRank,
      positionRank: fc.positionRank,
      trend30Day: fc.trend30Day,
      tier: getDetailedTier(fc.value, fc.overallRank, fc.player.position),
      volatility: fc.maybeMovingStandardDeviationPerc ?? null,
      age: fc.player.maybeAge,
    }
  }
}

export function formatNewsForAIPrompt(result: NewsContextResult): string {
  if (result.items.length === 0) return ''

  const lines: string[] = [
    `## NEWS & INJURY CONTEXT (${result.items.length} items, sources: ${result.sources.join(', ')})`,
  ]

  const directItems = result.items.filter((item) => item.relevance === 'direct')
  const teamItems = result.items.filter((item) => item.relevance === 'team')
  const otherItems = result.items.filter(
    (item) => item.relevance !== 'direct' && item.relevance !== 'team'
  )

  if (directItems.length > 0) {
    lines.push('\n### Directly Relevant:')
    for (const item of directItems) {
      const tag = item.isInjury ? '[INJURY]' : '[NEWS]'
      lines.push(`- ${tag} ${item.title} (${item.source}, ${item.publishedAt})`)
    }
  }

  if (teamItems.length > 0) {
    lines.push('\n### Team Context:')
    for (const item of teamItems.slice(0, 8)) {
      const tag = item.isInjury ? '[INJURY]' : '[NEWS]'
      lines.push(`- ${tag} ${item.title} (${item.source})`)
    }
  }

  if (otherItems.length > 0 && directItems.length + teamItems.length < 5) {
    lines.push('\n### League-Wide:')
    for (const item of otherItems.slice(0, 5)) {
      lines.push(`- ${item.title} (${item.source})`)
    }
  }

  return lines.join('\n')
}

export function formatRollingInsightsForAIPrompt(
  result: RollingInsightsResult
): string {
  if (result.players.length === 0 && result.teams.length === 0) return ''

  const lines: string[] = [
    `## PLAYER PROFILES & STATS (source: Rolling Insights, ${result.source})`,
  ]

  for (const player of result.players) {
    const fppg =
      player.fantasyPointsPerGame != null
        ? `${player.fantasyPointsPerGame.toFixed(1)} FPPG`
        : 'N/A FPPG'
    const gamesPlayed =
      player.gamesPlayed != null ? `${player.gamesPlayed} GP` : ''

    lines.push(
      `- ${player.name} | ${player.position || '?'} | ${player.team || '?'} | ${fppg}${gamesPlayed ? `, ${gamesPlayed}` : ''} | Status: ${player.status || 'Active'}`
    )

    const statLine = getRollingStatLine(player.seasonStats)
    if (!statLine) continue

    const statParts: string[] = []
    if (statLine.passing_yards) {
      statParts.push(
        `${statLine.passing_yards} pass yds, ${statLine.passing_touchdowns || 0} TD, ${statLine.interceptions || 0} INT`
      )
    }
    if (statLine.rushing_yards) {
      statParts.push(
        `${statLine.rushing_yards} rush yds, ${statLine.rushing_touchdowns || 0} rush TD`
      )
    }
    if (statLine.receiving_yards) {
      statParts.push(
        `${statLine.receiving_yards} rec yds, ${statLine.receiving_touchdowns || 0} rec TD, ${statLine.receptions || 0} rec`
      )
    }

    if (statParts.length > 0) {
      lines.push(`  Stats: ${statParts.join(' | ')}`)
    }
  }

  if (result.teams.length > 0) {
    lines.push('\nTeams:')
    for (const team of result.teams) {
      lines.push(
        `- ${team.name} (${team.abbrev}) — ${team.playerCount} rostered players`
      )
    }
  }

  return lines.join('\n')
}

export function formatFantasyCalcForAIPrompt(
  ctx: FantasyCalcAIContext
): string {
  if (ctx.players.length === 0 && ctx.picks.length === 0) return ''

  const lines: string[] = [
    `## MARKET VALUES (FantasyCalc, ${ctx.settings.isDynasty ? 'Dynasty' : 'Redraft'}, ${ctx.settings.numQbs}QB, ${ctx.settings.numTeams}-team, ${ctx.settings.ppr} PPR)`,
  ]

  if (ctx.players.length > 0) {
    lines.push('\nPlayers:')
    for (const player of ctx.players) {
      const trend =
        player.trend30Day > 0 ? `+${player.trend30Day}` : `${player.trend30Day}`
      const age = player.age ? `, Age ${player.age}` : ''
      const volatility =
        player.volatility != null
          ? `, Vol ${(player.volatility * 100).toFixed(1)}%`
          : ''

      lines.push(
        `- ${player.name}: Dynasty ${player.dynastyValue} / Redraft ${player.redraftValue} | ${player.tier.label} | #${player.rank} overall (#${player.positionRank} ${player.position})${age} | 30d: ${trend}${volatility}`
      )
    }
  }

  if (ctx.picks.length > 0) {
    lines.push('\nPicks:')
    for (const pick of ctx.picks) {
      lines.push(
        `- ${pick.year} Rd${pick.round}: Dynasty ${pick.dynastyValue} / Redraft ${pick.redraftValue} (${pick.yearsOut}yr out, ×${pick.timeMultiplier.toFixed(2)})`
      )
    }
  }

  if (ctx.marketMeta.trendingUp.length > 0) {
    lines.push(`\nTrending Up: ${ctx.marketMeta.trendingUp.join(', ')}`)
  }

  if (ctx.marketMeta.trendingDown.length > 0) {
    lines.push(`Trending Down: ${ctx.marketMeta.trendingDown.join(', ')}`)
  }

  lines.push(
    `\nMarket: ${ctx.marketMeta.totalPlayers} players, median value ${ctx.marketMeta.medianValue} | Top QB: ${ctx.marketMeta.topPositionValues['QB'] || 0}, RB: ${ctx.marketMeta.topPositionValues['RB'] || 0}, WR: ${ctx.marketMeta.topPositionValues['WR'] || 0}, TE: ${ctx.marketMeta.topPositionValues['TE'] || 0}`
  )

  return lines.join('\n')
}