import 'server-only'

import { prisma } from '@/lib/prisma'
import {
  API_CHAIN_TTLS,
  apiChainSportToDbSport,
  isRollingInsightsEnabledForSport,
  ttlSecondsForDataType,
  toApiChainSport,
  type ApiChainSport,
  type ApiDataType,
  type ApiFetchParams,
  type ApiProvider,
  type ApiProviderName,
  type ApiResult,
  type ChainFetchResult,
} from '@/lib/workers/api-config'
import { apiSportsProvider } from '@/lib/workers/providers/api-sports'
import { clearSportsProvider } from '@/lib/workers/providers/clearsports'
import { rollingInsightsProvider } from '@/lib/workers/providers/rolling-insights'
import { sleeperChainProvider } from '@/lib/workers/providers/sleeper-chain'
import { theSportsDbProvider } from '@/lib/workers/providers/thesportsdb'
import { cfbdProvider } from '@/lib/workers/providers/cfbd'
import { espnProvider } from '@/lib/workers/providers/espn'
import { persistNormalizedSportsRows } from '@/lib/workers/sports-cache-persist'
import { pickFreshestSourceRows } from '@/lib/scores/liveSourceSelection'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'

function isPopulatedResult(value: unknown): boolean {
  if (value == null) return false
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

function mergeQuery(params: ApiFetchParams): Record<string, unknown> {
  return { ...(params.query ?? {}), ...(params.options ?? {}) }
}

function normalizeCacheValue(value: unknown): unknown {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map((item) => normalizeCacheValue(item))
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>
    return Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        const normalized = normalizeCacheValue(input[key])
        if (normalized !== undefined) acc[key] = normalized
        return acc
      }, {})
  }
  if (typeof value === 'undefined') return undefined
  return value
}

export function buildApiChainCacheKey(params: {
  sport: ApiChainSport
  dataType: string
  query?: Record<string, unknown>
  options?: Record<string, unknown>
}): string {
  const payload = normalizeCacheValue({
    query: params.query ?? {},
    options: params.options ?? {},
  })
  return `${params.sport}:${params.dataType}:${JSON.stringify(payload)}`
}

async function tryRollingInsightsBlock(
  params: ApiFetchParams & { forceRefresh?: boolean },
  chainSport: ApiChainSport,
  dt: string,
  merged: Record<string, unknown>,
): Promise<ChainFetchResult | null> {
  if (!isRollingInsightsEnabledForSport(chainSport)) return null
  const startedRi = Date.now()
  try {
    const ri = await rollingInsightsProvider({
      ...params,
      sport: chainSport,
      dataType: dt,
      query: merged,
    })
    if (isPopulatedResult(ri.data)) {
      return {
        data: ri.data,
        fromCache: false,
        source: 'rolling_insights',
        latency: ri.latency ?? toLatency(startedRi),
        error: ri.error,
      }
    }
  } catch (e) {
    console.warn(`[api-chain] Rolling Insights failed ${chainSport}/${dt}:`, e)
  }
  return null
}

async function tryProviderBlock(
  provider: ApiProvider,
  baseParams: ApiFetchParams,
): Promise<ChainFetchResult | null> {
  if (!provider.supports(baseParams)) return null
  const startedAt = Date.now()
  try {
    const data = await provider.fetch(baseParams)
    if (isPopulatedResult(data)) {
      return {
        data,
        fromCache: false,
        source: provider.name as ApiProviderName,
        latency: toLatency(startedAt),
      }
    }
  } catch (e) {
    console.warn(`[api-chain] ${provider.name} failed:`, e)
  }
  return null
}

function toLatency(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt)
}

function extractCachedPayload(raw: unknown): unknown {
  if (raw == null) return null
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (o.data != null && (Array.isArray(o.data) || typeof o.data === 'object')) return o.data
  }
  return raw
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function toIsoString(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value
  return undefined
}

type FindManyModel = {
  findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>
}

function getFindManyModel(name: string): FindManyModel | null {
  const container = prisma as unknown as Record<string, unknown>
  const candidate = container[name] as Record<string, unknown> | undefined
  if (!candidate || typeof candidate.findMany !== 'function') return null
  return candidate as unknown as FindManyModel
}

