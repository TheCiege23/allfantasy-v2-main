import { beforeEach, describe, expect, it, vi } from 'vitest'

const playerFindFirstMock = vi.fn()
const playerCareerProjectionFindFirstMock = vi.fn()
const playerMetaTrendFindUniqueMock = vi.fn()
const playerSeasonStatsFindManyMock = vi.fn()
const playerIdentityMapFindManyMock = vi.fn()
const openaiChatTextMock = vi.fn()
const getPlayerMetaTrendsForMetaMock = vi.fn()
const getPlayerAnalyticsMock = vi.fn()
const getTrendFeedItemForPlayerMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    player: {
      findFirst: playerFindFirstMock,
    },
    playerCareerProjection: {
      findFirst: playerCareerProjectionFindFirstMock,
    },
    playerMetaTrend: {
      findUnique: playerMetaTrendFindUniqueMock,
    },
    playerSeasonStats: {
      findMany: playerSeasonStatsFindManyMock,
    },
    playerIdentityMap: {
      findMany: playerIdentityMapFindManyMock,
    },
    aiResult: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/openai-client', () => ({
  openaiChatText: openaiChatTextMock,
}))

vi.mock('@/lib/global-meta-engine/MetaQueryService', () => ({
  getPlayerMetaTrendsForMeta: getPlayerMetaTrendsForMetaMock,
}))

vi.mock('@/lib/player-analytics', () => ({
  getPlayerAnalytics: getPlayerAnalyticsMock,
}))

vi.mock('@/lib/player-trend/TrendDetectionService', () => ({
  getTrendFeedItemForPlayer: getTrendFeedItemForPlayerMock,
}))

