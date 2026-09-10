// @vitest-environment node
/**
 * lib/api-sports.ts — syncAPISportsGameOddsToDb.
 *
 * The writer was the untested half of the odds feature: every existing odds test
 * covered the pure parser or the DB-first read layer, and nothing exercised the
 * only component that talks to the provider AND writes `game_odds`.
 *
 * What is pinned here, all of it behaviour a silent regression could break:
 *   - the game-selection window (sport, source, forward horizon, lookback)
 *   - the `maxGames` cap
 *   - one upserted row per bookmaker, on the composite key
 *   - `retainPrimaryMarkets` actually applied to `raw` (the product boundary:
 *     a book's prop board must never be warehoused)
 *   - per-game error isolation — one failing fetch must not abandon the run
 *   - the unrecognizedBets diagnostic reaching the summary
 *
 * Provider access is stubbed at `global.fetch`, so the real request-building,
 * envelope-unwrapping and normalization all execute. Prisma is mocked; if that
 * mock ever failed to intercept, `vitest.setup.db-guard.ts` pins DATABASE_URL at
 * 127.0.0.1:1 and the test would fail loudly rather than reach a database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const sportsGameFindMany = vi.fn()
const gameOddsUpsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsGame: { findMany: (...a: unknown[]) => sportsGameFindMany(...a) },
    gameOdds: { upsert: (...a: unknown[]) => gameOddsUpsert(...a) },
  },
}))

vi.mock('@/lib/workers/rate-limit-manager', () => ({
  rateLimitManager: {
    canCall: async () => true,
    recordCall: async () => {},
    getFallback: async () => null,
  },
}))

const { syncAPISportsGameOddsToDb } = await import('@/lib/api-sports')

/** A bookmaker payload carrying the three primaries plus a prop board. */
function bookmakerPayload() {
  return {
    id: 8,
    name: 'Bet365',
    bets: [
      { id: 1, name: 'Home/Away', values: [
        { value: 'Home', odd: '1.65' },
        { value: 'Away', odd: '2.35' },
      ] },
      { id: 2, name: 'Asian Handicap', values: [{ value: 'Home -3.5', odd: '1.91' }] },
      { id: 3, name: 'Over/Under', values: [
        { value: 'Over 45.5', odd: '1.90' },
        { value: 'Under 45.5', odd: '1.90' },
      ] },
      { id: 47, name: 'Anytime Goal Scorer', values: [{ value: 'Someone', odd: '2.5' }] },
      { id: 95, name: 'Player Interceptions', values: [{ value: 'Over 0.5', odd: '3.0' }] },
    ],
  }
}

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => body,
  }
}

function game(over: Record<string, unknown> = {}) {
  return {
    externalId: '7532',
    homeTeam: 'KC',
    awayTeam: 'DEN',
    season: 2026,
    week: 1,
    seasonType: 'regular',
    startTime: new Date(Date.now() + 2 * 24 * 3600 * 1000),
    status: 'NS',
    ...over,
  }
}

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  sportsGameFindMany.mockReset()
  gameOddsUpsert.mockReset()
  gameOddsUpsert.mockResolvedValue({})
  process.env.API_SPORTS_KEY = 'test-key-not-a-real-secret'
  fetchSpy = vi.fn(async () => okResponse({ response: [{ bookmakers: [bookmakerPayload()] }], errors: {} }))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('game selection', () => {
  it('queries only this sport, only api_sports rows, within a bounded window', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    const where = sportsGameFindMany.mock.calls[0][0].where
    expect(where.sport).toBe('NFL')
    expect(where.source).toBe('api_sports')
    // Forward horizon and a backward lookback, both present and ordered.
    expect(where.startTime.gte).toBeInstanceOf(Date)
    expect(where.startTime.lte).toBeInstanceOf(Date)
    expect(where.startTime.gte.getTime()).toBeLessThan(where.startTime.lte.getTime())
  })

  it('honours the vendor 7-day pre-match window by default', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    const { gte, lte } = sportsGameFindMany.mock.calls[0][0].where.startTime
    const forwardDays = (lte.getTime() - Date.now()) / 86_400_000
    // Odds exist 1-7 days pre-match; a wider window spends calls on games with none.
    expect(forwardDays).toBeGreaterThan(6.5)
    expect(forwardDays).toBeLessThanOrEqual(7.5)
    expect(gte.getTime()).toBeLessThan(Date.now())
  })

  it('caps the slate with maxGames', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL', maxGames: 5 })
    expect(sportsGameFindMany.mock.calls[0][0].take).toBe(5)
  })

  it('returns without calling the provider when no games are in the window', async () => {
    sportsGameFindMany.mockResolvedValue([])
    const summary = await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(gameOddsUpsert).not.toHaveBeenCalled()
    expect(summary.gamesConsidered).toBe(0)
    expect(summary.rowsUpserted).toBe(0)
  })
})

