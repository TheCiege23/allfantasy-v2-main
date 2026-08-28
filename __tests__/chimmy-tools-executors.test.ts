import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  standings: vi.fn(),
  h2h: vi.fn(),
  upcoming: vi.fn(),
  leaders: vi.fn(),
}))

vi.mock('@/lib/chimmy/leagueStandingsGrounding', () => ({
  buildLeagueStandingsContext: h.standings,
}))
vi.mock('@/lib/chimmy/headToHeadGrounding', () => ({ buildHeadToHeadGrounding: h.h2h }))
vi.mock('@/lib/ai/upcomingGames', () => ({ findUpcomingGames: h.upcoming }))
vi.mock('@/lib/live/playerStatLeaders', async () => {
  const actual = await vi.importActual<typeof import('@/lib/live/playerStatLeaders')>(
    '@/lib/live/playerStatLeaders',
  )
  return { ...actual, readStatLeaders: h.leaders }
})

import { CHIMMY_TOOL_SPECS, executeChimmyTool } from '@/lib/chimmy/tools/chimmyTools'

const CTX = { leagueId: 'l1', userId: 'u1' }

beforeEach(() => {
  vi.clearAllMocks()
  h.standings.mockResolvedValue('STANDINGS: 1. Casey 3-0')
  h.h2h.mockResolvedValue({ text: 'HEAD-TO-HEAD: Casey leads Jordan 3-1' })
  h.upcoming.mockResolvedValue({ games: [] })
  h.leaders.mockResolvedValue({ leaders: [], eventsScanned: 0 })
})

describe('tool specs', () => {
  /* A model that can name a league id can name somebody else's. */
  it('never lets the model choose the league', () => {
    const json = JSON.stringify(CHIMMY_TOOL_SPECS)
    expect(json).not.toContain('leagueId')
    expect(json).not.toContain('userId')
  })

  it('exposes only read-only lookups', () => {
    const names = CHIMMY_TOOL_SPECS.map((t) => t.function.name)
    expect(names).toEqual([
      /*
       * ⚠ ADDED WHEN THE TOOL WAS. This list is hardcoded and ordered, so
       * shipping `find_league_by_name` turned it red — the assertion's job is to
       * make a new tool a deliberate edit, and that worked exactly as intended.
       * It stays a literal list on purpose: deriving it from CHIMMY_TOOL_SPECS
       * would assert the specs against themselves and could never catch a
       * write-capable tool being added.
       */
      'find_league_by_name',
      /*
       * Reads the user's OWN team, resolved through LeagueTeam.claimedByUserId
       * from the session — no id crosses the model boundary. Read-only, and it
       * returns roster facts with no projections attached.
       */
      'get_my_roster',
      'get_league_standings',
      'get_head_to_head',
      'get_upcoming_games',
      'get_stat_leaders',
    ])
    for (const n of names) expect(n).not.toMatch(/create|update|delete|send|post|set/i)
  })
})

describe('executeChimmyTool', () => {
  it('returns standings when they exist', async () => {
    expect(await executeChimmyTool('get_league_standings', {}, CTX)).toContain('Casey 3-0')
  })

  /*
   * The core rule. Returning nothing invites the model to fill the gap from
   * general knowledge in the same voice it uses for grounded answers.
   */
  it('states absence in words rather than returning empty', async () => {
    h.standings.mockResolvedValue(null)
    h.h2h.mockResolvedValue(null)

    const standings = await executeChimmyTool('get_league_standings', {}, CTX)
    const rivalry = await executeChimmyTool('get_head_to_head', {}, CTX)

    expect(standings).toMatch(/no standings/i)
    expect(standings).toMatch(/do not estimate/i)
    expect(rivalry).toMatch(/no head-to-head/i)
    expect(rivalry.length).toBeGreaterThan(20)
  })

  it('says so when no league is in scope', async () => {
    const out = await executeChimmyTool('get_league_standings', {}, { leagueId: null, userId: null })
    expect(out).toMatch(/no league is selected/i)
    expect(h.standings).not.toHaveBeenCalled()
  })

  /*
   * An empty live feed is "no games on", not "nobody scored" — reporting a zero
   * would be a fabricated fact about the day.
   */
  it('distinguishes an empty feed from a genuine zero', async () => {
    h.leaders.mockResolvedValue({ leaders: [], eventsScanned: 0 })
    const empty = await executeChimmyTool('get_stat_leaders', { stat: 'touchdowns' }, CTX)
    expect(empty).toMatch(/NOT the same as nobody having scored/i)

    h.leaders.mockResolvedValue({ leaders: [], eventsScanned: 40 })
    const none = await executeChimmyTool('get_stat_leaders', { stat: 'touchdowns' }, CTX)
    expect(none).toMatch(/40 live plays/i)
  })

  it('labels stat leaders as a live window, not season totals', async () => {
    h.leaders.mockResolvedValue({
      leaders: [{ playerId: 'p1', playerName: 'Josh Allen', team: 'BUF', total: 2, stats: [] }],
      eventsScanned: 30,
    })

    const out = await executeChimmyTool('get_stat_leaders', { stat: 'TDs' }, CTX)

    expect(out).toContain('Josh Allen')
    expect(out).toMatch(/not season totals/i)
  })

  it('clamps the upcoming-games limit the model asks for', async () => {
    h.upcoming.mockResolvedValue({ games: [] })

    await executeChimmyTool('get_upcoming_games', { limit: 999 }, CTX)

    expect(h.upcoming.mock.calls[0][2]).toBe(10)
  })

  it('says so when nothing is scheduled', async () => {
    const out = await executeChimmyTool('get_upcoming_games', { sport: 'nfl', seasonType: 'pre' }, CTX)
    expect(out).toMatch(/no upcoming/i)
    expect(out).toMatch(/rather than naming a game/i)
  })

  it('ignores a season type it does not recognise', async () => {
    await executeChimmyTool('get_upcoming_games', { seasonType: 'playoffs' }, CTX)
    expect(h.upcoming.mock.calls[0][0].seasonType).toBeNull()
  })

  it('reports a failed lookup instead of letting it throw', async () => {
    h.standings.mockRejectedValue(new Error('db down'))
    const out = await executeChimmyTool('get_league_standings', {}, CTX)
    expect(out).toMatch(/could not read it/i)
  })

  it('handles a tool name it does not have', async () => {
    const out = await executeChimmyTool('delete_everything', {}, CTX)
    expect(out).toMatch(/no tool called/i)
  })
})
