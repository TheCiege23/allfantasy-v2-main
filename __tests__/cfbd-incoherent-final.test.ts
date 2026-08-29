import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * A result claimed for a game nobody had played.
 *
 * Measured on production 2026-08-29: CFBD returned Delta State at Northeastern
 * State with `completed: true` and `homePoints: 52` against a NULL
 * `awayPoints`, on a game whose kickoff was four hours away. Across the whole
 * table it was the ONLY row claiming a final before kickoff, and the ONLY row
 * carrying a score for one side and not the other — so this is a bad vendor
 * row, not a systemic feed problem.
 *
 * Transcribing it faithfully is what would have made it visible: because
 * `dbRowToLiveScore` maps a null score to 0, the row renders as a finished
 * game won 52-0 by a team that has not taken the field.
 *
 * The rule is the same one this module already applies to a pregame 0-0. A
 * score is a pair. Half of one is not a result, and a completion we cannot
 * corroborate is not propagated.
 */
const ORIGINAL_ENV = { ...process.env }

function cfbdResponse(rows: unknown[]): Response {
  const text = JSON.stringify(rows)
  return {
    ok: true,
    status: 200,
    json: async () => rows,
    text: async () => text,
    headers: new Map(),
  } as unknown as Response
}

const game = (over: Record<string, unknown>) => ({
  id: 401906588,
  homeTeam: 'Northeastern State',
  awayTeam: 'Delta State',
  startDate: '2026-08-29T17:00:00.000Z',
  season: 2026,
  seasonType: 'regular',
  week: 1,
  completed: false,
  homePoints: null,
  awayPoints: null,
  ...over,
})

describe('CFBD finals', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...ORIGINAL_ENV }
    process.env.CFBD_KEY = 'test-key'
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('drops a completion claim that carries only one side of the score', async () => {
    fetchMock.mockResolvedValue(
      cfbdResponse([game({ completed: true, homePoints: 52, awayPoints: null })]),
    )
    const { fetchCfbdGames } = await import('@/lib/scores/gameScoreProviders')

    const { games } = await fetchCfbdGames(2026, 1)
    expect(games).toHaveLength(1)
    // Not 'final' — we cannot read a result off half a score.
    expect(games[0]!.status).toBe('scheduled')
    // And the half we DID get goes with it. Keeping 52 beside a null away score
    // is what renders as 52-0.
    expect(games[0]!.homeScore).toBeNull()
    expect(games[0]!.awayScore).toBeNull()
  })

  it('applies the same rule when the missing half is the home side', async () => {
    fetchMock.mockResolvedValue(
      cfbdResponse([game({ completed: true, homePoints: null, awayPoints: 31 })]),
    )
    const { fetchCfbdGames } = await import('@/lib/scores/gameScoreProviders')

    const { games } = await fetchCfbdGames(2026, 1)
    expect(games[0]!.status).toBe('scheduled')
    expect(games[0]!.awayScore).toBeNull()
  })

  it('still carries a real final through untouched', async () => {
    // POSITIVE CONTROL. A guard that rejects every final would pass the two
    // tests above and silently empty the scoreboard.
    fetchMock.mockResolvedValue(
      cfbdResponse([game({ completed: true, homePoints: 52, awayPoints: 17 })]),
    )
    const { fetchCfbdGames } = await import('@/lib/scores/gameScoreProviders')

    const { games } = await fetchCfbdGames(2026, 1)
    expect(games[0]!.status).toBe('final')
    expect(games[0]!.homeScore).toBe(52)
    expect(games[0]!.awayScore).toBe(17)
  })

  it('reads a 0-0 final as the real result it is', async () => {
    // The mirror of the pregame rule: 0 is a legitimate score once a game has
    // been played, and this guard must not confuse "zero" with "absent".
    fetchMock.mockResolvedValue(
      cfbdResponse([game({ completed: true, homePoints: 0, awayPoints: 0 })]),
    )
    const { fetchCfbdGames } = await import('@/lib/scores/gameScoreProviders')

    const { games } = await fetchCfbdGames(2026, 1)
    expect(games[0]!.status).toBe('final')
    expect(games[0]!.homeScore).toBe(0)
  })

  it('leaves an unplayed fixture with no score at all', async () => {
    fetchMock.mockResolvedValue(cfbdResponse([game({})]))
    const { fetchCfbdGames } = await import('@/lib/scores/gameScoreProviders')

    const { games } = await fetchCfbdGames(2026, 1)
    expect(games[0]!.status).toBe('scheduled')
    expect(games[0]!.homeScore).toBeNull()
  })
})