describe('PlayerCardAnalyticsService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getPlayerMetaTrendsForMetaMock.mockResolvedValue([])
    getTrendFeedItemForPlayerMock.mockResolvedValue(null)
    playerFindFirstMock.mockResolvedValue(null)
    playerCareerProjectionFindFirstMock.mockResolvedValue(null)
    playerMetaTrendFindUniqueMock.mockResolvedValue(null)
    playerSeasonStatsFindManyMock.mockResolvedValue([])
    playerIdentityMapFindManyMock.mockResolvedValue([])
  })

  it('returns all analytics sections when core data exists', async () => {
    const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')

    playerFindFirstMock.mockResolvedValueOnce({ id: 'p-1' })
    getPlayerAnalyticsMock.mockResolvedValueOnce({
      position: 'WR',
      currentTeam: 'MIA',
      fantasyPointsPerGame: 16.2,
      expectedFantasyPoints: 275.4,
      expectedFantasyPointsPerGame: 17.8,
      draft: { currentAdp: 14.5 },
      weeklyVolatility: 22,
    })
    playerMetaTrendFindUniqueMock.mockResolvedValueOnce({
      playerId: 'p-1',
      sport: 'NFL',
      trendScore: 88,
      addRate: 0.22,
      dropRate: 0.03,
      tradeInterest: 0.19,
      draftFrequency: 0.71,
      trendingDirection: 'Rising',
      updatedAt: new Date('2026-03-22T12:00:00.000Z'),
    })
    playerCareerProjectionFindFirstMock.mockResolvedValueOnce({
      projectedPointsYear1: 260,
      projectedPointsYear2: 252,
      projectedPointsYear3: 238,
      projectedPointsYear4: 220,
      projectedPointsYear5: 198,
      breakoutProbability: 62,
      declineProbability: 28,
      volatilityScore: 34,
      season: 2026,
    })
    openaiChatTextMock.mockResolvedValueOnce({
      ok: true,
      text: 'Target confidently in the mid rounds due to stable volume and rising trend metrics.',
    })

    const payload = await getPlayerCardAnalytics({
      playerName: 'Tyreek Hill',
      sport: 'NFL',
      season: '2026',
    })

    expect(payload.playerId).toBe('p-1')
    expect(payload.playerName).toBe('Tyreek Hill')
    expect(payload.sport).toBe('NFL')
    expect(payload.metaTrends?.tradeRate).toBe(0.19)
    expect(payload.matchupPrediction?.opponentTier).toBe('favorable')
    expect(payload.careerProjection?.projectedPointsYear1).toBe(260)
    expect(payload.aiInsights).toContain('Target confidently')
    expect(getPlayerMetaTrendsForMetaMock).not.toHaveBeenCalled()
  })

  it('falls back to list-based meta matching and deterministic insight copy', async () => {
    const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')

    getPlayerAnalyticsMock.mockResolvedValueOnce({
      position: 'PG',
      currentTeam: 'BOS',
      fantasyPointsPerGame: null,
      expectedFantasyPoints: null,
      expectedFantasyPointsPerGame: 8.4,
      draft: { currentAdp: null },
      weeklyVolatility: 72,
    })
    getPlayerMetaTrendsForMetaMock.mockResolvedValueOnce([
      {
        playerId: 'jayson tatum',
        sport: 'NBA',
        trendScore: 41,
        addRate: 0.04,
        dropRate: 0.12,
        tradeRate: 0.03,
        draftRate: 0.51,
        trendingDirection: 'Falling',
        updatedAt: new Date('2026-03-22T12:00:00.000Z'),
      },
    ])
    openaiChatTextMock.mockResolvedValueOnce({ ok: false, text: '' })

    const payload = await getPlayerCardAnalytics({
      playerName: 'Jayson Tatum',
      sport: 'NBA',
      season: '2026',
    })

    expect(payload.metaTrends?.trendingDirection).toBe('Falling')
    expect(payload.matchupPrediction?.opponentTier).toBe('tough')
    expect(payload.aiInsights).toContain('Jayson Tatum is currently trending')
  })

  describe("season stats are read in the table's own id space", () => {
    /*
     * Production 2026-10-12: `player_season_stats` NFL rows are `source = 'rolling_insights'` keyed on
     * RI ids. Sleeper 9509 is Bijan Robinson; RI 9509 is Malachi Fields. Bijan's RI id is 7408.
     */
    type Row = {
      sport: string
      source: string
      playerId: string
      playerName: string
      position: string | null
      team: string | null
      season: string
      gamesPlayed: number | null
      fantasyPoints: number | null
      fantasyPointsPerGame: number | null
      stats: Record<string, unknown>
    }
    const row = (over: Partial<Row>): Row => ({
      sport: 'NFL',
      source: 'rolling_insights',
      playerId: 'x',
      playerName: 'x',
      position: null,
      team: null,
      season: '2026',
      gamesPlayed: 5,
      fantasyPoints: 50,
      fantasyPointsPerGame: 10,
      stats: {},
      ...over,
    })
    const TABLE: Row[] = [
      row({ playerId: '9509', playerName: 'Malachi Fields', position: 'WR', team: 'NO', fantasyPointsPerGame: 7.72 }),
      row({ playerId: '7408', playerName: 'Bijan Robinson', position: 'RB', team: 'ATL', fantasyPointsPerGame: 21.4 }),
      // api_sports also writes bare numbers — never the card's source for NFL.
      row({ playerId: '7408', playerName: 'Somebody Else', source: 'api_sports', season: '2027', fantasyPointsPerGame: 99 }),
      row({ playerId: '501', playerName: 'Josh Allen', position: 'QB', team: 'BUF', fantasyPointsPerGame: 24.1 }),
      row({ playerId: '502', playerName: 'Josh Allen', position: 'LB', team: 'JAX', fantasyPointsPerGame: 6.5 }),
      row({ playerId: '601', playerName: 'Michael Carter', position: 'RB', team: 'TEN', fantasyPointsPerGame: 8.8 }),
      row({ sport: 'NBA', source: 'thesportsdb', playerId: 'tsdb_34153815', playerName: 'Jayson Tatum', team: 'BOS', fantasyPointsPerGame: 44 }),
    ]

    function matches(r: Row, where: Record<string, any>): boolean {
      for (const [k, v] of Object.entries(where)) {
        const actual = (r as Record<string, unknown>)[k]
        if (v && typeof v === 'object' && 'equals' in v) {
          if (String(actual).toLowerCase() !== String(v.equals).toLowerCase()) return false
        } else if (actual !== v) return false
      }
      return true
    }

    beforeEach(() => {
      getPlayerAnalyticsMock.mockResolvedValue(null)
      openaiChatTextMock.mockResolvedValue({ ok: false, text: '' })
      playerSeasonStatsFindManyMock.mockImplementation(async (args: any) =>
        TABLE.filter((r) => matches(r, args.where)).sort((a, b) => b.season.localeCompare(a.season)),
      )
      playerIdentityMapFindManyMock.mockImplementation(async (args: any) => {
        const ids: string[] = args.where.OR?.[0]?.sleeperId?.in ?? []
        const map = [
          { sleeperId: '9509', rollingInsightsId: '7408', canonicalName: 'Bijan Robinson', currentTeam: 'ATL', position: 'RB' },
          // Two identity rows for one Sleeper id, pointing at different RI players.
          { sleeperId: '777', rollingInsightsId: '501', canonicalName: 'Josh Allen', currentTeam: 'BUF', position: 'QB' },
          { sleeperId: '777', rollingInsightsId: '502', canonicalName: 'Josh Allen', currentTeam: 'JAX', position: 'LB' },
        ]
        return map.filter((m) => ids.includes(m.sleeperId))
      })
    })

    it('translates a Sleeper id to its Rolling Insights id and reads only rolling_insights rows', async () => {
      const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')
      const payload = await getPlayerCardAnalytics({ playerId: '9509', playerName: 'Bijan Robinson', sport: 'NFL' })

      expect(payload.seasonHistory?.map((s) => s.fantasyPointsPerGame)).toEqual([21.4])
      expect(payload.matchupPrediction?.outlook).toContain('21.4 PPG')
      const statsWhere = playerSeasonStatsFindManyMock.mock.calls[0]![0].where
      expect(statsWhere).toMatchObject({ sport: 'NFL', playerId: '7408', source: 'rolling_insights' })
    })

    it('refuses a Sleeper id whose identity mapping is not one-to-one, without falling back to the name', async () => {
      const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')
      const payload = await getPlayerCardAnalytics({ playerId: '777', playerName: 'Josh Allen', sport: 'NFL' })
      expect(payload.seasonHistory).toBeNull()
      expect(playerSeasonStatsFindManyMock).not.toHaveBeenCalled()
    })

    it('name fallback refuses a name two players share when nothing tells them apart', async () => {
      const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')
      const payload = await getPlayerCardAnalytics({ playerName: 'Josh Allen', sport: 'NFL' })
      expect(payload.seasonHistory).toBeNull()
      expect(payload.matchupPrediction).toBeNull()
    })

    it('name fallback binds the namesake that position verifies', async () => {
      const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')
      const payload = await getPlayerCardAnalytics({ playerName: 'Josh Allen', position: 'LB', team: 'JAX', sport: 'NFL' })
      expect(payload.seasonHistory?.map((s) => s.fantasyPointsPerGame)).toEqual([6.5])
    })

    it('name fallback refuses a lone row that contradicts the asked-for player', async () => {
      const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')
      // CB Michael Carter (PHI) must not inherit RB Michael Carter's (TEN) line.
      const payload = await getPlayerCardAnalytics({ playerName: 'Michael Carter', position: 'CB', team: 'PHI', sport: 'NFL' })
      expect(payload.seasonHistory).toBeNull()
    })

    it('an unmapped NFL id falls back to the verified name', async () => {
      const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')
      const payload = await getPlayerCardAnalytics({ playerId: '4242', playerName: 'Michael Carter', position: 'RB', team: 'TEN', sport: 'NFL' })
      expect(payload.seasonHistory?.map((s) => s.fantasyPointsPerGame)).toEqual([8.8])
    })

    it('non-NFL ids already in the table namespace are read as given', async () => {
      const { getPlayerCardAnalytics } = await import('@/lib/player-card-analytics/PlayerCardAnalyticsService')
      const payload = await getPlayerCardAnalytics({ playerId: 'tsdb_34153815', playerName: 'Jayson Tatum', sport: 'NBA' })
      expect(payload.seasonHistory?.map((s) => s.fantasyPointsPerGame)).toEqual([44])
      expect(playerIdentityMapFindManyMock).not.toHaveBeenCalled()
      expect(playerSeasonStatsFindManyMock.mock.calls[0]![0].where).toEqual({ sport: 'NBA', playerId: 'tsdb_34153815' })
    })
  })
})
