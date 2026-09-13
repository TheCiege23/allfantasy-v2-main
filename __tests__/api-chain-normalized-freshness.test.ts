import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The normalized-table fast path in `lib/workers/api-chain.ts`.
 *
 * Before the change these tests cover, that path had no freshness gate, no
 * request scoping beyond `season`, did not select the score columns at all, and
 * its caller stamped a literal `cacheAge: 0` on whatever came back. Each test
 * below is written so that it FAILS against that earlier behaviour — a green
 * run here is only evidence if the red run existed, and the pre-fix reader
 * would have failed every one of them.
 */

vi.mock('server-only', () => ({}))

const sportsGameFindMany = vi.fn()
const sportsPlayerFindMany = vi.fn()
const sportsInjuryFindMany = vi.fn()
const cacheFindUnique = vi.fn()
const cacheFindFirst = vi.fn()
const cacheUpsert = vi.fn()

const rollingInsightsProviderMock = vi.fn()
const theSportsDbSupportsMock = vi.fn()
const theSportsDbFetchMock = vi.fn()
const apiSportsSupportsMock = vi.fn()
const apiSportsFetchMock = vi.fn()
const clearSportsSupportsMock = vi.fn()
const clearSportsFetchMock = vi.fn()
const cfbdSupportsMock = vi.fn()
const cfbdFetchMock = vi.fn()
const sleeperSupportsMock = vi.fn()
const sleeperFetchMock = vi.fn()
const espnSupportsMock = vi.fn()
const espnFetchMock = vi.fn()
const persistNormalizedSportsRowsMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsDataCache: {
      findFirst: cacheFindFirst,
      findUnique: cacheFindUnique,
      upsert: cacheUpsert,
    },
    sportsGame: { findMany: sportsGameFindMany },
    sportsPlayer: { findMany: sportsPlayerFindMany },
    sportsInjury: { findMany: sportsInjuryFindMany },
  },
}))

vi.mock('@/lib/workers/providers/rolling-insights', () => ({
  rollingInsightsProvider: rollingInsightsProviderMock,
}))
vi.mock('@/lib/workers/providers/thesportsdb', () => ({
  theSportsDbProvider: { name: 'thesportsdb', supports: theSportsDbSupportsMock, fetch: theSportsDbFetchMock },
}))
vi.mock('@/lib/workers/providers/api-sports', () => ({
  apiSportsProvider: { name: 'api_sports', supports: apiSportsSupportsMock, fetch: apiSportsFetchMock },
}))
vi.mock('@/lib/workers/providers/clearsports', () => ({
  clearSportsProvider: { name: 'clearsports', supports: clearSportsSupportsMock, fetch: clearSportsFetchMock },
}))
vi.mock('@/lib/workers/providers/cfbd', () => ({
  cfbdProvider: { name: 'cfbd', supports: cfbdSupportsMock, fetch: cfbdFetchMock },
}))
vi.mock('@/lib/workers/providers/sleeper-chain', () => ({
  sleeperChainProvider: { name: 'sleeper', supports: sleeperSupportsMock, fetch: sleeperFetchMock },
}))
vi.mock('@/lib/workers/providers/espn', () => ({
  espnProvider: { name: 'espn', supports: espnSupportsMock, fetch: espnFetchMock },
}))
vi.mock('@/lib/workers/sports-cache-persist', () => ({
  persistNormalizedSportsRows: persistNormalizedSportsRowsMock,
}))

const HOUR = 60 * 60 * 1000

type GameRow = {
  externalId: string
  homeTeam: string
  awayTeam: string
  homeScore: number | null
  awayScore: number | null
  status: string | null
  startTime: Date | null
  venue: string | null
  week: number | null
  seasonType: string | null
  season: number | null
  source: string | null
  fetchedAt: Date | null
  expiresAt: Date
}

function game(over: Partial<GameRow> & { externalId: string }): GameRow {
  return {
    homeTeam: 'PIT',
    awayTeam: 'GB',
    homeScore: null,
    awayScore: null,
    status: 'scheduled',
    startTime: new Date('2026-09-07T17:00:00Z'),
    venue: 'Acrisure',
    week: 1,
    seasonType: 'regular',
    season: 2026,
    source: 'rolling_insights',
    fetchedAt: new Date(),
    expiresAt: new Date(Date.now() + 12 * HOUR),
    ...over,
  }
}

