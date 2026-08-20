import { NextRequest, NextResponse } from 'next/server'
import { withApiUsage } from '@/lib/telemetry/usage'
import { API_CHAIN_TTLS, SUPPORTED_SPORTS, apiChainSportToDbSport, toApiChainSport } from '@/lib/workers/api-config'
import type { ApiChainSport, ApiDataType } from '@/lib/workers/api-config'
import { prisma } from '@/lib/prisma'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'

export const dynamic = 'force-dynamic'

function isApiDataType(v: string): v is ApiDataType {
  return Object.prototype.hasOwnProperty.call(API_CHAIN_TTLS, v)
}

function isSupportedSportsDataType(v: string): boolean {
  return isApiDataType(v) || v === 'games' || v === 'stats' || v === 'odds'
}

async function handleSports(req: {
  sport: string
  dataType: string
  options?: Record<string, unknown>
  forceRefresh?: boolean
}) {
  const sportRaw = (req.sport || 'nfl').toLowerCase()
  const chainSport = toApiChainSport(sportRaw) as ApiChainSport | null
  if (!chainSport || !(SUPPORTED_SPORTS as readonly string[]).includes(chainSport)) {
    return NextResponse.json(
      { error: `Unsupported sport: ${sportRaw}. Supported: ${SUPPORTED_SPORTS.join(', ')}` },
      { status: 400 }
    )
  }

  const rawType = (req.dataType || 'players').toLowerCase()
  if (!isSupportedSportsDataType(rawType)) {
    return NextResponse.json({ error: `Unsupported data type: ${req.dataType}` }, { status: 400 })
  }
  const dataType = rawType as ApiDataType | 'games' | 'stats' | 'odds'
  const dbSport = apiChainSportToDbSport(chainSport)
  const result = await readCachedSportsData({
    sport: dbSport,
    dataType,
    options: req.options,
  })

  return NextResponse.json({
    sport: dbSport,
    dataType,
    fromCache: true,
    refreshed: false,
    refreshIgnored: req.forceRefresh === true,
    cacheAge: null,
    count: Array.isArray(result.data) ? result.data.length : null,
    data: result.data,
    error: result.error ?? null,
    message: result.message ?? 'Public sports data routes are cache-only. Use admin/cron sync to refresh providers.',
  })
}