describe('writing', () => {
  it('upserts one row per bookmaker on the composite key', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    const summary = await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    expect(gameOddsUpsert).toHaveBeenCalledTimes(1)
    const arg = gameOddsUpsert.mock.calls[0][0]
    expect(arg.where.uniq_game_odds_book).toEqual({
      sport: 'NFL',
      gameExternalId: '7532',
      source: 'api_sports',
      bookmakerId: 8,
    })
    expect(summary.rowsUpserted).toBe(1)
    expect(summary.gamesFetched).toBe(1)
  })

  it('stores the parsed forecast, including the derived implied totals', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    const data = gameOddsUpsert.mock.calls[0][0].create
    expect(data.spreadHome).toBe(-3.5)
    expect(data.totalPoints).toBe(45.5)
    // 45.5/2 -/+ 3.5/2 — the number a lineup decision actually reads.
    expect(data.impliedHomeTotal).toBeCloseTo(24.5, 5)
    expect(data.impliedAwayTotal).toBeCloseTo(21, 5)
    expect(data.homeWinProbability).toBeGreaterThan(0.5)
  })

  it('🛑 stores ONLY the three primary markets in raw — never the prop board', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    const raw = gameOddsUpsert.mock.calls[0][0].create.raw as { bets: Array<{ id: number; name: string }> }
    expect(raw.bets.map((b) => b.id).sort((a, b) => a - b)).toEqual([1, 2, 3])
    const names = raw.bets.map((b) => b.name)
    expect(names).not.toContain('Anytime Goal Scorer')
    expect(names).not.toContain('Player Interceptions')
  })

  it('CONTROL: the payload really did carry props, so the filter had work to do', async () => {
    // Without this, the assertion above would pass against a payload that never
    // held a prop — a guard that has never once removed anything.
    expect(bookmakerPayload().bets).toHaveLength(5)
  })

  it('carries the game’s own season/week onto the row', async () => {
    sportsGameFindMany.mockResolvedValue([game({ season: 2025, week: 9 })])
    await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    const data = gameOddsUpsert.mock.calls[0][0].create
    // The game's own season wins over the cron's parameter.
    expect(data.season).toBe(2025)
    expect(data.week).toBe(9)
  })
})

describe('failure isolation', () => {
  it('one failing game does not abandon the rest of the slate', async () => {
    sportsGameFindMany.mockResolvedValue([
      game({ externalId: 'bad' }),
      game({ externalId: 'good' }),
    ])
    fetchSpy.mockImplementation(async (url: string) => {
      if (String(url).includes('game=bad')) throw new Error('network reset')
      return okResponse({ response: [{ bookmakers: [bookmakerPayload()] }], errors: {} })
    })

    const summary = await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    expect(summary.endpointFailures).toBe(1)
    expect(summary.gamesFetched).toBe(1)
    expect(summary.rowsUpserted).toBe(1)
    expect(gameOddsUpsert.mock.calls[0][0].where.uniq_game_odds_book.gameExternalId).toBe('good')
  })

  it('an upsert failure is counted but does not abort the run', async () => {
    sportsGameFindMany.mockResolvedValue([game({ externalId: 'a' }), game({ externalId: 'b' })])
    gameOddsUpsert.mockRejectedValueOnce(new Error('unique violation')).mockResolvedValue({})

    const summary = await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    expect(gameOddsUpsert).toHaveBeenCalledTimes(2)
    expect(summary.rowsUpserted).toBe(1)
  })

  it('a provider payload with no bookmakers writes nothing and still succeeds', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    fetchSpy.mockResolvedValue(okResponse({ response: [], errors: {} }))

    const summary = await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })

    expect(summary.gamesFetched).toBe(1)
    expect(summary.rowsUpserted).toBe(0)
    expect(summary.endpointFailures).toBe(0)
  })
})

describe('the unrecognizedBets diagnostic reaches the summary', () => {
  it('reports bet names when a bookmaker yielded nothing usable', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    fetchSpy.mockResolvedValue(
      okResponse({
        response: [{ bookmakers: [{ id: 3, name: 'X', bets: [
          { id: 900, name: 'Some Renamed Market', values: [{ value: 'Home', odd: '1.9' }] },
        ] }] }],
        errors: {},
      }),
    )

    const summary = await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })
    expect(summary.unrecognizedBets).toContain('Some Renamed Market')
  })

  it('stays empty on a healthy payload', async () => {
    sportsGameFindMany.mockResolvedValue([game()])
    const summary = await syncAPISportsGameOddsToDb({ season: '2026', sport: 'NFL' })
    expect(summary.unrecognizedBets).toEqual([])
  })
})