/**
 * Rows are served only while `expiresAt` is in the future. Every one of the five
 * normalized tables carries `expiresAt` and `fetchedAt`; none of them was read.
 */
function freshOnly(now: Date): { expiresAt: { gt: Date } } {
  return { expiresAt: { gt: now } }
}

/**
 * Real age of the freshest row backing a response, in seconds.
 *
 * `undefined` — not `0` — when nothing measurable came back. The caller used to
 * stamp a literal `cacheAge: 0` on every normalized read, which reported
 * month-old rows as having been fetched this instant.
 */
function measuredCacheAge(rows: Array<Record<string, unknown>>, nowMs: number): number | undefined {
  let newest = 0
  for (const row of rows) {
    const fetchedAt = row.fetchedAt
    if (fetchedAt instanceof Date) newest = Math.max(newest, fetchedAt.getTime())
  }
  if (newest <= 0) return undefined
  return Math.max(0, Math.floor((nowMs - newest) / 1000))
}

/**
 * Narrowing dimensions this reader does not implement.
 *
 * Serving a `sport + season` row set to a request that also asked for a single
 * date or a single game is how an unrelated fixture answers a question about
 * another one. None of these is passed by any current caller — the point is
 * that adding one later must not silently widen the result, so an unhandled
 * narrowing key sends the request to the providers instead of to this table.
 *
 * ⚠ A DATE IS NOT A UTC DAY HERE. `contracts/rolling-insights/GAPS.md` records
 * that `/live/{date}` is keyed on the US EASTERN date, so a UTC-day window puts
 * Sunday night football on Monday. Implement the offset deliberately before
 * removing `date` from this list.
 */
const UNSCOPED_GAME_DIMENSIONS = ['date', 'dates', 'day', 'gameId', 'gameID', 'eventId'] as const

function hasUnscopedDimension(mergedQuery: Record<string, unknown>): boolean {
  return UNSCOPED_GAME_DIMENSIONS.some((key) => {
    const value = mergedQuery[key]
    return value != null && String(value).trim() !== ''
  })
}

/**
 * The normalized-table fast path, read before any provider is called.
 *
 * 🛑 THIS PATH HAD NO FRESHNESS GATE, NO REQUEST SCOPING BEYOND `season`, AND ITS
 * CALLER STAMPED `cacheAge: 0` ON WHATEVER IT RETURNED.
 *
 * A row of any age satisfied a request and suppressed the provider chain
 * permanently, while the response reported itself as brand new. The
 * `sportsDataCache` branch immediately above the call site has always checked
 * `expiresAt` and computed a real age from `createdAt`; this one is now held to
 * the same contract.
 *
 * 🛑 THE GAME BRANCH WAS THE SHARP END, AND THE COLUMNS WERE ALREADY THERE.
 *
 * `SportsGame` stores `homeScore`, `awayScore`, `week` and `seasonType`, and is
 * indexed on `[sport, season, seasonType, week]`. This reader selected none of
 * them and filtered on none of them — so a `scores` request was answered with
 * schedule rows carrying no score fields at all, taken from up to 200 arbitrary
 * games of the season regardless of week, team or status. The live-scores
 * service asks for exactly that: `dataType: 'scores'` with `{ season }` alone.
 *
 * ⚠ AND THE TABLE HOLDS ONE ROW PER SOURCE PER GAME (`@@unique([sport,
 * externalId, source])`), so an un-deduped read returns the same fixture once
 * per feed — some copies scored, some not. `pickFreshestSourceRows` is the rule
 * `lib/sports-live-scores-service.ts` already learned this with; it now lives in
 * `lib/scores/liveSourceSelection.ts` so both readers share one implementation
 * rather than two that can drift.
 */
