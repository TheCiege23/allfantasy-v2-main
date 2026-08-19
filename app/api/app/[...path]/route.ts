import { NextRequest, NextResponse } from 'next/server'
import { proxyToExisting } from '@/lib/api/proxy-adapter'

function notMapped(path: string[], method: string) {
  return NextResponse.json(
    {
      error: 'APP_NAMESPACE_ADAPTER_NOT_MAPPED',
      message: `No stable proxy mapping for ${method} /api/app/${path.join('/')}`,
    },
    { status: 501 },
  )
}

function leagueIdFromPath(path: string[]): string | null {
  if (path[0] === 'league' && path[1]) return path[1]
  if (path[0] === 'leagues' && path[1] && path[1] !== 'find' && path[1] !== 'orphans' && path[1] !== 'favorites' && path[1] !== 'history') {
    return path[1]
  }
  return null
}

function leagueSection(path: string[]): string | null {
  if (path[0] === 'league') return path[2] || null
  if (path[0] === 'leagues') return path[2] || null
  return null
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path || []

  if (path.length === 1 && path[0] === 'home') {
    return proxyToExisting(req, { targetPath: '/api/league/list' })
  }

  if (path.length === 1 && path[0] === 'leagues') {
    return proxyToExisting(req, { targetPath: '/api/league/list' })
  }

  if (path[0] === 'leagues' && path[1] === 'find') {
    return proxyToExisting(req, { targetPath: '/api/league/discover' })
  }

  if (path[0] === 'leagues' && path[1] === 'orphans') {
    return proxyToExisting(req, { targetPath: '/api/bracket/public-pools' })
  }

  if (path[0] === 'leagues' && path[1] === 'favorites') {
    return proxyToExisting(req, { targetPath: '/api/league/list', query: { favoritesOnly: true } })
  }

  if (path[0] === 'leagues' && path[1] === 'history') {
    return proxyToExisting(req, { targetPath: '/api/league/list', query: { archived: true } })
  }

  const leagueId = leagueIdFromPath(path)
  const section = leagueSection(path)

  if (leagueId && !section) {
    return proxyToExisting(req, { targetPath: '/api/league/roster', query: { leagueId } })
  }

  if (leagueId && section === 'overview') {
    return proxyToExisting(req, { targetPath: '/api/league/roster', query: { leagueId } })
  }

  if (leagueId && section === 'team') {
    return proxyToExisting(req, { targetPath: '/api/league/roster', query: { leagueId } })
  }

  if (leagueId && section === 'matchups') {
    const week = req.nextUrl.searchParams?.get('week')
    return proxyToExisting(req, {
      targetPath: `/api/leagues/${leagueId}/matchups`,
      query: week ? { week } : undefined,
    })
  }

  if (leagueId && section === 'roster') {
    return proxyToExisting(req, { targetPath: '/api/league/roster', query: { leagueId } })
  }

  if (leagueId && section === 'players') {
    const q = req.nextUrl.searchParams?.get('q')
    if (!q) return NextResponse.json([])
    try {
      const { prisma } = await import('@/lib/prisma')
      const league = await (prisma as any).league.findUnique({
        where: { id: leagueId },
        select: { sport: true },
      })
      const sport = String(league?.sport ?? 'NFL').toUpperCase()
      return proxyToExisting(req, { targetPath: '/api/players/search', query: { q, sport } })
    } catch {
      return proxyToExisting(req, { targetPath: '/api/players/search', query: { q } })
    }
  }

  if (leagueId && section === 'waivers') {
    return proxyToExisting(req, { targetPath: '/api/waiver-ai', query: { leagueId } })
  }

  if (leagueId && section === 'trades') {
    return proxyToExisting(req, { targetPath: '/api/trade-finder', query: { leagueId } })
  }

  if (leagueId && path[2] === 'draft' && path[3] === 'config') {
    return proxyToExisting(req, { targetPath: `/api/leagues/${leagueId}/draft/config` })
  }

  if (leagueId && path[2] === 'waiver' && path[3] === 'config') {
    try {
      const { getWaiverConfigForLeague } = await import('@/lib/waiver-defaults/WaiverConfigResolver')
      const config = await getWaiverConfigForLeague(leagueId)
      if (!config) return NextResponse.json({ error: 'League or waiver config not found' }, { status: 404 })
      return NextResponse.json(config)
    } catch (e) {
      console.warn('[app/league/waiver/config]', e)
      return NextResponse.json({ error: 'Failed to load waiver config' }, { status: 500 })
    }
  }

  if (leagueId && path[2] === 'playoff' && path[3] === 'config') {
    try {
      const { getPlayoffConfigForLeague } = await import('@/lib/playoff-defaults/PlayoffConfigResolver')
      const config = await getPlayoffConfigForLeague(leagueId)
      if (!config) return NextResponse.json({ error: 'League or playoff config not found' }, { status: 404 })
      return NextResponse.json(config)
    } catch (e) {
      console.warn('[app/league/playoff/config]', e)
      return NextResponse.json({ error: 'Failed to load playoff config' }, { status: 500 })
    }
  }

  if (leagueId && path[2] === 'schedule' && path[3] === 'config') {
    try {
      const { getScheduleConfigForLeague } = await import('@/lib/schedule-defaults/ScheduleConfigResolver')
      const config = await getScheduleConfigForLeague(leagueId)
      if (!config) return NextResponse.json({ error: 'League or schedule config not found' }, { status: 404 })
      return NextResponse.json(config)
    } catch (e) {
      console.warn('[app/league/schedule/config]', e)
      return NextResponse.json({ error: 'Failed to load schedule config' }, { status: 500 })
    }
  }

  if (leagueId && path[2] === 'scoring' && path[3] === 'config') {
    try {
      const { getLeagueScoringConfig } = await import('@/lib/scoring-defaults/LeagueScoringConfigResolver')
      const config = await getLeagueScoringConfig(leagueId)
      if (!config) {
        return NextResponse.json(
          { error: 'League or scoring config not found' },
          { status: 404 }
        )
      }
      return NextResponse.json(config)
    } catch (e) {
      console.warn('[app/league/scoring/config]', e)
      return NextResponse.json(
        { error: 'Failed to load scoring config' },
        { status: 500 }
      )
    }
  }

  if (leagueId && section === 'draft') {
    const limit = req.nextUrl.searchParams?.get('limit')
    const poolType = req.nextUrl.searchParams?.get('poolType')
    return proxyToExisting(req, {
      targetPath: `/api/leagues/${leagueId}/draft/pool`,
      query: {
        ...(limit ? { limit } : {}),
        ...(poolType ? { poolType } : {}),
      },
    })
  }

  if (leagueId && section === 'standings') {
    // Route through the dedicated standings handler which detects fantasy vs bracket leagues.
    return proxyToExisting(req, { targetPath: `/api/app/leagues/${leagueId}/standings` })
  }

  if (leagueId && section === 'playoffs') {
    // Route through the dedicated standings handler (playoffs seeding comes from same source).
    return proxyToExisting(req, { targetPath: `/api/app/leagues/${leagueId}/standings` })
  }

  if (leagueId && section === 'league') {
    return proxyToExisting(req, { targetPath: '/api/league/roster', query: { leagueId } })
  }

  if (leagueId && section === 'chat') {
    return proxyToExisting(req, { targetPath: `/api/bracket/leagues/${leagueId}/chat` })
  }

  if (leagueId && section === 'settings') {
    return proxyToExisting(req, { targetPath: `/api/bracket/leagues/${leagueId}/settings` })
  }

  if (leagueId && section === 'history') {
    return proxyToExisting(req, { targetPath: '/api/league/roster', query: { leagueId } })
  }

  if (path.length === 1 && path[0] === 'players') {
    return proxyToExisting(req, { targetPath: '/api/players/search' })
  }

  if (path[0] === 'players' && path[1]) {
    return proxyToExisting(req, {
      targetPath: '/api/legacy/player-profile',
      query: { playerId: path[1] },
    })
  }

  if (path.length === 1 && path[0] === 'mock-draft') {
    return proxyToExisting(req, { targetPath: '/api/mock-draft/simulate' })
  }

  if (path.length === 1 && path[0] === 'rankings') {
    return proxyToExisting(req, { targetPath: '/api/rankings' })
  }

  return notMapped(path, 'GET')
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path || []

  if (path.length === 1 && path[0] === 'leagues') {
    return proxyToExisting(req, { targetPath: '/api/league/create' })
  }

  const leagueId = leagueIdFromPath(path)
  const section = leagueSection(path)

  if (leagueId && section === 'waivers' && path[path.length - 1] === 'ai-advice') {
    return proxyToExisting(req, {
      targetPath: '/api/waiver-ai',
      query: { leagueId },
    })
  }

  if (leagueId && section === 'trades' && path[path.length - 1] === 'analyze-ai') {
    return proxyToExisting(req, {
      targetPath: '/api/trades/analyze',
      query: { leagueId },
    })
  }

  if (leagueId && section === 'trades' && path[path.length - 1] === 'reopen-ai') {
    return proxyToExisting(req, {
      targetPath: '/api/legacy/trade-alternatives',
      query: { leagueId },
    })
  }

  if (leagueId && section === 'draft' && path[path.length - 1] === 'recommend-ai') {
    return proxyToExisting(req, {
      targetPath: '/api/mock-draft/ai-pick',
      query: { leagueId },
    })
  }

  if (path.length === 1 && path[0] === 'mock-draft') {
    return proxyToExisting(req, { targetPath: '/api/mock-draft/simulate' })
  }

  if (path[0] === 'watchlist') {
    return NextResponse.json(
      {
        error: 'APP_NAMESPACE_ADAPTER_PENDING',
        message: 'Watchlist API adapter pending stable backend endpoint mapping.',
      },
      { status: 501 },
    )
  }

  return notMapped(path, 'POST')
}

export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  const path = params.path || []

  const leagueId = leagueIdFromPath(path)
  const section = leagueSection(path)

  if (leagueId && section === 'trades' && path[path.length - 1] === 'respond') {
    return proxyToExisting(req, {
      targetPath: '/api/trade/propose',
      query: { leagueId, tradeId: path[path.length - 2] },
      method: 'PATCH',
    })
  }

  if (leagueId && section === 'settings') {
    return proxyToExisting(req, {
      targetPath: `/api/bracket/leagues/${leagueId}/settings`,
      method: 'PATCH',
    })
  }

  return notMapped(path, 'PATCH')
}

