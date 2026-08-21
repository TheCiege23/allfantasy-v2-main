import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const prismaMock = vi.hoisted(() => ({
  sportsNews: {
    findMany: vi.fn(),
  },
  sportsInjury: {
    findMany: vi.fn(),
  },
  injuryReportRecord: {
    findMany: vi.fn(),
  },
  sportsGame: {
    findMany: vi.fn(),
  },
  sportsTeam: {
    findMany: vi.fn(),
  },
  sportsPlayer: {
    findMany: vi.fn(),
  },
  sportsDataCache: {
    findMany: vi.fn(),
  },
  playerSeasonStats: {
    findMany: vi.fn(),
  },
  teamSeasonStats: {
    findMany: vi.fn(),
  },
  depthChart: {
    findMany: vi.fn(),
  },
  trendingPlayer: {
    findMany: vi.fn(),
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: unknown) => handler,
}))

vi.mock('@/lib/workers/api-chain', () => ({
  fetchWithChain: vi.fn(),
}))

function request(url: string) {
  return new NextRequest(url)
}

describe('public sports data routes are cache-first', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaMock.sportsNews.findMany.mockResolvedValue([])
    prismaMock.sportsInjury.findMany.mockResolvedValue([])
    prismaMock.injuryReportRecord.findMany.mockResolvedValue([])
    prismaMock.sportsGame.findMany.mockResolvedValue([])
    prismaMock.sportsTeam.findMany.mockResolvedValue([])
    prismaMock.sportsPlayer.findMany.mockResolvedValue([])
    prismaMock.sportsDataCache.findMany.mockResolvedValue([])
    prismaMock.playerSeasonStats.findMany.mockResolvedValue([])
    prismaMock.teamSeasonStats.findMany.mockResolvedValue([])
    prismaMock.depthChart.findMany.mockResolvedValue([])
    prismaMock.trendingPlayer.findMany.mockResolvedValue([])
  })

  it('returns NBA cached news instead of forcing NFL', async () => {
    const publishedAt = new Date('2026-06-04T15:00:00.000Z')
    prismaMock.sportsNews.findMany.mockResolvedValueOnce([
      {
        id: 'nba-news-1',
        sport: 'NBA',
        title: 'NBA Finals schedule update',
        source: 'newsapi',
        category: 'schedule',
        sentiment: null,
        publishedAt,
        fetchedAt: publishedAt,
        updatedAt: publishedAt,
        expiresAt: new Date('2026-06-04T16:00:00.000Z'),
      },
    ])

    const { GET } = await import('@/app/api/sports/news/route')
    const response = await GET(request('http://localhost/api/sports/news?sport=nba'))
    const body = await response.json()

    expect(prismaMock.sportsNews.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'NBA' }),
      })
    )
    expect(body.sport).toBe('NBA')
    expect(body.news).toHaveLength(1)
    expect(body.news[0].sport).toBe('NBA')
    expect(body.refreshed).toBe(false)
  })

  it('returns MLB cached news instead of forcing NFL', async () => {
    prismaMock.sportsNews.findMany.mockResolvedValueOnce([])

    const { GET } = await import('@/app/api/sports/news/route')
    const response = await GET(request('http://localhost/api/sports/news?sport=mlb'))
    const body = await response.json()

    expect(prismaMock.sportsNews.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'MLB' }),
      })
    )
    expect(body.sport).toBe('MLB')
    expect(body.news).toEqual([])
    expect(body.message).toContain('No cached MLB news')
  })

  it('accepts natural seven-sport aliases without defaulting to NFL', async () => {
    const { GET } = await import('@/app/api/sports/news/route')
    const response = await GET(request('http://localhost/api/sports/news?sport=college-football'))
    const body = await response.json()

    expect(prismaMock.sportsNews.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'NCAAF' }),
      })
    )
    expect(body.sport).toBe('NCAAF')
    expect(body.requestedSport).toBe('college-football')
  })

  it('rejects unsupported news sports with a friendly 400', async () => {
    const { GET } = await import('@/app/api/sports/news/route')
    const response = await GET(request('http://localhost/api/sports/news?sport=cricket'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Unsupported sport')
    expect(prismaMock.sportsNews.findMany).not.toHaveBeenCalled()
  })

  it('queries sport-specific injuries from cached tables', async () => {
    const fetchedAt = new Date('2026-06-04T15:00:00.000Z')
    prismaMock.sportsInjury.findMany.mockResolvedValueOnce([
      {
        id: 'nba-injury-1',
        sport: 'NBA',
        externalId: 'inj-1',
        playerName: 'Example Player',
        playerId: 'player-1',
        team: 'BOS',
        status: 'Questionable',
        type: 'ankle',
        description: 'Ankle soreness',
        date: fetchedAt,
        source: 'rolling_insights',
        fetchedAt,
        expiresAt: new Date('2026-06-04T16:00:00.000Z'),
      },
    ])

    const { GET } = await import('@/app/api/sports/injuries/route')
    const response = await GET(request('http://localhost/api/sports/injuries?sport=nba'))
    const body = await response.json()

    expect(prismaMock.sportsInjury.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'NBA' }),
      })
    )
    expect(prismaMock.injuryReportRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'NBA' }),
      })
    )
    expect(body.sport).toBe('NBA')
    expect(body.injuries).toHaveLength(1)
    expect(body.refreshed).toBe(false)
  })

  it('maps World Cup injury requests to WC_SOCCER reports', async () => {
    const reportDate = new Date('2026-06-04T12:00:00.000Z')
    prismaMock.injuryReportRecord.findMany.mockResolvedValueOnce([
      {
        id: 'wc-injury-1',
        sport: 'WC_SOCCER',
        playerId: 'p1',
        playerName: 'World Cup Player',
        team: 'BRA',
        status: 'Out',
        bodyPart: 'hamstring',
        notes: 'Unavailable',
        reportDate,
      },
    ])

    const { GET } = await import('@/app/api/sports/injuries/route')
    const response = await GET(request('http://localhost/api/sports/injuries?sport=world-cup'))
    const body = await response.json()

    expect(prismaMock.sportsInjury.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'SOCCER' }),
      })
    )
    expect(prismaMock.injuryReportRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'WC_SOCCER' }),
      })
    )
    expect(body.isWorldCup).toBe(true)
    expect(body.injuries[0]).toMatchObject({
      sport: 'WC_SOCCER',
      normalized: true,
    })
  })

  it('rejects unsupported injury sports with a friendly 400', async () => {
    const { GET } = await import('@/app/api/sports/injuries/route')
    const response = await GET(request('http://localhost/api/sports/injuries?sport=rugby'))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('Unsupported sport')
    expect(prismaMock.sportsInjury.findMany).not.toHaveBeenCalled()
    expect(prismaMock.injuryReportRecord.findMany).not.toHaveBeenCalled()
  })

  it('returns stale live score cache metadata without calling providers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const fetchedAt = new Date(Date.now() - 10 * 60 * 1000)
    prismaMock.sportsGame.findMany.mockResolvedValueOnce([
      {
        id: 'game-1',
        sport: 'NHL',
        externalId: 'nhl-game-1',
        homeTeam: 'Rangers',
        awayTeam: 'Bruins',
        homeScore: 2,
        awayScore: 1,
        status: 'STATUS_IN_PROGRESS',
        startTime: new Date('2026-06-04T23:00:00.000Z'),
        venue: 'Arena',
        week: null,
        season: 2026,
        source: 'espn_live',
        fetchedAt,
      },
    ])

    const { GET } = await import('@/app/api/sports/live-scores/route')
    const response = await GET(request('http://localhost/api/sports/live-scores?sport=nhl'))
    const body = await response.json()

    expect(prismaMock.sportsGame.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sport: 'NHL',
          source: { in: ['rolling_insights', 'espn_live', 'api_sports'] },
        }),
      })
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(body.sport).toBe('NHL')
    expect(body.count).toBe(1)
    expect(body.refreshed).toBe(false)
    expect(body.isStale).toBe(true)
    expect(body.message).toContain('stale')
    fetchSpy.mockRestore()
  })

  it('returns a friendly empty live score state without calling providers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const { GET } = await import('@/app/api/sports/live-scores/route')
    const response = await GET(request('http://localhost/api/sports/live-scores?sport=nba'))
    const body = await response.json()

    expect(prismaMock.sportsGame.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'NBA' }),
      })
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(body.scores).toEqual([])
    expect(body.message).toContain('No cached NBA live scores')
    fetchSpy.mockRestore()
  })

  it('keeps the generic /api/sports route cache-only even when refresh=true', async () => {
    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    prismaMock.sportsPlayer.findMany.mockResolvedValueOnce([
      {
        id: 'player-1',
        sport: 'NBA',
        externalId: 'nba-1',
        name: 'Cached Player',
        team: 'BOS',
        source: 'rolling_insights',
      },
    ])

    const { GET } = await import('@/app/api/sports/route')
    const response = await GET(request('http://localhost/api/sports?sport=nba&type=players&refresh=true'))
    const body = await response.json()

    expect(fetchWithChain).not.toHaveBeenCalled()
    expect(prismaMock.sportsPlayer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sport: 'NBA' }),
      })
    )
    expect(body.fromCache).toBe(true)
    expect(body.refreshed).toBe(false)
    expect(body.refreshIgnored).toBe(true)
    expect(body.count).toBe(1)
  })

  it('does not auto-sync NFL team stats when stale or refresh is requested', async () => {
    const { GET } = await import('@/app/api/sports/team-stats/route')
    const response = await GET(request('http://localhost/api/sports/team-stats?team=kc&refresh=true'))
    const body = await response.json()

    expect(prismaMock.teamSeasonStats.findMany).toHaveBeenCalled()
    expect(body.synced).toBe(false)
    expect(body.refreshIgnored).toBe(true)
    expect(body.isStale).toBe(true)
  })

  it('does not auto-sync NFL depth charts when stale or refresh is requested', async () => {
    const { GET } = await import('@/app/api/sports/depth-charts/route')
    const response = await GET(request('http://localhost/api/sports/depth-charts?team=kc&refresh=true'))
    const body = await response.json()

    expect(prismaMock.depthChart.findMany).toHaveBeenCalled()
    expect(body.synced).toBe(false)
    expect(body.refreshIgnored).toBe(true)
    expect(body.isStale).toBe(true)
  })

  it('does not call Sleeper from public trending route', async () => {
    const { GET } = await import('@/app/api/sports/trending/route')
    const response = await GET(request('http://localhost/api/sports/trending?sport=nfl&refresh=true'))
    const body = await response.json()

    expect(prismaMock.trendingPlayer.findMany).toHaveBeenCalled()
    expect(body.synced).toBe(false)
    expect(body.refreshIgnored).toBe(true)
    expect(body.isStale).toBe(true)
  })
})