function optionText(options: Record<string, unknown> | undefined, keys: string[]): string | null {
  if (!options) return null
  for (const key of keys) {
    const value = options[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function optionNumber(options: Record<string, unknown> | undefined, key: string, fallback: number): number {
  const raw = options?.[key]
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(250, n))
}

async function readCachedSportsData(args: {
  sport: string
  dataType: ApiDataType | 'games' | 'stats' | 'odds'
  options?: Record<string, unknown>
}): Promise<{ data: unknown[]; error?: string | null; message?: string | null }> {
  const limit = optionNumber(args.options, 'limit', 50)
  const search = optionText(args.options, ['search', 'identifier', 'id', 'playerName', 'name'])
  const team = optionText(args.options, ['team', 'teamAbbrev'])
  const now = new Date()

  switch (args.dataType) {
    case 'teams':
      return {
        data: await prisma.sportsTeam.findMany({
          where: {
            sport: args.sport,
            ...(search
              ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { shortName: { contains: search, mode: 'insensitive' } }] }
              : {}),
          },
          orderBy: { name: 'asc' },
          take: limit,
        }),
      }
    case 'players':
      return {
        data: await prisma.sportsPlayer.findMany({
          where: {
            sport: args.sport,
            ...(team ? { team: team.toUpperCase() } : {}),
            ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
          },
          orderBy: { name: 'asc' },
          take: limit,
        }),
      }
    case 'schedule':
    case 'games':
    case 'scores':
    case 'live_game':
      return {
        data: await prisma.sportsGame.findMany({
          where: {
            sport: args.sport,
            ...(team
              ? {
                  OR: [
                    { homeTeam: { equals: team.toUpperCase(), mode: 'insensitive' } },
                    { awayTeam: { equals: team.toUpperCase(), mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          orderBy: { startTime: 'asc' },
          take: limit,
        }),
      }
    case 'injuries': {
      // Slice 18 follow-on — canonical injury read port: TTL-respected, one
      // row per player, freshest source wins, staleness reported per row.
      const factList = await listInjuryFacts({
        sport: args.sport,
        team: team ? team.toUpperCase() : null,
        playerNameContains: search ?? null,
        limit,
      })
      return {
        data: factList.facts.map((f) => ({
          id: f.id,
          sport: args.sport,
          playerName: f.playerName,
          team: f.team,
          position: f.position,
          status: f.status,
          type: f.type,
          description: f.description,
          date: f.date,
          week: f.week,
          source: f.source,
          fetchedAt: f.fetchedAt,
          stale: f.stale,
        })),
      }
    }
    case 'news':
      return {
        data: await prisma.sportsNews.findMany({
          where: {
            sport: args.sport,
            ...(team ? { team: team.toUpperCase() } : {}),
            ...(search
              ? {
                  OR: [
                    { title: { contains: search, mode: 'insensitive' } },
                    { playerName: { contains: search, mode: 'insensitive' } },
                    { team: { contains: search, mode: 'insensitive' } },
                  ],
                }
              : {}),
          },
          orderBy: [{ publishedAt: 'desc' }, { fetchedAt: 'desc' }],
          take: limit,
        }),
      }
    case 'stats':
      return {
        data: await prisma.playerSeasonStats.findMany({
          where: {
            sport: args.sport,
            ...(team ? { team: team.toUpperCase() } : {}),
            ...(search ? { playerName: { contains: search, mode: 'insensitive' } } : {}),
          },
          orderBy: [{ season: 'desc' }, { updatedAt: 'desc' }],
          take: limit,
        }),
      }
    case 'trending':
      return {
        data: await prisma.trendingPlayer.findMany({
          where: {
            sport: args.sport.toLowerCase(),
            ...(team ? { team: team.toUpperCase() } : {}),
            ...(search ? { playerName: { contains: search, mode: 'insensitive' } } : {}),
          },
          orderBy: { crowdScore: 'desc' },
          take: limit,
        }),
      }
    case 'adp':
      return {
        data: await prisma.adpDataRecord.findMany({
          where: {
            sport: args.sport,
            ...(team ? { team: team.toUpperCase() } : {}),
            ...(search ? { playerName: { contains: search, mode: 'insensitive' } } : {}),
          },
          orderBy: [{ season: 'desc' }, { week: 'desc' }, { adp: 'asc' }],
          take: limit,
        }),
      }
    case 'player_headshots':
    case 'team_logos':
    case 'rolling_insights':
    case 'standings':
    case 'projections':
    case 'rankings':
    case 'odds':
      return {
        data: await prisma.sportsDataCache.findMany({
          where: {
            expiresAt: { gte: now },
            OR: [
              { cacheKey: { contains: `${args.sport}:${args.dataType}` } },
              { cacheKey: { contains: `${args.sport.toLowerCase()}:${args.dataType}` } },
              { cacheKey: { contains: `${args.dataType}:${args.sport}` } },
              { cacheKey: { contains: `${args.dataType}:${args.sport.toLowerCase()}` } },
            ],
          },
          orderBy: { expiresAt: 'desc' },
          take: limit,
        }),
        message: `Cached ${args.dataType} payloads only. Admin/cron sync must refresh providers.`,
      }
    default:
      return { data: [], error: `Cached reader not implemented for ${args.dataType}` }
  }
}

const getSportsHandler = async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url)
    const forceRefresh = searchParams?.get('refresh') === 'true'
    const identifier = searchParams?.get('id') || undefined
    const optionsRaw = searchParams?.get('options')
    let options: Record<string, unknown> | undefined
    if (optionsRaw) {
      try {
        options = JSON.parse(optionsRaw) as Record<string, unknown>
      } catch {
        return NextResponse.json({ error: 'Invalid options JSON' }, { status: 400 })
      }
    }
    const mergedOptions: Record<string, unknown> = options ? { ...options } : {}
    if (identifier) {
      mergedOptions.id ??= identifier
      mergedOptions.identifier ??= identifier
      mergedOptions.search ??= identifier
      mergedOptions.playerName ??= identifier
    }

    return await handleSports({
      sport: searchParams?.get('sport') ?? 'nfl',
      dataType: searchParams?.get('type') ?? 'players',
      options: Object.keys(mergedOptions).length > 0 ? mergedOptions : undefined,
      forceRefresh,
    })
  } catch (err: unknown) {
    const anyErr = err as { message?: string; stack?: string }
    console.error('[api/sports] error:', anyErr?.message, anyErr?.stack)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

const postSportsHandler = async (req: NextRequest) => {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      sport?: string
      type?: string
      dataType?: string
      options?: Record<string, unknown>
      forceRefresh?: boolean
      refresh?: boolean
    }
    return await handleSports({
      sport: body.sport ?? 'nfl',
      dataType: body.type ?? body.dataType ?? 'players',
      options: body.options,
      forceRefresh: body.forceRefresh === true || body.refresh === true,
    })
  } catch (err: unknown) {
    const anyErr = err as { message?: string; stack?: string }
    console.error('[api/sports] POST error:', anyErr?.message, anyErr?.stack)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export const GET = withApiUsage({ endpoint: '/api/sports', tool: 'Sports' })(getSportsHandler)
export const POST = withApiUsage({ endpoint: '/api/sports', tool: 'Sports' })(postSportsHandler)

