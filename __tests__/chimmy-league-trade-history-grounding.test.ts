import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  historyFindMany: vi.fn(),
  tradeFindMany: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique },
    leagueTradeHistory: { findMany: mocks.historyFindMany },
    leagueTrade: { findMany: mocks.tradeFindMany },
    sportsPlayer: { findMany: mocks.sportsPlayerFindMany },
  },
}))

import { buildLeagueTradeHistoryContext } from '@/lib/chimmy-trade/leagueTradeHistoryGrounding'

function trade(overrides: Record<string, unknown> = {}) {
  return {
    transactionId: 'tx-1',
    week: 3,
    season: 2026,
    tradeDate: new Date('2026-09-20T00:00:00.000Z'),
    playersGiven: ['2216'],
    playersReceived: ['5859'],
    picksGiven: [],
    picksReceived: [{ round: 1, season: '2027' }],
    ...overrides,
  }
}

describe('buildLeagueTradeHistoryContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leagueFindUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: '1234567890',
      sport: 'nfl',
      season: 2026,
    })
    mocks.historyFindMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }])
    mocks.tradeFindMany.mockResolvedValue([trade()])
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: '5859', name: 'Brian Thomas Jr.' },
      { externalId: '2216', name: 'Old Reliable' },
    ])
  })

  it('renders completed trades with resolved player names', async () => {
    const out = await buildLeagueTradeHistoryContext('lg1', 'user-1')

    expect(out).toContain('COMPLETED TRADE HISTORY')
    expect(out).toContain('Brian Thomas Jr.')
    expect(out).toContain('Old Reliable')
    expect(out).toContain('2027 R1')
  })

  /*
   * The single most important instruction in the block: these are settled, and a
   * model must not imply the user has something to respond to.
   */
  it('states outright that nothing here is pending', async () => {
    const out = await buildLeagueTradeHistoryContext('lg1', 'user-1')
    expect(out).toContain('ALREADY HAPPENED')
    expect(out).toMatch(/none of them is a pending offer/i)
    expect(out).toMatch(/nothing here is awaiting the user's response/i)
  })

  /* valueGiven/valueReceived are populated on zero rows in production. */
  it('forbids pricing the trades, because no values are stored', async () => {
    const out = await buildLeagueTradeHistoryContext('lg1', 'user-1')
    expect(out).toContain('no trade values are stored')
    expect(out).toMatch(/do NOT state what any of them was worth/i)
  })

  it('always filters the name lookup by sport', async () => {
    await buildLeagueTradeHistoryContext('lg1', 'user-1')
    const where = mocks.sportsPlayerFindMany.mock.calls[0][0].where
    expect(where.sport).toBe('NFL')
    expect(where.externalId.in).toEqual(expect.arrayContaining(['5859', '2216']))
  })

  it('counts unresolved players instead of guessing at them', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([])
    const out = await buildLeagueTradeHistoryContext('lg1', 'user-1')
    expect(out).toContain('unidentified player')
    expect(out).toMatch(/never guess who they were/i)
  })

  /*
   * One history row per manager means the same trade is stored from both sides;
   * reporting it twice would read as two separate deals in opposite directions.
   */
  it('deduplicates a trade recorded from both managers', async () => {
    mocks.tradeFindMany.mockResolvedValue([
      trade(),
      trade({ playersGiven: ['5859'], playersReceived: ['2216'] }),
    ])
    const out = await buildLeagueTradeHistoryContext('lg1', 'user-1')
    expect(out).toContain('Trades on file in the window read: 1')
  })

  it('returns null for a league that is not Sleeper-backed', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      platform: 'espn',
      platformLeagueId: '99',
      sport: 'nfl',
      season: 2026,
    })
    expect(await buildLeagueTradeHistoryContext('lg1', 'user-1')).toBeNull()
    expect(mocks.historyFindMany).not.toHaveBeenCalled()
  })

  it('returns null when the league has no ingested history', async () => {
    mocks.historyFindMany.mockResolvedValue([])
    expect(await buildLeagueTradeHistoryContext('lg1', 'user-1')).toBeNull()
  })
})
