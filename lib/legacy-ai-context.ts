import { prisma } from '@/lib/prisma'
import {
  fetchNewsContext,
  fetchRollingInsights,
  fetchCrossSportSignals,
  fetchFantasyCalcPlayerAndPickWeights,
  formatNewsForAIPrompt,
  formatRollingInsightsForAIPrompt,
  formatFantasyCalcForAIPrompt,
  type NewsContextResult,
  type RollingInsightsResult,
  type CrossSportResult,
  type FantasyCalcAIContext,
  type UpstreamDeps,
} from './upstream-apis'
import { readCache, writeCache } from './enrichment-cache'
import { getAllPlayers, type SleeperPlayer } from './sleeper-client'

type PrismaLike = typeof prisma

const DEFAULT_NEWS_HOURS_BACK = 72
const DEFAULT_MAX_PLAYERS = 40
const NEWS_PLAYER_LIMIT = 15
const ROLLING_PLAYER_LIMIT = 20
const CROSS_SPORT_PLAYER_LIMIT = 10

export interface LeagueSnapshot {
  username: string
  total_seasons: number
  total_standard_leagues: number
  total_leagues_including_specialty: number
  total_wins: number
  total_losses: number
  win_percentage: number
  championships: number
  playoff_appearances: number
  playoff_rate: number
  total_points: number
  consistency_variance: number
  best_season: string | null
  worst_season: string | null
  season_breakdown: Record<string, unknown>
  league_types: (string | null)[]
  league_history: Array<Record<string, unknown>>
  specialty_leagues_excluded: Record<string, unknown> | null
  [key: string]: unknown
}

export interface RosterSnapshot {
  leagueName: string
  leagueType: string | null
  season: number
  teamCount: number | null
  isSF: boolean
  isTEP: boolean
  starters: PlayerRef[]
  bench: PlayerRef[]
  ir: PlayerRef[]
  taxi: PlayerRef[]
  draftPicks: DraftPickRef[]
}

interface PlayerRef {
  sleeperId: string
  name: string
  position: string | null
  team: string | null
  age: number | null
}

interface DraftPickRef {
  season: string
  round: number
  originalOwner: number
}

export interface DataFreshness {
  newsAge: string
  rollingInsightsSource: string
  fantasyCalcFetchedAt: string
  crossSportEnabled: boolean
  assembledAt: string
}

export interface SourceAudit {
  newsSourceCount: number
  newsSources: string[]
  newsItemCount: number
  playerHits: number
  teamHits: number
  rollingInsightsPlayerCount: number
  fantasyCalcPlayerCount: number
  fantasyCalcPickCount: number
  crossSportSignalCount: number
  errors: string[]
  partialData: boolean
  missingSources: string[]
}

export interface EnrichedLegacyContext {
  leagueSnapshot: LeagueSnapshot
  currentRosters: RosterSnapshot[]
  playerValueSignals: FantasyCalcAIContext | null
  recentNews: NewsContextResult | null
  rollingInsights: RollingInsightsResult | null
  crossSportContext: CrossSportResult | null
  dataFreshness: DataFreshness
  sourceAudit: SourceAudit
}

interface LegacyUserPayload {
  displayName: string | null
  sleeperUsername: string
  leagues: Array<{
    id: string
    name: string
    season: number
    leagueType: string | null
    specialtyFormat?: string | null
    teamCount?: number | null
    isSF?: boolean
    isTEP?: boolean
    rosters: Array<{
      isOwner: boolean
      wins: number
      losses: number
      pointsFor: number
      isChampion: boolean
      playoffSeed: number | null
      finalStanding: number | null
      players: unknown
    }>
  }>
}

interface AssembleOptions {
  enableCrossSport?: boolean
  hoursBackNews?: number
  maxPlayers?: number
  skipCache?: boolean
}

interface AggregateCacheKey extends Record<string, unknown> {
  username: string
  leagueCount: number
  latestSeason: number
  enableCrossSport: boolean
}