async function readFromNormalizedTables(
  chainSport: ApiChainSport,
  dataType: string,
  mergedQuery: Record<string, unknown>
): Promise<ChainFetchResult | null> {
  const dbSport = apiChainSportToDbSport(chainSport)
  const limit = toPositiveInt(mergedQuery.limit, 200)
  const now = new Date()
  const nowMs = now.getTime()

  const nameQ = typeof mergedQuery.playerName === 'string' ? mergedQuery.playerName.trim() : ''
  const teamQ =
    typeof mergedQuery.team === 'string'
      ? mergedQuery.team.trim()
      : typeof mergedQuery.teamAbbr === 'string'
        ? mergedQuery.teamAbbr.trim()
        : ''
  const seasonNum = Number(mergedQuery.season)
  const weekNum = Number(mergedQuery.week)

  if (dataType === 'players') {
    const model = getFindManyModel('sportsPlayer')
    if (!model) return null

    const rows = await model.findMany({
      where: {
        sport: dbSport,
        ...freshOnly(now),
        ...(nameQ ? { name: { contains: nameQ, mode: 'insensitive' } } : {}),
        ...(teamQ ? { team: { equals: teamQ, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
      select: {
        externalId: true,
        name: true,
        position: true,
        team: true,
        teamId: true,
        status: true,
        imageUrl: true,
        fetchedAt: true,
      },
    })

    if (rows.length > 0) {
      return {
        data: rows.map((r) => ({
          id: r.externalId,
          name: r.name,
          position: r.position,
          team: r.team,
          teamId: r.teamId,
          status: r.status,
          imageUrl: r.imageUrl,
        })),
        fromCache: true,
        source: 'cache',
        cacheAge: measuredCacheAge(rows, nowMs),
      }
    }
    return null
  }

  if (dataType === 'teams') {
    const model = getFindManyModel('sportsTeam')
    if (!model) return null

    const rows = await model.findMany({
      where: { sport: dbSport, ...freshOnly(now) },
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
      select: {
        externalId: true,
        name: true,
        shortName: true,
        city: true,
        logo: true,
        fetchedAt: true,
      },
    })

    if (rows.length > 0) {
      return {
        data: rows.map((r) => ({
          id: r.externalId,
          name: r.name,
          abbrv: r.shortName,
          city: r.city,
          logo: r.logo,
        })),
        fromCache: true,
        source: 'cache',
        cacheAge: measuredCacheAge(rows, nowMs),
      }
    }
    return null
  }

  if (dataType === 'injuries') {
    const model = getFindManyModel('sportsInjury')
    if (!model) return null

    /*
     * Scoped by season and week where the caller asked for them — the table is
     * indexed on `[sport, season, week]` for exactly this. An unscoped read
     * answered "who is hurt in week 3" with the most recent 200 injuries of any
     * week, which is unsafe for the lineup and waiver advice built on it.
     */
    const rows = await model.findMany({
      where: {
        sport: dbSport,
        ...freshOnly(now),
        ...(Number.isFinite(seasonNum) ? { season: Math.floor(seasonNum) } : {}),
        ...(Number.isFinite(weekNum) ? { week: Math.floor(weekNum) } : {}),
        ...(teamQ ? { team: { equals: teamQ, mode: 'insensitive' } } : {}),
        ...(nameQ ? { playerName: { contains: nameQ, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ date: 'desc' }],
      take: limit,
      select: {
        externalId: true,
        playerId: true,
        playerName: true,
        team: true,
        status: true,
        description: true,
        date: true,
        fetchedAt: true,
      },
    })

    if (rows.length > 0) {
      return {
        data: rows.map((r) => ({
          externalId: r.externalId,
          playerId: r.playerId,
          playerName: r.playerName,
          team: r.team,
          status: r.status,
          notes: r.description,
          reportDate: toIsoString(r.date),
        })),
        fromCache: true,
        source: 'cache',
        cacheAge: measuredCacheAge(rows, nowMs),
      }
    }
    return null
  }

  if (dataType === 'news') {
    const model = getFindManyModel('sportsNews')
    if (!model) return null

    const rows = await model.findMany({
      where: {
        sport: dbSport,
        ...freshOnly(now),
        ...(teamQ ? { team: { equals: teamQ, mode: 'insensitive' } } : {}),
        ...(nameQ ? { playerName: { contains: nameQ, mode: 'insensitive' } } : {}),
      },
      orderBy: [{ publishedAt: 'desc' }],
      take: limit,
      select: {
        externalId: true,
        title: true,
        description: true,
        content: true,
        publishedAt: true,
        fetchedAt: true,
      },
    })

    if (rows.length > 0) {
      return {
        data: rows.map((r) => ({
          id: r.externalId,
          title: r.title,
          description: r.description,
          content: r.content,
          publishedAt: toIsoString(r.publishedAt),
        })),
        fromCache: true,
        source: 'cache',
        cacheAge: measuredCacheAge(rows, nowMs),
      }
    }
    return null
  }

  if (
    dataType === 'schedule' ||
    dataType === 'scores' ||
    dataType === 'games' ||
    dataType === 'live_game'
  ) {
    const model = getFindManyModel('sportsGame')
    if (!model) return null

    if (hasUnscopedDimension(mergedQuery)) return null

    const seasonTypeQ =
      typeof mergedQuery.seasonType === 'string' ? mergedQuery.seasonType.trim() : ''
    const statusQ = typeof mergedQuery.status === 'string' ? mergedQuery.status.trim() : ''
    const teamKey = teamQ ? normalizeTeamAbbrev(teamQ) || teamQ : ''

    const rows = await model.findMany({
      where: {
        sport: dbSport,
        ...freshOnly(now),
        ...(Number.isFinite(seasonNum) ? { season: Math.floor(seasonNum) } : {}),
        ...(Number.isFinite(weekNum) ? { week: Math.floor(weekNum) } : {}),
        ...(seasonTypeQ ? { seasonType: seasonTypeQ } : {}),
        ...(statusQ ? { status: { equals: statusQ, mode: 'insensitive' } } : {}),
        ...(teamKey
          ? {
              OR: [
                { homeTeam: { equals: teamKey, mode: 'insensitive' } },
                { awayTeam: { equals: teamKey, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: [{ startTime: 'desc' }],
      /*
       * Over-read, because the dedup below happens in memory and discards whole
       * SOURCES. Taking `limit` here and then dropping every row that did not
       * come from the winning feed would return a fraction of what the caller
       * asked for — the result is sliced back to `limit` after the dedup.
       *
       * ⚠ A cross-source dedup by id is not available: `externalId` is the
       * PROVIDER's own id (`game.gameId` from Rolling Insights, `idEvent` from
       * TheSportsDB), so the same fixture carries a different id in each feed
       * and nothing matches them up. Choosing one feed wholesale is the only
       * dedup this table supports, which is why `pickFreshestSourceRows` works
       * the way it does.
       */
      take: Math.min(limit * 4, 1000),
      select: {
        externalId: true,
        homeTeam: true,
        awayTeam: true,
        homeScore: true,
        awayScore: true,
        status: true,
        startTime: true,
        venue: true,
        week: true,
        seasonType: true,
        season: true,
        source: true,
        fetchedAt: true,
      },
    })

    if (rows.length === 0) return null

    const deduped = (
      pickFreshestSourceRows(
        rows as unknown as Array<{ source: string | null; fetchedAt: Date | null }>,
        nowMs
      ) as unknown as Array<Record<string, unknown>>
    ).slice(0, limit)

    /*
     * A schedule row is not an answer to a scores question.
     *
     * Before this, `scores` and `live_game` were satisfied by any game row —
     * and since the reader never selected the score columns, the answer could
     * not have contained a score even when one was stored. Falling through to
     * the providers costs one call on a slate that has genuinely not kicked off
     * yet, which is the right direction to be wrong in: the provider is the
     * thing that knows a game is scheduled rather than simply unrecorded.
     */
    const wantsScores = dataType === 'scores' || dataType === 'live_game'
    if (wantsScores && !deduped.some((r) => r.homeScore != null || r.awayScore != null)) {
      return null
    }

    return {
      data: deduped.map((r) => ({
        id: r.externalId,
        gameId: r.externalId,
        homeTeam: r.homeTeam,
        awayTeam: r.awayTeam,
        homeScore: r.homeScore ?? null,
        awayScore: r.awayScore ?? null,
        status: r.status,
        date: toIsoString(r.startTime),
        venue: r.venue,
        week: r.week ?? null,
        seasonType: r.seasonType ?? null,
        season: r.season,
      })),
      fromCache: true,
      source: 'cache',
      cacheAge: measuredCacheAge(deduped, nowMs),
    }
  }

  return null
}

async function saveToNormalizedTables(
  sport: string,
  dataType: string,
  data: unknown,
  source?: string
): Promise<void> {
  const chain = toApiChainSport(sport)
  if (!chain) return
  const persistable = new Set(['players', 'injuries', 'news', 'teams', 'schedule', 'scores'])
  if (!persistable.has(dataType)) return
  await persistNormalizedSportsRows(chain, dataType as ApiDataType, data, source)
}

/**
 * DB-first sports fetch: SportsDataCache → Rolling Insights → api-sports fallback.
 * Cache key uses sport, data type, normalized query, and normalized options.
 */
export async function fetchWithChain(
  params: ApiFetchParams & { forceRefresh?: boolean }
): Promise<ChainFetchResult> {
  const chainSport = toApiChainSport(params.sport as string)
  if (!chainSport) {
    return { data: null, error: 'Unsupported sport', fromCache: false }
  }

  const { dataType, forceRefresh } = params
  const dt = String(dataType)
  const ttl =
    dt in API_CHAIN_TTLS
      ? API_CHAIN_TTLS[dt as ApiDataType]
      : ttlSecondsForDataType(dt)
  const merged = mergeQuery(params)
  const cacheKey = buildApiChainCacheKey({
    sport: chainSport,
    dataType: dt,
    query: params.query,
    options: params.options,
  })

  // 1. CHECK DB CACHE FIRST (skip if forceRefresh)
  if (!forceRefresh) {
    try {
      const cached = await prisma.sportsDataCache.findUnique({
        where: { cacheKey },
      })
      if (cached?.data != null) {
        if (cached.expiresAt > new Date()) {
          const inner = extractCachedPayload(cached.data)
          if (isPopulatedResult(inner)) {
            return {
              data: inner as ChainFetchResult['data'],
              fromCache: true,
              cacheAge: Math.floor((Date.now() - cached.createdAt.getTime()) / 1000),
              source: 'cache',
            }
          }
        }
      }
    } catch (e) {
      console.warn('[api-chain] cache lookup failed:', e)
    }

    try {
      const normalized = await readFromNormalizedTables(chainSport, dt, merged)
      if (normalized && isPopulatedResult(normalized.data)) {
        /*
         * Returned as-is. This used to spread `cacheAge: 0` over the result,
         * which is why a row written months ago reported itself as fetched this
         * instant — the one number a consumer has for deciding whether to trust
         * a cached fact was hardcoded to the most reassuring possible value.
         * `readFromNormalizedTables` now measures it from `fetchedAt`, and
         * leaves it undefined rather than 0 when there is nothing to measure.
         */
        return normalized
      }
    } catch (e) {
      console.warn('[api-chain] normalized lookup failed:', e)
    }
  }

  // 2. CACHE MISS — non-image stays RI-first; NFL image data uses explicit provider ordering.
  let result: ChainFetchResult | null = null

  const isImageDt = dt === 'player_headshots' || dt === 'team_logos'
  // For `scores`, providers without a 'scores' endpoint can still surface useful
  // game state via their `games` shape (TSDB eventsnextleague, api-sports games).
  // For raw `live_game` we still skip fallbacks — none of the secondary providers
  // expose true live in-play deltas.
  const skipGameLikeFallbacks = dt === 'live_game' || dt === 'games'
  const fallbackDt = dt === 'scores' ? 'games' : dt

  const baseParams: ApiFetchParams = { ...params, sport: chainSport, dataType: dt, query: merged }
  const fallbackParams: ApiFetchParams = { ...baseParams, dataType: fallbackDt }

  // Provider priority per product requirement:
  //   Non-image: Rolling Insights → TheSportsDB → API-Sports → ClearSports → Sleeper → ESPN
  //   NFL images: TheSportsDB → Sleeper → API-Sports (then ClearSports/RI as deep fallback)
  // Image data types bypass RI-first because image endpoint coverage is less consistent.
  if (isImageDt) {
    if (chainSport === 'nfl') {
      result =
        (await tryProviderBlock(theSportsDbProvider, baseParams)) ??
        (await tryProviderBlock(sleeperChainProvider, baseParams)) ??
        (await tryProviderBlock(apiSportsProvider, baseParams)) ??
        (await tryProviderBlock(clearSportsProvider, baseParams)) ??
        (await tryRollingInsightsBlock(params, chainSport, dt, merged))
    } else {
      result =
        (await tryProviderBlock(clearSportsProvider, baseParams)) ??
        (await tryProviderBlock(theSportsDbProvider, baseParams)) ??
        (await tryProviderBlock(apiSportsProvider, baseParams)) ??
        (await tryRollingInsightsBlock(params, chainSport, dt, merged)) ??
        (await tryProviderBlock(sleeperChainProvider, baseParams))
    }
  } else {
    result = await tryRollingInsightsBlock(params, chainSport, dt, merged)

    if (!skipGameLikeFallbacks) {
      result =
        result && isPopulatedResult(result.data)
          ? result
          : (await tryProviderBlock(theSportsDbProvider, fallbackParams)) ?? result
      result =
        result && isPopulatedResult(result.data)
          ? result
          : (await tryProviderBlock(apiSportsProvider, fallbackParams)) ?? result
      result =
        result && isPopulatedResult(result.data)
          ? result
          : (await tryProviderBlock(clearSportsProvider, fallbackParams)) ?? result
      // CFBD fallback for NCAAF teams/schedule/games
      result =
        result && isPopulatedResult(result.data)
          ? result
          : (await tryProviderBlock(cfbdProvider, fallbackParams)) ?? result
    }

    result =
      result && isPopulatedResult(result.data)
        ? result
        : (await tryProviderBlock(sleeperChainProvider, baseParams)) ?? result

    // ESPN final fallback (news/injuries only — see espnProvider.supports)
    result =
      result && isPopulatedResult(result.data)
        ? result
        : (await tryProviderBlock(espnProvider, baseParams)) ?? result
  }

  if (!result || !isPopulatedResult(result.data)) {
    return { data: null, error: result?.error ?? 'All providers failed', fromCache: false }
  }

  const ok = result

  // 4. SAVE TO SportsDataCache
  const expiresAt = new Date(Date.now() + ttl * 1000)
  try {
    await prisma.sportsDataCache.upsert({
      where: { cacheKey },
      update: { data: ok.data as object, expiresAt },
      create: {
        cacheKey,
        data: ok.data as object,
        expiresAt,
      },
    })
  } catch (e) {
    console.error('[api-chain] cache save failed:', e)
  }

  // 5. ALSO SAVE to normalized tables (SportsPlayer, SportsInjury, SportsNews)
  await saveToNormalizedTables(chainSport, dt, ok.data, ok.source).catch(() => {})

  return {
    data: ok.data,
    fromCache: false,
    error: ok.error,
    cacheAge: ok.cacheAge,
    source: ok.source,
    latency: ok.latency,
  }
}

export class ApiChain {
  async fetch<T = unknown>(params: {
    sport: ApiFetchParams['sport']
    dataType: ApiDataType | string
    query?: Record<string, unknown>
    options?: Record<string, unknown>
    forceRefresh?: boolean
  }): Promise<ApiResult<T>> {
    const startedAt = Date.now()
    const attemptedSources: ApiProvider['name'][] = []

    const chain = await fetchWithChain({
      sport: params.sport as string,
      dataType: params.dataType,
      query: params.query,
      options: params.options,
      forceRefresh: params.forceRefresh,
    })

    if (chain.fromCache && chain.source === 'cache') {
      return {
        data: chain.data as T,
        source: 'cache',
        latency: 0,
        cached: true,
        attemptedSources,
      }
    }

    if (chain.error && !chain.data) {
      return {
        data: null,
        source: 'cache',
        latency: toLatency(startedAt),
        cached: false,
        attemptedSources,
        error: chain.error,
      }
    }

    const src = (chain.source ?? 'rolling_insights') as ApiResult<T>['source']
    if (chain.source && chain.source !== 'cache') {
      attemptedSources.push(chain.source as ApiProviderName)
    }

    return {
      data: chain.data as T,
      source: src as ApiResult<T>['source'],
      latency: chain.latency ?? toLatency(startedAt),
      cached: false,
      attemptedSources,
    }
  }
}

export const apiChain = new ApiChain()
