import { beforeEach, describe, expect, it, vi } from 'vitest'

const runSportsDataImporterMock = vi.fn()
const runNewsImporterMock = vi.fn()

vi.mock('@/lib/workers/sports-data-importer', () => ({
  runSportsDataImporter: runSportsDataImporterMock,
}))

vi.mock('@/lib/workers/news-importer', () => ({
  runNewsImporter: runNewsImporterMock,
}))

async function loadCoordinator() {
  const mod = await import('@/lib/workers/sports-data-import-coordinator')
  mod.__resetPlayerImportCoordinatorForTests()
  return mod
}

describe('sports-data-import-coordinator', () => {
  beforeEach(() => {
    vi.resetModules()
    runSportsDataImporterMock.mockReset()
    runNewsImporterMock.mockReset()
  })

  it('starts exactly one importer execution for concurrent misses on the same sport', async () => {
    let resolveImport!: (value: { imported: number; sports: string[]; staleFallbackApplied: boolean }) => void
    runSportsDataImporterMock.mockReturnValue(
      new Promise((resolve) => {
        resolveImport = resolve
      })
    )

    const { requestPlayerImportRefresh } = await loadCoordinator()

    requestPlayerImportRefresh('NFL', 'get_player_miss')
    requestPlayerImportRefresh('NFL', 'search_players_miss')
    requestPlayerImportRefresh('NFL', 'get_player_miss')

    expect(runSportsDataImporterMock).toHaveBeenCalledTimes(1)
    expect(runSportsDataImporterMock).toHaveBeenCalledWith({ sports: ['NFL'] })

    resolveImport({ imported: 5, sports: ['NFL'], staleFallbackApplied: false })
    await Promise.resolve()
    await Promise.resolve()
  })

  it('does not let one sport block or dedupe against another sport', async () => {
    runSportsDataImporterMock.mockResolvedValue({ imported: 1, sports: [], staleFallbackApplied: false })

    const { requestPlayerImportRefresh } = await loadCoordinator()

    requestPlayerImportRefresh('NFL', 'get_player_miss')
    requestPlayerImportRefresh('NBA', 'get_player_miss')

    expect(runSportsDataImporterMock).toHaveBeenCalledTimes(2)
    expect(runSportsDataImporterMock).toHaveBeenCalledWith({ sports: ['NFL'] })
    expect(runSportsDataImporterMock).toHaveBeenCalledWith({ sports: ['NBA'] })
  })

  it('clears in-flight state after success and allows a later call to start a new import', async () => {
    runSportsDataImporterMock.mockResolvedValue({ imported: 1, sports: [], staleFallbackApplied: false })

    const { requestPlayerImportRefresh } = await loadCoordinator()

    requestPlayerImportRefresh('NFL', 'get_player_miss')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(runSportsDataImporterMock).toHaveBeenCalledTimes(1)
  })

  it('clears in-flight state after failure without permanently poisoning future refreshes', async () => {
    vi.useFakeTimers()
    try {
      runSportsDataImporterMock.mockRejectedValueOnce(new Error('provider unreachable'))
      runSportsDataImporterMock.mockResolvedValueOnce({ imported: 3, sports: [], staleFallbackApplied: false })

      const { requestPlayerImportRefresh, REFRESH_COOLDOWN_MS } = await loadCoordinator()

      requestPlayerImportRefresh('NFL', 'get_player_miss')
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)

      expect(runSportsDataImporterMock).toHaveBeenCalledTimes(1)

      // still within cooldown: must not retry yet
      await vi.advanceTimersByTimeAsync(REFRESH_COOLDOWN_MS - 1000)
      requestPlayerImportRefresh('NFL', 'get_player_miss')
      expect(runSportsDataImporterMock).toHaveBeenCalledTimes(1)

      // cooldown expired: retry is now allowed
      await vi.advanceTimersByTimeAsync(2000)
      requestPlayerImportRefresh('NFL', 'get_player_miss')
      expect(runSportsDataImporterMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('suppresses repeated misses within the cooldown window after a completed attempt', async () => {
    vi.useFakeTimers()
    try {
      runSportsDataImporterMock.mockResolvedValue({ imported: 0, sports: [], staleFallbackApplied: false })

      const { requestPlayerImportRefresh, REFRESH_COOLDOWN_MS } = await loadCoordinator()

      requestPlayerImportRefresh('MLB', 'search_players_miss')
      await vi.advanceTimersByTimeAsync(0)
      expect(runSportsDataImporterMock).toHaveBeenCalledTimes(1)

      requestPlayerImportRefresh('MLB', 'search_players_miss')
      requestPlayerImportRefresh('MLB', 'search_players_miss')
      expect(runSportsDataImporterMock).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(REFRESH_COOLDOWN_MS + 1)
      requestPlayerImportRefresh('MLB', 'search_players_miss')
      expect(runSportsDataImporterMock).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('never throws even when the importer rejects', async () => {
    runSportsDataImporterMock.mockRejectedValue(new Error('boom'))
    const { requestPlayerImportRefresh } = await loadCoordinator()

    expect(() => requestPlayerImportRefresh('NHL', 'get_player_miss')).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
  })

  it('accepts get_players_by_team_miss as a trigger source on the same sport-keyed state', async () => {
    runSportsDataImporterMock.mockResolvedValue({ imported: 1, sports: [], staleFallbackApplied: false })
    const { requestPlayerImportRefresh } = await loadCoordinator()

    requestPlayerImportRefresh('NFL', 'get_players_by_team_miss')
    requestPlayerImportRefresh('NFL', 'get_player_miss')

    expect(runSportsDataImporterMock).toHaveBeenCalledTimes(1)
  })

  describe('requestPlayerNewsRefresh', () => {
    it('starts exactly one runNewsImporter execution for concurrent misses', async () => {
      let resolveImport!: (value: { imported: number; sports: string[] }) => void
      runNewsImporterMock.mockReturnValue(
        new Promise((resolve) => {
          resolveImport = resolve
        })
      )

      const { requestPlayerNewsRefresh } = await loadCoordinator()

      requestPlayerNewsRefresh('get_player_news_miss')
      requestPlayerNewsRefresh('get_player_news_miss')
      requestPlayerNewsRefresh('get_player_news_miss')

      expect(runNewsImporterMock).toHaveBeenCalledTimes(1)
      expect(runNewsImporterMock).toHaveBeenCalledWith()

      resolveImport({ imported: 2, sports: [] })
      await Promise.resolve()
      await Promise.resolve()
    })

    it('is deduped separately from the player-data sport-keyed state', async () => {
      runSportsDataImporterMock.mockResolvedValue({ imported: 1, sports: [], staleFallbackApplied: false })
      runNewsImporterMock.mockResolvedValue({ imported: 1, sports: [] })

      const { requestPlayerImportRefresh, requestPlayerNewsRefresh } = await loadCoordinator()

      requestPlayerImportRefresh('NFL', 'get_player_miss')
      requestPlayerNewsRefresh('get_player_news_miss')

      expect(runSportsDataImporterMock).toHaveBeenCalledTimes(1)
      expect(runNewsImporterMock).toHaveBeenCalledTimes(1)
    })

    it('clears in-flight state after failure without permanently poisoning future refreshes', async () => {
      vi.useFakeTimers()
      try {
        runNewsImporterMock.mockRejectedValueOnce(new Error('news provider unreachable'))
        runNewsImporterMock.mockResolvedValueOnce({ imported: 4, sports: [] })

        const { requestPlayerNewsRefresh, NEWS_REFRESH_COOLDOWN_MS } = await loadCoordinator()

        requestPlayerNewsRefresh('get_player_news_miss')
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(0)
        expect(runNewsImporterMock).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(NEWS_REFRESH_COOLDOWN_MS - 1000)
        requestPlayerNewsRefresh('get_player_news_miss')
        expect(runNewsImporterMock).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(2000)
        requestPlayerNewsRefresh('get_player_news_miss')
        expect(runNewsImporterMock).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('never throws even when the news importer rejects', async () => {
      runNewsImporterMock.mockRejectedValue(new Error('boom'))
      const { requestPlayerNewsRefresh } = await loadCoordinator()

      expect(() => requestPlayerNewsRefresh('get_player_news_miss')).not.toThrow()
      await Promise.resolve()
      await Promise.resolve()
    })
  })

  describe('requestSportNewsRefresh (Phase 24)', () => {
    it('starts exactly one runNewsImporter execution for concurrent same-sport misses', async () => {
      let resolveImport!: (value: { imported: number; sports: string[] }) => void
      runNewsImporterMock.mockReturnValue(
        new Promise((resolve) => {
          resolveImport = resolve
        })
      )

      const { requestSportNewsRefresh } = await loadCoordinator()

      requestSportNewsRefresh('NFL', 'get_latest_news_miss')
      requestSportNewsRefresh('NFL', 'get_high_impact_news_miss')

      expect(runNewsImporterMock).toHaveBeenCalledTimes(1)
      expect(runNewsImporterMock).toHaveBeenCalledWith({ sports: ['NFL'] })

      resolveImport({ imported: 3, sports: ['NFL'] })
      await Promise.resolve()
      await Promise.resolve()
    })

    it('does not let one sport block or dedupe against another sport', async () => {
      runNewsImporterMock.mockResolvedValue({ imported: 1, sports: [] })
      const { requestSportNewsRefresh } = await loadCoordinator()

      requestSportNewsRefresh('NFL', 'get_latest_news_miss')
      requestSportNewsRefresh('NBA', 'get_latest_news_miss')

      expect(runNewsImporterMock).toHaveBeenCalledTimes(2)
      expect(runNewsImporterMock).toHaveBeenCalledWith({ sports: ['NFL'] })
      expect(runNewsImporterMock).toHaveBeenCalledWith({ sports: ['NBA'] })
    })

    it('is keyed separately from the all-sports getPlayerNews state', async () => {
      runNewsImporterMock.mockResolvedValue({ imported: 1, sports: [] })
      const { requestSportNewsRefresh, requestPlayerNewsRefresh } = await loadCoordinator()

      requestSportNewsRefresh('NFL', 'get_latest_news_miss')
      requestPlayerNewsRefresh('get_player_news_miss')

      expect(runNewsImporterMock).toHaveBeenCalledTimes(2)
      expect(runNewsImporterMock).toHaveBeenCalledWith({ sports: ['NFL'] })
      expect(runNewsImporterMock).toHaveBeenCalledWith()
    })

    it('clears in-flight state after failure without permanently poisoning future refreshes', async () => {
      vi.useFakeTimers()
      try {
        runNewsImporterMock.mockRejectedValueOnce(new Error('news provider unreachable'))
        runNewsImporterMock.mockResolvedValueOnce({ imported: 2, sports: ['NFL'] })

        const { requestSportNewsRefresh, NEWS_REFRESH_COOLDOWN_MS } = await loadCoordinator()

        requestSportNewsRefresh('NFL', 'get_latest_news_miss')
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(0)
        expect(runNewsImporterMock).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(NEWS_REFRESH_COOLDOWN_MS - 1000)
        requestSportNewsRefresh('NFL', 'get_latest_news_miss')
        expect(runNewsImporterMock).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(2000)
        requestSportNewsRefresh('NFL', 'get_latest_news_miss')
        expect(runNewsImporterMock).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

    it('never throws even when the importer rejects', async () => {
      runNewsImporterMock.mockRejectedValue(new Error('boom'))
      const { requestSportNewsRefresh } = await loadCoordinator()

      expect(() => requestSportNewsRefresh('NHL', 'get_high_impact_news_miss')).not.toThrow()
      await Promise.resolve()
      await Promise.resolve()
    })
  })
})