interface ExtractedRosterData {
  playerRefs: PlayerRef[]
  teamAbbrevs: string[]
  currentRosters: RosterSnapshot[]
  draftPicks: DraftPickRef[]
}

type SettledResultMap = {
  news: NewsContextResult | null
  insights: RollingInsightsResult | null
  calc: FantasyCalcAIContext | null
  crossSport: CrossSportResult | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeStrings(values: string[], max?: number): string[] {
  const trimmed = values.map((value) => value.trim()).filter(Boolean)
  const deduped = Array.from(new Set(trimmed))
  return typeof max === 'number' ? deduped.slice(0, max) : deduped
}

function getLatestSeason(leagues: LegacyUserPayload['leagues']): number {
  return leagues.length > 0 ? Math.max(...leagues.map((league) => league.season)) : 0
}

function getAggregateCacheKey(
  user: LegacyUserPayload,
  enableCrossSport: boolean
): AggregateCacheKey {
  return {
    username: user.sleeperUsername,
    leagueCount: user.leagues.length,
    latestSeason: getLatestSeason(user.leagues),
    enableCrossSport,
  }
}

function getUpstreamDeps(prismaClient: PrismaLike): UpstreamDeps {
  return {
    prisma: prismaClient,
    newsApiKey: process.env.NEWS_API_KEY || process.env.NEWSAPI_KEY,
  }
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

async function readAggregateCache(
  prismaClient: PrismaLike,
  cacheKey: AggregateCacheKey
): Promise<EnrichedLegacyContext | null> {
  const cached = await readCache<EnrichedLegacyContext>(
    prismaClient,
    'enrichment_aggregate',
    cacheKey
  )

  if (!cached) return null

  return {
    ...cached.data,
    dataFreshness: {
      ...cached.data.dataFreshness,
      assembledAt: cached.fetchedAt,
    },
  }
}

async function writeAggregateCache(
  prismaClient: PrismaLike,
  cacheKey: AggregateCacheKey,
  enrichedContext: EnrichedLegacyContext
): Promise<void> {
  await writeCache(
    prismaClient,
    'enrichment_aggregate',
    cacheKey,
    enrichedContext,
    'enrichment'
  )
}

function resolveSettledResult<T>(
  result: PromiseSettledResult<T>,
  label: string,
  errors: string[],
  missingSources: string[]
): T | null {
  if (result.status === 'fulfilled') return result.value

  errors.push(`${label}: ${stringifyError(result.reason)}`)
  missingSources.push(label.toLowerCase())
  return null
}

function buildDataFreshness(params: {
  news: NewsContextResult | null
  insights: RollingInsightsResult | null
  calc: FantasyCalcAIContext | null
  enableCrossSport: boolean
  assembledAt: string
}): DataFreshness {
  return {
    newsAge: params.news?.fetchedAt || 'unavailable',
    rollingInsightsSource: params.insights?.source || 'unavailable',
    fantasyCalcFetchedAt: params.calc?.fetchedAt || 'unavailable',
    crossSportEnabled: params.enableCrossSport,
    assembledAt: params.assembledAt,
  }
}

function buildSourceAudit(params: {
  news: NewsContextResult | null
  insights: RollingInsightsResult | null
  calc: FantasyCalcAIContext | null
  crossSport: CrossSportResult | null
  errors: string[]
  missingSources: string[]
}): SourceAudit {
  const { news, insights, calc, crossSport, errors, missingSources } = params

  return {
    newsSourceCount: news?.sources.length || 0,
    newsSources: news?.sources || [],
    newsItemCount: news?.items.length || 0,
    playerHits: news?.playerHits || 0,
    teamHits: news?.teamHits || 0,
    rollingInsightsPlayerCount: insights?.players.length || 0,
    fantasyCalcPlayerCount: calc?.players.length || 0,
    fantasyCalcPickCount: calc?.picks.length || 0,
    crossSportSignalCount: crossSport?.signals.length || 0,
    errors,
    partialData: missingSources.length > 0,
    missingSources,
  }
}

export async function assembleLegacyAIContext(
  prismaClient: PrismaLike,
  user: LegacyUserPayload,
  leagueSnapshot: LeagueSnapshot,
  options: AssembleOptions = {}
): Promise<EnrichedLegacyContext> {
  const {
    enableCrossSport = false,
    hoursBackNews = DEFAULT_NEWS_HOURS_BACK,
    maxPlayers = DEFAULT_MAX_PLAYERS,
    skipCache = false,
  } = options

  const aggregateCacheKey = getAggregateCacheKey(user, enableCrossSport)

  if (!skipCache) {
    const cached = await readAggregateCache(prismaClient, aggregateCacheKey)
    if (cached) return cached
  }

  const errors: string[] = []
  const missingSources: string[] = []
  const deps = getUpstreamDeps(prismaClient)

  let sleeperPlayers: Record<string, SleeperPlayer> = {}
  try {
    sleeperPlayers = await getAllPlayers()
  } catch (error) {
    errors.push(`sleeper_players: ${stringifyError(error)}`)
  }

  const { playerRefs, teamAbbrevs, currentRosters, draftPicks } = extractRosterData(
    user,
    sleeperPlayers,
    maxPlayers
  )

  const playerNames = normalizeStrings(
    playerRefs.map((player) => player.name),
    maxPlayers
  )
  const uniqueTeams = normalizeStrings(teamAbbrevs)

  const [newsResult, insightsResult, calcResult, crossSportResult] =
    await Promise.allSettled([
      fetchNewsContext(deps, {
        playerNames: playerNames.slice(0, NEWS_PLAYER_LIMIT),
        teamAbbrevs: uniqueTeams,
        hoursBack: hoursBackNews,
        limit: 20,
        skipCache,
      }),
      fetchRollingInsights(deps, {
        playerNames: playerNames.slice(0, ROLLING_PLAYER_LIMIT),
        teamAbbrevs: uniqueTeams,
        skipCache,
      }),
      fetchFantasyCalcPlayerAndPickWeights(deps, {
        playerNames: playerNames.slice(0, maxPlayers),
        picks: draftPicks.map((pick) => ({
          year: parseInt(pick.season, 10) || new Date().getFullYear(),
          round: pick.round,
        })),
        settings: inferCalcSettings(user),
        includeTrending: true,
        trendingLimit: 5,
      }),
      fetchCrossSportSignals(deps, {
        entities: [
          ...playerNames.slice(0, CROSS_SPORT_PLAYER_LIMIT).map((name) => ({
            name,
            type: 'player' as const,
          })),
          ...uniqueTeams.map((name) => ({
            name,
            type: 'team' as const,
          })),
        ],
        enabled: enableCrossSport,
      }),
    ])

  const resolved: SettledResultMap = {
    news: resolveSettledResult(newsResult, 'news', errors, missingSources),
    insights: resolveSettledResult(
      insightsResult,
      'rolling_insights',
      errors,
      missingSources
    ),
    calc: resolveSettledResult(calcResult, 'fantasycalc', errors, missingSources),
    crossSport: resolveSettledResult(
      crossSportResult,
      'cross_sport',
      errors,
      missingSources
    ),
  }

  const assembledAt = nowIso()
  const dataFreshness = buildDataFreshness({
    news: resolved.news,
    insights: resolved.insights,
    calc: resolved.calc,
    enableCrossSport,
    assembledAt,
  })

  const sourceAudit = buildSourceAudit({
    news: resolved.news,
    insights: resolved.insights,
    calc: resolved.calc,
    crossSport: resolved.crossSport,
    errors,
    missingSources,
  })

  const enrichedContext: EnrichedLegacyContext = {
    leagueSnapshot,
    currentRosters,
    playerValueSignals: resolved.calc,
    recentNews: resolved.news,
    rollingInsights: resolved.insights,
    crossSportContext: resolved.crossSport,
    dataFreshness,
    sourceAudit,
  }

  if (!skipCache && !sourceAudit.partialData) {
    writeAggregateCache(prismaClient, aggregateCacheKey, enrichedContext).catch(() => {})
  }

  return enrichedContext
}

function extractRosterData(
  user: LegacyUserPayload,
  sleeperPlayers: Record<string, SleeperPlayer>,
  maxPlayers: number
): ExtractedRosterData {
  const playerRefs: PlayerRef[] = []
  const teamAbbrevs: string[] = []
  const currentRosters: RosterSnapshot[] = []
  const draftPicks: DraftPickRef[] = []
  const seenPlayerIds = new Set<string>()

  const sortedLeagues = [...user.leagues].sort((a, b) => b.season - a.season)
  const latestSeason = sortedLeagues[0]?.season
  const currentLeagues = sortedLeagues.filter((league) => league.season === latestSeason)

  for (const league of currentLeagues) {
    const ownerRoster = league.rosters.find((roster) => roster.isOwner)
    if (!ownerRoster?.players || !isRecord(ownerRoster.players)) continue

    const playersData = ownerRoster.players
    const rosterSnapshot: RosterSnapshot = {
      leagueName: league.name,
      leagueType: league.leagueType,
      season: league.season,
      teamCount: league.teamCount ?? null,
      isSF: league.isSF ?? false,
      isTEP: league.isTEP ?? false,
      starters: [],
      bench: [],
      ir: [],
      taxi: [],
      draftPicks: [],
    }

    const slotMap: Record<
      string,
      keyof Pick<RosterSnapshot, 'starters' | 'bench' | 'ir' | 'taxi'>
    > = {
      starters: 'starters',
      bench: 'bench',
      ir: 'ir',
      taxi: 'taxi',
    }

    for (const [slot, key] of Object.entries(slotMap)) {
      const ids = playersData[slot]
      if (!Array.isArray(ids)) continue

      for (const id of ids) {
        if (typeof id !== 'string') continue

        const playerRef = resolvePlayer(id, sleeperPlayers)
        rosterSnapshot[key].push(playerRef)

        if (!seenPlayerIds.has(id) && playerRefs.length < maxPlayers) {
          seenPlayerIds.add(id)
          playerRefs.push(playerRef)
          if (playerRef.team) teamAbbrevs.push(playerRef.team)
        }
      }
    }

    const picks = playersData.draftPicks
    if (Array.isArray(picks)) {
      for (const pick of picks) {
        if (!isRecord(pick)) continue

        const pickRef: DraftPickRef = {
          season: String(pick.season || new Date().getFullYear()),
          round: typeof pick.round === 'number' ? pick.round : 1,
          originalOwner:
            typeof pick.original_owner_id === 'number' ? pick.original_owner_id : 0,
        }

        rosterSnapshot.draftPicks.push(pickRef)
        draftPicks.push(pickRef)
      }
    }

    currentRosters.push(rosterSnapshot)
  }

  return { playerRefs, teamAbbrevs, currentRosters, draftPicks }
}

function resolvePlayer(
  sleeperId: string,
  sleeperPlayers: Record<string, SleeperPlayer>
): PlayerRef {
  const player = sleeperPlayers[sleeperId]

  if (!player) {
    return {
      sleeperId,
      name: sleeperId,
      position: null,
      team: null,
      age: null,
    }
  }

  return {
    sleeperId,
    name: player.full_name || `${player.first_name} ${player.last_name}`.trim(),
    position: player.position || null,
    team: player.team || null,
    age: player.age ?? null,
  }
}

function inferCalcSettings(
  user: LegacyUserPayload
): Partial<import('@/lib/player-valuations/canonicalPlayerValuations').FantasyCalcSettings> {
  const latestSeason = getLatestSeason(user.leagues)

  const currentLeagues = user.leagues.filter(
    (league) => league.season === latestSeason
  )

  const hasDynasty = currentLeagues.some(
    (league) =>
      league.leagueType?.toLowerCase().includes('dynasty') ||
      league.leagueType?.toLowerCase().includes('keeper')
  )

  const hasSF = currentLeagues.some((league) => league.isSF)

  const teamCounts = currentLeagues
    .map((league) => league.teamCount)
    .filter((count): count is number => count != null)

  const averageTeams =
    teamCounts.length > 0
      ? Math.round(teamCounts.reduce((sum, count) => sum + count, 0) / teamCounts.length)
      : 12

  return {
    isDynasty: hasDynasty,
    numQbs: (hasSF ? 2 : 1) as 1 | 2,
    numTeams: averageTeams,
    ppr: 1,
  }
}

export function formatEnrichedContextForPrompt(
  ctx: EnrichedLegacyContext
): string {
  const sections: string[] = []

  if (ctx.currentRosters.length > 0) {
    sections.push('## CURRENT ROSTERS')

    for (const roster of ctx.currentRosters) {
      sections.push(
        `\n### ${roster.leagueName} (${roster.season}, ${roster.leagueType || 'unknown'}, ${roster.teamCount || '?'}-team${roster.isSF ? ', SF' : ''}${roster.isTEP ? ', TEP' : ''})`
      )

      if (roster.starters.length > 0) {
        sections.push('**Starters:**')
        sections.push(
          roster.starters
            .map(
              (player) =>
                `- ${player.name} (${player.position || '?'}, ${player.team || '?'}${player.age ? `, age ${player.age}` : ''})`
            )
            .join('\n')
        )
      }

      if (roster.bench.length > 0) {
        sections.push(`**Bench (${roster.bench.length}):**`)
        sections.push(
          roster.bench
            .map(
              (player) =>
                `- ${player.name} (${player.position || '?'}, ${player.team || '?'}${player.age ? `, age ${player.age}` : ''})`
            )
            .join('\n')
        )
      }

      if (roster.taxi.length > 0) {
        sections.push(`**Taxi (${roster.taxi.length}):**`)
        sections.push(
          roster.taxi
            .map(
              (player) =>
                `- ${player.name} (${player.position || '?'}${player.age ? `, age ${player.age}` : ''})`
            )
            .join('\n')
        )
      }

      if (roster.ir.length > 0) {
        sections.push(`**IR (${roster.ir.length}):**`)
        sections.push(
          roster.ir
            .map((player) => `- ${player.name} (${player.position || '?'})`)
            .join('\n')
        )
      }

      if (roster.draftPicks.length > 0) {
        sections.push(`**Draft Picks (${roster.draftPicks.length}):**`)
        sections.push(
          roster.draftPicks.map((pick) => `${pick.season} Rd${pick.round}`).join(', ')
        )
      }
    }
  }

  if (ctx.playerValueSignals) {
    sections.push(formatFantasyCalcForAIPrompt(ctx.playerValueSignals))
  }

  if (ctx.recentNews) {
    const newsPrompt = formatNewsForAIPrompt(ctx.recentNews)
    if (newsPrompt) sections.push(newsPrompt)
  }

  if (ctx.rollingInsights) {
    const insightsPrompt = formatRollingInsightsForAIPrompt(ctx.rollingInsights)
    if (insightsPrompt) sections.push(insightsPrompt)
  }

  if (ctx.crossSportContext?.enabled && ctx.crossSportContext.signals.length > 0) {
    sections.push('## CROSS-SPORT SIGNALS')
    for (const signal of ctx.crossSportContext.signals) {
      sections.push(
        `- [${signal.signalType}] ${signal.headline} (relevance: ${signal.relevance})`
      )
    }
  }

  sections.push(
    `\n## DATA FRESHNESS\n- News: ${ctx.dataFreshness.newsAge}\n- Player Stats: ${ctx.dataFreshness.rollingInsightsSource}\n- Valuations: ${ctx.dataFreshness.fantasyCalcFetchedAt}\n- Assembled: ${ctx.dataFreshness.assembledAt}`
  )

  if (ctx.sourceAudit.errors.length > 0) {
    sections.push(
      `\n## DATA GAPS\n${ctx.sourceAudit.errors.map((error) => `- ${error}`).join('\n')}`
    )
  }

  return sections.join('\n\n')
}