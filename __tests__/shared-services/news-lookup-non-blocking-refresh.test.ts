import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findManyMock = vi.fn()
const runNewsImporterMock = vi.fn()
const requestSportNewsRefreshMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerNewsRecord: {
      findMany: findManyMock,
    },
  },
}))

vi.mock('@/lib/workers/news-importer', () => ({
  runNewsImporter: runNewsImporterMock,
}))

vi.mock('@/lib/workers/sports-data-import-coordinator', () => ({
  requestSportNewsRefresh: requestSportNewsRefreshMock,
}))

const ORIGINAL_FLAG = process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH

describe('getLatestNews / getHighImpactNews non-blocking refresh guardrail (Phase 24)', () => {
  beforeEach(() => {
    vi.resetModules()
    findManyMock.mockReset()
    runNewsImporterMock.mockReset()
    requestSportNewsRefreshMock.mockReset()
  })

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH
    else process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH = ORIGINAL_FLAG
  })

  describe('flag disabled (default / rollback state)', () => {
    beforeEach(() => {
      delete process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH
    })

    it('getLatestNews empty result preserves prior behavior: awaits runNewsImporter synchronously', async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ headline: 'News', sport: 'NFL' }])
      runNewsImporterMock.mockResolvedValue({ imported: 1, sports: ['NFL'] })
      const { getLatestNews } = await import('@/lib/data/news')

      const rows = await getLatestNews('NFL', 25)

      expect(runNewsImporterMock).toHaveBeenCalledWith({ sports: ['NFL'] })
      expect(requestSportNewsRefreshMock).not.toHaveBeenCalled()
      expect(rows).toEqual([{ headline: 'News', sport: 'NFL' }])
    })

    it('getHighImpactNews empty result preserves prior behavior: awaits runNewsImporter synchronously', async () => {
      findManyMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ headline: 'Big news', impact: 'high' }])
      runNewsImporterMock.mockResolvedValue({ imported: 1, sports: ['NBA'] })
      const { getHighImpactNews } = await import('@/lib/data/news')

      const rows = await getHighImpactNews('NBA')

      expect(runNewsImporterMock).toHaveBeenCalledWith({ sports: ['NBA'] })
      expect(requestSportNewsRefreshMock).not.toHaveBeenCalled()
      expect(rows).toEqual([{ headline: 'Big news', impact: 'high' }])
    })
  })

  describe('flag enabled (non-blocking guardrail active)', () => {
    beforeEach(() => {
      process.env.PLAYER_LOOKUP_NON_BLOCKING_REFRESH = 'true'
    })

    it('getLatestNews cache hit is unchanged', async () => {
      const cached = [{ headline: 'Cached', sport: 'NFL', publishedAt: new Date() }]
      findManyMock.mockResolvedValue(cached)
      const { getLatestNews } = await import('@/lib/data/news')

      const rows = await getLatestNews('NFL', 25)

      expect(rows).toBe(cached)
      expect(runNewsImporterMock).not.toHaveBeenCalled()
      expect(requestSportNewsRefreshMock).not.toHaveBeenCalled()
    })

    it('getLatestNews empty result returns immediately and requests a background refresh', async () => {
      findManyMock.mockResolvedValue([])
      const { getLatestNews } = await import('@/lib/data/news')

      const rows = await getLatestNews('NFL', 25)

      expect(rows).toEqual([])
      expect(runNewsImporterMock).not.toHaveBeenCalled()
      expect(requestSportNewsRefreshMock).toHaveBeenCalledWith('NFL', 'get_latest_news_miss')
      expect(findManyMock).toHaveBeenCalledTimes(1)
    })

    it('getHighImpactNews empty result returns immediately and requests a background refresh', async () => {
      findManyMock.mockResolvedValue([])
      const { getHighImpactNews } = await import('@/lib/data/news')

      const rows = await getHighImpactNews('NBA')

      expect(rows).toEqual([])
      expect(runNewsImporterMock).not.toHaveBeenCalled()
      expect(requestSportNewsRefreshMock).toHaveBeenCalledWith('NBA', 'get_high_impact_news_miss')
      expect(findManyMock).toHaveBeenCalledTimes(1)
    })

    it('does not fabricate news on miss', async () => {
      findManyMock.mockResolvedValue([])
      const { getLatestNews } = await import('@/lib/data/news')

      const rows = await getLatestNews('MLB', 25)

      expect(rows).toEqual([])
    })
  })
})
