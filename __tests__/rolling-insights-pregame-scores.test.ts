import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Rolling Insights sends `home_score: 0` before kickoff, exactly like ESPN does.
 * The ESPN branch of this module already guarded against that and said so in a
 * comment; the RI branch never got the same treatment, so it stamped a 0-0 onto
 * games nobody had played.
 *
 * Measured on production 2026-08-28: 100 future `rolling_insights` rows holding
 * a 0-0 result, against 285 correctly NULL. CFBD and TheSportsDB were clean
 * across 3,624 and 3,952 future rows respectively — this was RI alone.
 *
 * A 0-0 is a RESULT. NULL is "not played yet". Collapsing them is what makes a
 * scoreboard confidently wrong instead of honestly empty.
 */
const ORIGINAL_ENV = { ...process.env }

function riResponse(rows: unknown[]): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ data: { NFL: rows } }),
    text: async () => JSON.stringify({ data: { NFL: rows } }),
    headers: new Map(),
  } as unknown as Response
}

const game = (over: Record<string, unknown>) => ({
  game_ID: 'g1',
  home_team: 'BUF',
  away_team: 'PIT',
  game_time: 'Thu, 27 Aug 2026 23:00:00 GMT',
  season: '2026-2027',
  season_type: 'Preseason',
  week: 3,
  home_score: 0,
  away_score: 0,
  ...over,
})

describe('Rolling Insights pregame scores', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.ROLLING_INSIGHTS_RSC_TOKEN = 'test-token'
    process.env.ROLLING_INSIGHTS_REST_BASE_URL = 'https://ri.test'
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does NOT record 0-0 for a game that has not kicked off', async () => {
    fetchMock.mockResolvedValue(riResponse([game({ status: 'scheduled' })]))
    const { fetchRollingInsightsNflGames } = await import('@/lib/scores/gameScoreProviders')
    const result = await fetchRollingInsightsNflGames()

    const row = result.games?.find((g) => g.externalId === 'g1')
    expect(row, 'the scheduled game was not parsed at all').toBeTruthy()
    expect(row?.homeScore, 'invented a 0-0 for an unplayed game').toBeNull()
    expect(row?.awayScore).toBeNull()
  })

  it('keeps a real score once the game is in progress', async () => {
    fetchMock.mockResolvedValue(
      riResponse([game({ status: 'inprogress', home_score: 3, away_score: 14 })]),
    )
    const { fetchRollingInsightsNflGames } = await import('@/lib/scores/gameScoreProviders')
    const result = await fetchRollingInsightsNflGames()

    const row = result.games?.find((g) => g.externalId === 'g1')
    expect(row?.homeScore).toBe(3)
    expect(row?.awayScore).toBe(14)
  })

  it('keeps a genuine 0-0 when the game actually finished 0-0', async () => {
    // The gate must key on STATE, not on the number. A real scoreless final is
    // rare but legal, and nulling it would be the same class of error inverted.
    fetchMock.mockResolvedValue(riResponse([game({ status: 'final' })]))
    const { fetchRollingInsightsNflGames } = await import('@/lib/scores/gameScoreProviders')
    const result = await fetchRollingInsightsNflGames()

    const row = result.games?.find((g) => g.externalId === 'g1')
    expect(row?.homeScore).toBe(0)
    expect(row?.awayScore).toBe(0)
  })

  it('stays NULL when the status is unreadable, rather than guessing', async () => {
    // With `status` absent the parser falls back to `season_type` ("Preseason"),
    // which normalizes to nothing. Unknown state must not mint a result.
    fetchMock.mockResolvedValue(riResponse([game({ status: undefined })]))
    const { fetchRollingInsightsNflGames } = await import('@/lib/scores/gameScoreProviders')
    const result = await fetchRollingInsightsNflGames()

    const row = result.games?.find((g) => g.externalId === 'g1')
    expect(row?.homeScore).toBeNull()
    expect(row?.awayScore).toBeNull()
  })
})
