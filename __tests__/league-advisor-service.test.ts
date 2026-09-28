import { beforeEach, describe, expect, it, vi } from 'vitest'

const leagueFindFirstMock = vi.fn()
const rosterFindFirstMock = vi.fn()
const playerIdentityMapFindManyMock = vi.fn()
const sportsInjuryFindManyMock = vi.fn()
const playerMetaTrendFindManyMock = vi.fn()

const openaiChatJsonMock = vi.fn()
const parseJsonContentFromChatCompletionMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findFirst: leagueFindFirstMock },
    roster: { findFirst: rosterFindFirstMock },
    playerIdentityMap: { findMany: playerIdentityMapFindManyMock },
    sportsInjury: { findMany: sportsInjuryFindManyMock },
    playerMetaTrend: { findMany: playerMetaTrendFindManyMock },
  },
}))

vi.mock('@/lib/openai-client', () => ({
  openaiChatJson: openaiChatJsonMock,
  parseJsonContentFromChatCompletion: parseJsonContentFromChatCompletionMock,
}))

/* Sleeper's player dictionary, keyed by Sleeper id: '6038' is a real Sleeper player. */
vi.mock('@/lib/sleeper-client', () => ({
  getAllPlayers: vi.fn(async () => ({ '6038': { full_name: 'Wrong Player' } })),
}))

describe('LeagueAdvisorService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindFirstMock.mockResolvedValue({
      id: 'lg-1',
      name: 'League One',
      sport: 'NBA',
    })
    rosterFindFirstMock.mockResolvedValue({
      playerData: { players: ['p-1', 'p-2'], starters: ['p-1'] },
      faabRemaining: 55,
      waiverPriority: 3,
    })
    playerIdentityMapFindManyMock.mockResolvedValue([
      { sleeperId: 'p-1', canonicalName: 'Alpha Guard' },
      { sleeperId: 'p-2', canonicalName: 'Beta Wing' },
    ])
    sportsInjuryFindManyMock.mockResolvedValue([])
    playerMetaTrendFindManyMock.mockResolvedValue([])
    parseJsonContentFromChatCompletionMock.mockImplementation((payload: any) => payload?.parsed ?? null)
  })

  it('parses and normalizes advisor JSON from OpenAI response', async () => {
    const { getLeagueAdvisorAdvice } = await import('@/lib/league-advisor/LeagueAdvisorService')

    openaiChatJsonMock.mockResolvedValueOnce({
      ok: true,
      json: {
        parsed: {
          lineup: [
            {
              summary: 'Move Alpha Guard into a primary scoring slot.',
              action: 'Start Alpha Guard',
              priority: 'high',
              playerNames: ['Alpha Guard'],
            },
          ],
          trade: [{ summary: 'Hold current core.', direction: 'hold', priority: 'low' }],
          waiver: [],
          injury: [],
        },
      },
    })

    const advice = await getLeagueAdvisorAdvice({
      leagueId: 'lg-1',
      userId: 'u-1',
    })

    expect(advice).not.toBeNull()
    expect(advice?.sport).toBe('NBA')
    expect(advice?.lineup[0]).toEqual(
      expect.objectContaining({
        summary: 'Move Alpha Guard into a primary scoring slot.',
        action: 'Start Alpha Guard',
        priority: 'high',
      })
    )
    expect(advice?.trade[0]?.direction).toBe('hold')
  })

  it('returns deterministic fallback advice when AI fails', async () => {
    const { getLeagueAdvisorAdvice } = await import('@/lib/league-advisor/LeagueAdvisorService')

    playerMetaTrendFindManyMock.mockResolvedValueOnce([
      { playerId: 'p-1', trendScore: 92, trendingDirection: 'Hot' },
      { playerId: 'p-2', trendScore: 41, trendingDirection: 'Cold' },
    ])
    sportsInjuryFindManyMock.mockResolvedValueOnce([
      {
        playerName: 'Alpha Guard',
        team: 'BOS',
        status: 'Out',
        type: 'ankle',
      },
    ])
    openaiChatJsonMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      details: 'upstream',
      model: 'x',
      baseUrl: 'x',
    })

    const advice = await getLeagueAdvisorAdvice({
      leagueId: 'lg-1',
      userId: 'u-1',
    })

    expect(advice).not.toBeNull()
    expect(advice?.injury.length).toBeGreaterThan(0)
    expect(advice?.injury[0]).toEqual(
      expect.objectContaining({
        playerName: 'Alpha Guard',
        priority: 'high',
      })
    )
    expect(advice?.lineup.length).toBeGreaterThan(0)
    expect(advice?.trade.length).toBeGreaterThan(0)
    expect(advice?.waiver.length).toBeGreaterThan(0)
  })
})

/*
 * A Fleaflicker roster id is a short number in Sleeper's range. '6038' on a Fleaflicker roster is
 * NOT Sleeper's '6038', so the advisor must not name (or pull injuries for) Sleeper's player.
 */
describe('LeagueAdvisorService — foreign roster ids', () => {
  const userContentFor = async (platform: string) => {
    vi.clearAllMocks()
    leagueFindFirstMock.mockResolvedValue({ id: 'lg-ff', name: 'Imported', sport: 'NFL', platform })
    rosterFindFirstMock.mockResolvedValue({
      playerData: { players: ['6038'], starters: ['6038'] },
      faabRemaining: null,
      waiverPriority: null,
    })
    playerIdentityMapFindManyMock.mockResolvedValue([])
    sportsInjuryFindManyMock.mockResolvedValue([
      { playerName: 'Wrong Player', team: 'KC', status: 'Out', type: 'knee' },
    ])
    playerMetaTrendFindManyMock.mockResolvedValue([{ playerId: '6038', trendScore: 90, trendingDirection: 'Hot' }])
    openaiChatJsonMock.mockResolvedValue({ ok: false, status: 500 })
    const { getLeagueAdvisorAdvice } = await import('@/lib/league-advisor/LeagueAdvisorService')
    const advice = await getLeagueAdvisorAdvice({ leagueId: 'lg-ff', userId: 'u-1' })
    const messages = openaiChatJsonMock.mock.calls[0]?.[0]?.messages ?? []
    return { advice, userContent: String(messages[1]?.content ?? '') }
  }

  it('does not name the Sleeper player who shares a Fleaflicker roster id', async () => {
    const { advice, userContent } = await userContentFor('fleaflicker')
    expect(userContent).not.toContain('Wrong Player')
    expect(userContent).toContain('cannot be resolved')
    expect(advice?.injury.map((i) => i.playerName)).not.toContain('Wrong Player')
    expect(sportsInjuryFindManyMock).not.toHaveBeenCalled()
    // The trend read must not be handed the foreign id either.
    expect(advice?.trade.map((t) => t.targetPlayer)).not.toContain('Wrong Player')
  })

  it('CONTROL: the same id in a Sleeper league IS named', async () => {
    const { userContent } = await userContentFor('sleeper')
    expect(userContent).toContain('Starters: Wrong Player')
  })
})