/**
 * Applies the subset of the `where` clause these tests exercise, so an
 * assertion describes what the reader RETURNS rather than the shape of the
 * query object it happened to build.
 */
function fakeFindMany(rows: GameRow[]) {
  return async (args: Record<string, unknown>) => {
    const where = (args.where ?? {}) as Record<string, unknown>
    const take = typeof args.take === 'number' ? args.take : rows.length
    const expires = where.expiresAt as { gt?: Date } | undefined
    return rows
      .filter((r) => (expires?.gt ? r.expiresAt.getTime() > expires.gt.getTime() : true))
      .filter((r) => (where.season == null ? true : r.season === where.season))
      .filter((r) => (where.week == null ? true : r.week === where.week))
      .filter((r) => (where.seasonType == null ? true : r.seasonType === where.seasonType))
      .slice(0, take)
  }
}

describe('api-chain normalized reader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cacheFindFirst.mockResolvedValue(null)
    cacheFindUnique.mockResolvedValue(null)
    cacheUpsert.mockResolvedValue({})
    persistNormalizedSportsRowsMock.mockResolvedValue(undefined)
    sportsPlayerFindMany.mockResolvedValue([])
    sportsInjuryFindMany.mockResolvedValue([])
    sportsGameFindMany.mockResolvedValue([])
    rollingInsightsProviderMock.mockResolvedValue({
      data: null,
      fromCache: false,
      source: 'rolling_insights',
      latency: 0,
    })
    for (const s of [
      theSportsDbSupportsMock,
      apiSportsSupportsMock,
      clearSportsSupportsMock,
      cfbdSupportsMock,
      sleeperSupportsMock,
      espnSupportsMock,
    ]) {
      s.mockReturnValue(false)
    }
    for (const f of [
      theSportsDbFetchMock,
      apiSportsFetchMock,
      clearSportsFetchMock,
      cfbdFetchMock,
      sleeperFetchMock,
      espnFetchMock,
    ]) {
      f.mockResolvedValue(null)
    }
  })

  afterEach(() => {
    vi.resetModules()
  })

  it('does not serve rows whose expiresAt has passed, and asks a provider instead', async () => {
    const stale = game({
      externalId: 'g-stale',
      homeScore: 28,
      awayScore: 9,
      status: 'final',
      expiresAt: new Date(Date.now() - HOUR),
      fetchedAt: new Date(Date.now() - 40 * 24 * HOUR),
    })
    sportsGameFindMany.mockImplementation(fakeFindMany([stale]))

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'scores',
      query: { season: 2026 },
    })

    // The pre-fix reader returned this row regardless of age.
    expect(result.fromCache).toBe(false)
    expect(rollingInsightsProviderMock).toHaveBeenCalledTimes(1)
  })

  it('reports a measured cacheAge rather than a hardcoded zero', async () => {
    const row = game({
      externalId: 'g-fresh',
      homeScore: 14,
      awayScore: 3,
      status: 'in_progress',
      fetchedAt: new Date(Date.now() - 2 * HOUR),
    })
    sportsGameFindMany.mockImplementation(fakeFindMany([row]))

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'scores',
      query: { season: 2026 },
    })

    expect(result.fromCache).toBe(true)
    // Pre-fix this was literally 0 for every normalized read.
    expect(result.cacheAge).toBeGreaterThan(7100)
    expect(result.cacheAge).toBeLessThan(7300)
  })

  it('returns the score columns it stores', async () => {
    const row = game({
      externalId: 'g-scored',
      homeScore: 28,
      awayScore: 9,
      status: 'final',
    })
    sportsGameFindMany.mockImplementation(fakeFindMany([row]))

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'scores',
      query: { season: 2026 },
    })

    const games = result.data as Array<Record<string, unknown>>
    expect(games).toHaveLength(1)
    // Pre-fix the select omitted these, so they were absent entirely.
    expect(games[0]!.homeScore).toBe(28)
    expect(games[0]!.awayScore).toBe(9)
    expect(games[0]!.week).toBe(1)
    expect(games[0]!.seasonType).toBe('regular')
  })

  it('refuses to answer a scores request with schedule rows that carry no score', async () => {
    const scheduleOnly = game({ externalId: 'g-noscore', homeScore: null, awayScore: null })
    sportsGameFindMany.mockImplementation(fakeFindMany([scheduleOnly]))

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'scores',
      query: { season: 2026 },
    })

    // This is the production bug: a scoreless schedule row satisfied `scores`.
    expect(result.fromCache).toBe(false)
    expect(rollingInsightsProviderMock).toHaveBeenCalledTimes(1)
  })

  it('still serves a schedule request from scoreless rows', async () => {
    const scheduleOnly = game({ externalId: 'g-sched', homeScore: null, awayScore: null })
    sportsGameFindMany.mockImplementation(fakeFindMany([scheduleOnly]))

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'schedule',
      query: { season: 2026 },
    })

    expect(result.fromCache).toBe(true)
    expect(rollingInsightsProviderMock).not.toHaveBeenCalled()
  })

  /*
   * A scores question reads only the ranked live feeds (LIVE_SCORE_SOURCES); a schedule question
   * is deliberately unfiltered, because `cfbd` is the broadest schedule feed.
   *
   * ⚠ WHY `cfbd` IS THE FRESHER FEED IN BOTH TESTS. `cfbd` is unranked, and pickFreshestSourceRows
   * lets an unranked feed win only by being in a fresher 5-minute bucket than every ranked one. If
   * both feeds were equally fresh, TheSportsDB would win on rank with or without the filter, and
   * these tests would pass with the filter deleted — which is exactly how the first version of the
   * change had no coverage for this line at all (a mutation removing it left 17/17 green).
   *
   * The shared `fakeFindMany` does not apply `source`, so this wraps it rather than editing it:
   * the other tests in this file keep exactly the fake they were written against.
   */
  function sourceAwareFindMany(rows: GameRow[]) {
    return async (args: Record<string, unknown>) => {
      const where = (args.where ?? {}) as Record<string, unknown>
      const allowed = (where.source as { in?: string[] } | undefined)?.in
      const visible = allowed ? rows.filter((r) => allowed.includes(String(r.source))) : rows
      return fakeFindMany(visible)(args)
    }
  }

  const cfbdFreshButUnranked = () =>
    game({ externalId: 'g-cfbd', source: 'cfbd', homeScore: 99, awayScore: 98, status: 'final', fetchedAt: new Date() })
  const tsdbRankedButOlder = () =>
    game({
      externalId: 'g-tsdb',
      source: 'thesportsdb',
      homeScore: 28,
      awayScore: 9,
      status: 'final',
      fetchedAt: new Date(Date.now() - 20 * 60 * 1000),
    })

  it('answers a scores request from ranked live feeds only, even when an unranked feed is fresher', async () => {
    sportsGameFindMany.mockImplementation(sourceAwareFindMany([cfbdFreshButUnranked(), tsdbRankedButOlder()]))

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({ sport: 'nfl', dataType: 'scores', query: { season: 2026 } })

    const games = result.data as Array<Record<string, unknown>>
    expect(result.fromCache).toBe(true)
    expect(games).toHaveLength(1)
    expect(games[0]!.homeScore).toBe(28)
    expect(games[0]!.awayScore).toBe(9)
  })

  it('does not filter a schedule request, so the broadest schedule feed can still answer it', async () => {
    sportsGameFindMany.mockImplementation(sourceAwareFindMany([cfbdFreshButUnranked(), tsdbRankedButOlder()]))

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({ sport: 'nfl', dataType: 'schedule', query: { season: 2026 } })

    const games = result.data as Array<Record<string, unknown>>
    expect(result.fromCache).toBe(true)
    expect(games).toHaveLength(1)
    expect(games[0]!.homeScore).toBe(99)
  })

  it('returns one row per fixture when several feeds hold the same game', async () => {
    const fresh = Date.now()
    sportsGameFindMany.mockImplementation(
      fakeFindMany([
        game({
          externalId: 'g-1',
          source: 'rolling_insights',
          homeScore: null,
          awayScore: null,
          fetchedAt: new Date(fresh),
        }),
        game({
          externalId: 'g-1',
          source: 'espn',
          homeScore: 28,
          awayScore: 9,
          status: 'final',
          fetchedAt: new Date(fresh),
        }),
      ])
    )

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'scores',
      query: { season: 2026 },
    })

    const games = result.data as Array<Record<string, unknown>>
    // Un-deduped, this fixture appeared twice — once scored, once not.
    expect(games).toHaveLength(1)
    // espn outranks rolling_insights at equal freshness, and carries the score.
    expect(games[0]!.homeScore).toBe(28)
  })

  it('still returns a full page after a dedup that discards a whole feed', async () => {
    /*
     * The dedup drops every row from the losing source, so reading exactly
     * `limit` rows out of the database and then deduping would hand back a
     * fraction of what was asked for. Here two feeds each hold 5 fixtures and
     * the caller wants 5.
     */
    const fresh = Date.now()
    const rows = [
      ...Array.from({ length: 5 }, (_, i) =>
        game({ externalId: `ri-${i}`, source: 'rolling_insights', fetchedAt: new Date(fresh), homeScore: 3, awayScore: 0 })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        game({ externalId: `espn-${i}`, source: 'espn', fetchedAt: new Date(fresh), homeScore: 7, awayScore: 0 })
      ),
    ]
    sportsGameFindMany.mockImplementation(fakeFindMany(rows))

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'scores',
      query: { season: 2026, limit: 5 },
    })

    const games = result.data as Array<Record<string, unknown>>
    expect(games).toHaveLength(5)
    // One feed's worth, not a blend of the two.
    expect(new Set(games.map((g) => String(g.gameId).split('-')[0])).size).toBe(1)
  })

  it('scopes by week instead of returning the whole season', async () => {
    sportsGameFindMany.mockImplementation(
      fakeFindMany([
        game({ externalId: 'wk1', week: 1, homeScore: 28, awayScore: 9 }),
        game({ externalId: 'wk2', week: 2, homeScore: 17, awayScore: 13 }),
        game({ externalId: 'wk3', week: 3, homeScore: 21, awayScore: 20 }),
      ])
    )

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'scores',
      query: { season: 2026, week: 2 },
    })

    const games = result.data as Array<Record<string, unknown>>
    expect(games).toHaveLength(1)
    expect(games[0]!.gameId).toBe('wk2')
  })

  it('declines the fast path for a narrowing dimension it cannot apply', async () => {
    sportsGameFindMany.mockImplementation(
      fakeFindMany([game({ externalId: 'g-any', homeScore: 28, awayScore: 9 })])
    )

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    const result = await fetchWithChain({
      sport: 'nfl',
      dataType: 'scores',
      query: { season: 2026, date: '2026-09-07' },
    })

    // A date the reader cannot honour must not be answered with the season.
    expect(result.fromCache).toBe(false)
    expect(sportsGameFindMany).not.toHaveBeenCalled()
    expect(rollingInsightsProviderMock).toHaveBeenCalledTimes(1)
  })

  /*
   * ⚠ ASSERT OUTSIDE THE MOCK, NOT INSIDE IT.
   *
   * The first version of this test put `expect(where.expiresAt).toBeDefined()`
   * in the mock body. `readFromNormalizedTables` is called inside a try/catch
   * in `fetchWithChain`, which swallowed the assertion error and logged it —
   * so the test passed against the pre-fix reader that had no gate at all. It
   * was the only one of the nine that survived the pre-fix control run, which
   * is the only reason it was caught. Capture, then assert.
   */
  it('applies the freshness gate to players too', async () => {
    const seen: Array<Record<string, unknown>> = []
    sportsPlayerFindMany.mockImplementation(async (args: Record<string, unknown>) => {
      seen.push((args.where ?? {}) as Record<string, unknown>)
      return []
    })

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    await fetchWithChain({ sport: 'nfl', dataType: 'players' })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.expiresAt).toMatchObject({ gt: expect.any(Date) })
  })

  it('applies the freshness gate to injuries too', async () => {
    const seen: Array<Record<string, unknown>> = []
    sportsInjuryFindMany.mockImplementation(async (args: Record<string, unknown>) => {
      seen.push((args.where ?? {}) as Record<string, unknown>)
      return []
    })

    const { fetchWithChain } = await import('@/lib/workers/api-chain')
    await fetchWithChain({ sport: 'nfl', dataType: 'injuries', query: { season: 2026, week: 3 } })

    expect(seen).toHaveLength(1)
    expect(seen[0]!.expiresAt).toMatchObject({ gt: expect.any(Date) })
    // Pre-fix an injuries read was scoped by sport alone.
    expect(seen[0]!.season).toBe(2026)
    expect(seen[0]!.week).toBe(3)
  })
})
