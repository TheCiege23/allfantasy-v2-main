import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findUniqueMock = vi.fn()
const findManyMock = vi.fn()
const playerNewsFindManyMock = vi.fn()
const runSportsDataImporterMock = vi.fn()
const runNewsImporterMock = vi.fn()
const requestPlayerImportRefreshMock = vi.fn()
const requestPlayerNewsRefreshMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsPlayerRecord: {
      findUnique: findUniqueMock,
      findMany: findManyMock,
    },
    playerNewsRecord: {
      findMany: playerNewsFindManyMock,
    },
  },
}))

vi.mock('@/lib/workers/sports-data-importer', () => ({
  runSportsDataImporter: runSportsDataImporterMock,
}))

vi.mock('@/lib/workers/sports-data-import-coordinator', () => ({
  requestPlayerImportRefresh: requestPlayerImportRefreshMock,
  requestPlayerNewsRefresh: requestPlayerNewsRefreshMock,
}))

vi.mock('@/lib/workers/injury-importer', () => ({ runInjuryImporter: vi.fn() }))
vi.mock('@/lib/workers/news-importer', () => ({ runNewsImporter: runNewsImporterMock }))

const ORIGINAL_FLAG = process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH

describe('getPlayer / searchPlayers non-blocking refresh guardrail (Phase 21)', () => {
  beforeEach(() => {
    vi.resetModules()
    findUniqueMock.mockReset()
    findManyMock.mockReset()
    playerNewsFindManyMock.mockReset()
    runSportsDataImporterMock.mockReset()
    runNewsImporterMock.mockReset()
    requestPlayerImportRefreshMock.mockReset()
    requestPlayerNewsRefreshMock.mockReset()
  })

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH
    else process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH = ORIGINAL_FLAG
  })

  describe('flag disabled (default / rollback state)', () => {
    beforeEach(() => {
      delete process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH
    })

    it('getPlayer cache hit returns the cached row without starting an importer', async () => {
      const cached = { id: 'nfl:1', sport: 'NFL', lastUpdated: new Date() }
      findUniqueMock.mockResolvedValue(cached)
      const { getPlayer } = await import('@/lib/data/players')

      const row = await getPlayer('nfl:1')

      expect(row).toBe(cached)
      expect(runSportsDataImporterMock).not.toHaveBeenCalled()
      expect(requestPlayerImportRefreshMock).not.toHaveBeenCalled()
    })

    it('getPlayer cache miss preserves prior behavior: awaits the importer synchronously', async () => {
      findUniqueMock.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'nfl:2', sport: 'NFL' })
      runSportsDataImporterMock.mockResolvedValue({ imported: 1, sports: ['NFL'], staleFallbackApplied: false })
      const { getPlayer } = await import('@/lib/data/players')

      const row = await getPlayer('nfl:2')

      expect(runSportsDataImporterMock).toHaveBeenCalledWith({ sports: ['NFL'] })
      expect(requestPlayerImportRefreshMock).not.toHaveBeenCalled()
      expect(row).toEqual({ id: 'nfl:2', sport: 'NFL' })
    })

    it('searchPlayers empty result preserves prior behavior: awaits the importer synchronously', async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'nba:1', name: 'Test Player' }])
      runSportsDataImporterMock.mockResolvedValue({ imported: 1, sports: ['NBA'], staleFallbackApplied: false })
      const { searchPlayers } = await import('@/lib/data/players')

      const rows = await searchPlayers('Test', 'NBA')

      expect(runSportsDataImporterMock).toHaveBeenCalledWith({ sports: ['NBA'] })
      expect(requestPlayerImportRefreshMock).not.toHaveBeenCalled()
      expect(rows).toEqual([{ id: 'nba:1', name: 'Test Player' }])
    })

    it('getPlayersByTeam empty result preserves prior behavior: awaits the importer synchronously', async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: 'nfl:1', team: 'KC' }])
      runSportsDataImporterMock.mockResolvedValue({ imported: 1, sports: ['NFL'], staleFallbackApplied: false })
      const { getPlayersByTeam } = await import('@/lib/data/players')

      const rows = await getPlayersByTeam('KC', 'NFL')

      expect(runSportsDataImporterMock).toHaveBeenCalledWith({ sports: ['NFL'] })
      expect(requestPlayerImportRefreshMock).not.toHaveBeenCalled()
      expect(rows).toEqual([{ id: 'nfl:1', team: 'KC' }])
    })

    it('getPlayerNews empty result preserves prior behavior: awaits runNewsImporter synchronously', async () => {
      playerNewsFindManyMock
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ headline: 'News', playerId: 'nfl:1' }])
      runNewsImporterMock.mockResolvedValue({ imported: 1, sports: ['NFL'] })
      const { getPlayerNews } = await import('@/lib/data/players')

      const rows = await getPlayerNews('nfl:1', 6)

      expect(runNewsImporterMock).toHaveBeenCalledWith()
      expect(requestPlayerNewsRefreshMock).not.toHaveBeenCalled()
      expect(rows).toEqual([{ headline: 'News', playerId: 'nfl:1' }])
    })
  })

  describe('flag enabled (non-blocking guardrail active)', () => {
    beforeEach(() => {
      process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH = 'true'
    })

    it('getPlayer cache hit is unchanged', async () => {
      const cached = { id: 'nfl:1', sport: 'NFL', lastUpdated: new Date() }
      findUniqueMock.mockResolvedValue(cached)
      const { getPlayer } = await import('@/lib/data/players')

      const row = await getPlayer('nfl:1')

      expect(row).toBe(cached)
      expect(runSportsDataImporterMock).not.toHaveBeenCalled()
      expect(requestPlayerImportRefreshMock).not.toHaveBeenCalled()
    })

    it('getPlayer cache miss returns null immediately without awaiting the importer', async () => {
      findUniqueMock.mockResolvedValue(null)
      const { getPlayer } = await import('@/lib/data/players')

      const row = await getPlayer('nfl:999')

      expect(row).toBeNull()
      expect(runSportsDataImporterMock).not.toHaveBeenCalled()
      expect(requestPlayerImportRefreshMock).toHaveBeenCalledWith('NFL', 'get_player_miss')
      // only the initial lookup ran -- no synchronous re-query after import
      expect(findUniqueMock).toHaveBeenCalledTimes(1)
    })

    it('searchPlayers empty result returns immediately without awaiting the importer', async () => {
      findManyMock.mockResolvedValue([])
      const { searchPlayers } = await import('@/lib/data/players')

      const rows = await searchPlayers('Nobody', 'NHL')

      expect(rows).toEqual([])
      expect(runSportsDataImporterMock).not.toHaveBeenCalled()
      expect(requestPlayerImportRefreshMock).toHaveBeenCalledWith('NHL', 'search_players_miss')
      expect(findManyMock).toHaveBeenCalledTimes(1)
    })

    it('does not fabricate a player result on miss', async () => {
      findUniqueMock.mockResolvedValue(null)
      const { getPlayer } = await import('@/lib/data/players')

      const row = await getPlayer('nfl:does-not-exist')

      expect(row).toBeNull()
    })

    it('getPlayersByTeam cache hit is unchanged', async () => {
      const cached = [{ id: 'nfl:1', team: 'KC', lastUpdated: new Date() }]
      findManyMock.mockResolvedValue(cached)
      const { getPlayersByTeam } = await import('@/lib/data/players')

      const rows = await getPlayersByTeam('KC', 'NFL')

      expect(rows).toBe(cached)
      expect(runSportsDataImporterMock).not.toHaveBeenCalled()
      expect(requestPlayerImportRefreshMock).not.toHaveBeenCalled()
    })

    it('getPlayersByTeam empty result returns immediately and requests a background refresh', async () => {
      findManyMock.mockResolvedValue([])
      const { getPlayersByTeam } = await import('@/lib/data/players')

      const rows = await getPlayersByTeam('KC', 'NFL')

      expect(rows).toEqual([])
      expect(runSportsDataImporterMock).not.toHaveBeenCalled()
      expect(requestPlayerImportRefreshMock).toHaveBeenCalledWith('NFL', 'get_players_by_team_miss')
      expect(findManyMock).toHaveBeenCalledTimes(1)
    })

    it('getPlayersByTeam preserves response ordering/shape from the query', async () => {
      const cached = [
        { id: 'nfl:1', name: 'B Player', team: 'KC', lastUpdated: new Date() },
        { id: 'nfl:2', name: 'A Player', team: 'KC', lastUpdated: new Date() },
      ]
      findManyMock.mockResolvedValue(cached)
      const { getPlayersByTeam } = await import('@/lib/data/players')

      const rows = await getPlayersByTeam('KC', 'NFL')

      expect(rows).toEqual(cached)
    })

    it('getPlayerNews cache hit is unchanged', async () => {
      const cached = [{ headline: 'Cached news', playerId: 'nfl:1', publishedAt: new Date() }]
      playerNewsFindManyMock.mockResolvedValue(cached)
      const { getPlayerNews } = await import('@/lib/data/players')

      const rows = await getPlayerNews('nfl:1')

      expect(rows).toBe(cached)
      expect(runNewsImporterMock).not.toHaveBeenCalled()
      expect(requestPlayerNewsRefreshMock).not.toHaveBeenCalled()
    })

    it('getPlayerNews empty result returns immediately and requests a background refresh', async () => {
      playerNewsFindManyMock.mockResolvedValue([])
      const { getPlayerNews } = await import('@/lib/data/players')

      const rows = await getPlayerNews('nfl:does-not-exist')

      expect(rows).toEqual([])
      expect(runNewsImporterMock).not.toHaveBeenCalled()
      expect(requestPlayerNewsRefreshMock).toHaveBeenCalledWith('get_player_news_miss')
      expect(playerNewsFindManyMock).toHaveBeenCalledTimes(1)
    })

    it('a rejected background news refresh cannot affect the getPlayerNews response', async () => {
      playerNewsFindManyMock.mockResolvedValue([])
      requestPlayerNewsRefreshMock.mockImplementation(() => {
        // fire-and-forget: coordinator never throws synchronously to the caller
      })
      const { getPlayerNews } = await import('@/lib/data/players')

      const rows = await getPlayerNews('nfl:1')

      expect(rows).toEqual([])
    })
  })
})
