import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  historyFindMany: vi.fn(),
  tradeFindMany: vi.fn(),
  sportsPlayerFindMany: vi.fn(),
  leagueFindMany: vi.fn(),
  leagueTeamFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: mocks.leagueFindUnique, findMany: mocks.leagueFindMany },
    leagueTeam: { findMany: mocks.leagueTeamFindMany },
    leagueTradeHistory: { findMany: mocks.historyFindMany },
    leagueTrade: { findMany: mocks.tradeFindMany },
    sportsPlayer: { findMany: mocks.sportsPlayerFindMany },
  },
}))

import {
  buildLeagueTradeHistoryContext,
  buildLeagueTradeHistoryOutcome,
  TRADE_HISTORY_BLOCK_MARKER,
} from '@/lib/chimmy-trade/leagueTradeHistoryGrounding'

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
    /*
     * ⚠ THIS FIXTURE ENCODED THE BUG. It gave a Sleeper player a BARE
     * `externalId: '5859'` and no `sleeperId`, which is the shape the crosswalk
     * used to look up — and matching a Sleeper id against a bare `externalId`
     * reaches a different person: 42,032 bare ids collide with a Sleeper id and
     * 42,031 of those are somebody else. The fixture passed while the code was
     * wrong, and went red when the code was fixed.
     *
     * A real Sleeper-sourced row carries BOTH spellings.
     */
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:5859', sleeperId: '5859', name: 'Brian Thomas Jr.' },
      { externalId: 'sleeper:2216', sleeperId: '2216', name: 'Old Reliable' },
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

  /**
   * ⚠ THIS ASSERTED THE BUG TOO — `where.externalId.in` containing BARE Sleeper
   * ids is exactly the query that returns a stranger. Measured on real roster
   * ids: this crosswalk resolved 121 players and only 42 correctly, so 79 were
   * other people; Justin Jefferson came back as DaRon Bland. Those names reached
   * AI grounding blocks as fact.
   *
   * The lookup now asks for both spellings a Sleeper-sourced row can carry, and
   * the sport filter stays because `externalId` is unique only WITHIN a sport.
   */
  it('looks a Sleeper id up by both spellings, never bare, and always by sport', async () => {
    await buildLeagueTradeHistoryContext('lg1', 'user-1')
    const where = mocks.sportsPlayerFindMany.mock.calls[0][0].where

    expect(where.sport).toBe('NFL')

    const or = where.OR as Array<Record<string, { in: string[] }>>
    expect(or.find((c) => c.sleeperId)?.sleeperId.in).toEqual(
      expect.arrayContaining(['5859', '2216']),
    )
    expect(or.find((c) => c.externalId)?.externalId.in).toEqual(
      expect.arrayContaining(['sleeper:5859', 'sleeper:2216']),
    )

    /* The shape that reaches the wrong person must not come back. */
    expect(where.externalId).toBeUndefined()
    expect(JSON.stringify(where)).not.toMatch(/"externalId":\{"in":\["\d/)
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

/*
 * 🛑 THE POINT OF THIS SUITE IS THAT `null` USED TO BE SEVEN ANSWERS AT ONCE.
 *
 * On 2026-09-20 Chimmy told a manager it could not see their league's trade
 * history while 27 ingested trades sat in the database, whose players resolve 13
 * of 13 to correct names. Nothing recorded whether the block was never built or
 * was built and dropped downstream by `applyGroundingBudget` — and those have
 * opposite fixes. Each case below is a reason that used to be indistinguishable.
 */
describe('buildLeagueTradeHistoryOutcome — why there is no block', () => {
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
      { externalId: 'sleeper:5859', sleeperId: '5859', name: 'Brian Thomas Jr.' },
      { externalId: 'sleeper:2216', sleeperId: '2216', name: 'Old Reliable' },
    ])
  })

  it('reports ok with the counts needed to judge the block at a glance', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')

    expect(out.kind).toBe('ok')
    if (out.kind !== 'ok') return
    expect(out.uniqueTrades).toBe(1)
    expect(out.shown).toBe(1)
    expect(out.unresolvedPlayers).toBe(0)
    expect(out.text).toContain(TRADE_HISTORY_BLOCK_MARKER)
  })

  /*
   * ⚠ THE ONE THAT MATTERS MOST OPERATIONALLY. This repo has more than one
   * league-id space, and the league handed to the builder is not always a
   * `leagues.id`. Before this, that was indistinguishable from "this league has
   * never traded" — the same silence, a completely different fix.
   */
  it('distinguishes a league id that does not resolve from a league with no trades', async () => {
    mocks.leagueFindUnique.mockResolvedValue(null)
    expect((await buildLeagueTradeHistoryOutcome('not-a-league-id', 'user-1')).kind).toBe(
      'league-not-found',
    )

    mocks.leagueFindUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: '1234567890',
      sport: 'nfl',
      season: 2026,
    })
    mocks.historyFindMany.mockResolvedValue([])
    expect((await buildLeagueTradeHistoryOutcome('lg1', 'user-1')).kind).toBe('no-history-rows')
  })

  it('names a non-Sleeper platform rather than going quiet', async () => {
    mocks.leagueFindUnique.mockResolvedValue({
      platform: 'espn',
      platformLeagueId: '99',
      sport: 'nfl',
      season: 2026,
    })
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    expect(out.kind).toBe('not-sleeper')
    if (out.kind === 'not-sleeper') expect(out.platform).toBe('espn')
  })

  it('separates history rows existing from trade rows existing', async () => {
    mocks.tradeFindMany.mockResolvedValue([])
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    expect(out.kind).toBe('no-trade-rows')
    if (out.kind === 'no-trade-rows') expect(out.historyCount).toBe(2)
  })

  /* A thrown lookup is not the same fact as an empty one, and used to look identical. */
  it('separates a failed lookup from an empty one', async () => {
    mocks.leagueFindUnique.mockRejectedValue(new Error('db down'))
    expect((await buildLeagueTradeHistoryOutcome('lg1', 'user-1')).kind).toBe('league-lookup-failed')

    mocks.leagueFindUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: '1234567890',
      sport: 'nfl',
      season: 2026,
    })
    mocks.historyFindMany.mockRejectedValue(new Error('db down'))
    expect((await buildLeagueTradeHistoryOutcome('lg1', 'user-1')).kind).toBe(
      'history-lookup-failed',
    )
  })

  it('reports missing arguments without touching the database', async () => {
    expect((await buildLeagueTradeHistoryOutcome('', 'user-1')).kind).toBe('missing-args')
    expect((await buildLeagueTradeHistoryOutcome('lg1', '')).kind).toBe('missing-args')
    expect(mocks.leagueFindUnique).not.toHaveBeenCalled()
  })

  /*
   * ⚠ THE MARKER MUST BE THE HEADING, NOT A COPY OF IT. The route checks whether
   * this exact string survived the grounding budget. A second spelling would keep
   * that check passing after the heading was reworded — reporting a dropped block
   * as present, which is the precise failure the check exists to catch.
   */
  it('writes the exported marker into the block it builds', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    if (out.kind !== 'ok') throw new Error('expected ok')
    expect(out.text.startsWith(TRADE_HISTORY_BLOCK_MARKER)).toBe(true)
  })

  /* The old contract still holds for every caller that only wants a block. */
  it('keeps the string-or-null wrapper in agreement with the outcome', async () => {
    expect(await buildLeagueTradeHistoryContext('lg1', 'user-1')).toContain(
      TRADE_HISTORY_BLOCK_MARKER,
    )

    mocks.historyFindMany.mockResolvedValue([])
    expect(await buildLeagueTradeHistoryContext('lg1', 'user-1')).toBeNull()
  })
})

/*
 * 🛑 CHIMMY TOLD A KBFL MANAGER THE TRADE HISTORY "ISN'T ITEMIZED" (2026-09-20/21).
 *
 * The block it could read printed "one side got [..] for [..]": no manager on either
 * side and eight trades at most, so "what did Layes23 give up?" had no answer even
 * when the block arrived. Every line now names both managers, and the tool path can
 * narrow to a season, a manager or a player.
 */
describe('buildLeagueTradeHistoryOutcome — itemized, with both managers', () => {
  /* One deal, stored once from each manager's side, as ingestion writes it. */
  const bothSides = [
    trade({
      transactionId: 'tx-9',
      playersGiven: ['2216'],
      playersReceived: ['5859'],
      picksReceived: [{ round: 1, season: '2027' }],
      picksGiven: [],
      partnerName: 'Layes23',
      history: { sleeperUsername: 'TheCiege24' },
    }),
    trade({
      transactionId: 'tx-9',
      playersGiven: ['5859'],
      playersReceived: ['2216'],
      picksReceived: [],
      picksGiven: [{ round: 1, season: '2027' }],
      partnerName: 'TheCiege24',
      history: { sleeperUsername: 'Layes23' },
    }),
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leagueFindUnique.mockResolvedValue({
      platform: 'sleeper',
      platformLeagueId: '1234567890',
      sport: 'nfl',
      season: 2026,
    })
    mocks.historyFindMany.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }])
    mocks.tradeFindMany.mockResolvedValue(bothSides)
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:5859', sleeperId: '5859', name: 'Brian Thomas Jr.' },
      { externalId: 'sleeper:2216', sleeperId: '2216', name: 'Mike Evans' },
    ])
  })

  it('names both managers and every asset on one line per deal', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    if (out.kind !== 'ok') throw new Error('expected ok')
    expect(out.uniqueTrades).toBe(1)
    expect(out.text).toContain(
      'TheCiege24 got [Brian Thomas Jr., 2027 R1] from Layes23 for [Mike Evans].',
    )
    expect(out.text).not.toContain('one side got')
  })

  it("reads a manager's own side of the deal when the question is about them", async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { manager: 'layes23' })
    if (out.kind !== 'ok') throw new Error('expected ok')
    expect(out.text).toContain('Layes23 got [Mike Evans] from TheCiege24 for [Brian Thomas Jr., 2027 R1].')
    expect(out.text).toContain('Filtered to manager "layes23": 1 trade.')
  })

  it('drops deals a named manager was not part of', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { manager: 'SomeoneElse' })
    if (out.kind !== 'ok') throw new Error('expected ok')
    expect(out.text).toContain('Filtered to manager "SomeoneElse": 0 trades.')
    expect(out.text).toContain('No trade in the window read matches that filter.')
    expect(out.text).not.toContain('Mike Evans')
  })

  it('finds a trade by player name', async () => {
    const hit = await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { player: 'evans' })
    if (hit.kind !== 'ok') throw new Error('expected ok')
    expect(hit.text).toContain('Filtered to player "evans": 1 trade.')
    expect(hit.text).toContain('Mike Evans')

    const miss = await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { player: 'Jefferson' })
    if (miss.kind !== 'ok') throw new Error('expected ok')
    expect(miss.text).toContain('Filtered to player "Jefferson": 0 trades.')
  })

  /* A player match only sees named players; an unnamed one must not read as "never traded". */
  it('warns that a player match can miss a trade whose players have no name on file', async () => {
    mocks.sportsPlayerFindMany.mockResolvedValue([])
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { player: 'Evans' })
    if (out.kind !== 'ok') throw new Error('expected ok')
    expect(out.text).toMatch(/have no name on file, so a player match can miss a trade/)
  })

  it('narrows the database read to one season rather than filtering afterwards', async () => {
    await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { season: 2025 })
    expect(mocks.tradeFindMany.mock.calls[0][0].where.season).toBe(2025)

    await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    expect(mocks.tradeFindMany.mock.calls[1][0].where.season).toBeUndefined()
  })

  it('lists more than the push block\'s eight when the tool asks for them, and says when older ones were not read', async () => {
    const many = Array.from({ length: 24 }, (_, i) =>
      trade({ transactionId: `tx-${i}`, partnerName: 'Layes23', history: { sleeperUsername: 'TheCiege24' } }),
    )
    mocks.tradeFindMany.mockResolvedValue(many)

    const push = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    if (push.kind !== 'ok') throw new Error('expected ok')
    expect(push.shown).toBe(8)

    const tool = await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { maxShown: 30, scanLimit: 24 })
    if (tool.kind !== 'ok') throw new Error('expected ok')
    expect(tool.shown).toBe(24)
    expect(tool.text).toContain('All 24, most recent first:')
    expect(tool.text).toContain('Older trades exist beyond this window')
  })
})

/*
 * 🛑 NEITHER STORED NAME IS A NAME. On every ingested row `partnerName` is null and
 * `sleeperUsername` is the Sleeper USER ID, so a block built from them printed
 * "1208593130748645376 got [..] from another manager". Seen in Chrome against the test copy,
 * 2026-09-25. The league's own team rows name both sides.
 */
describe('buildLeagueTradeHistoryOutcome — managers named by team', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leagueFindUnique.mockResolvedValue({ platform: 'sleeper', platformLeagueId: '1382', sport: 'nfl', season: 2026 })
    mocks.historyFindMany.mockResolvedValue([{ id: 'h1' }])
    mocks.tradeFindMany.mockResolvedValue([
      trade({
        transactionId: 'tx-7',
        playersGiven: ['2216'],
        playersReceived: ['5859'],
        picksReceived: [],
        partnerName: null,
        partnerRosterId: 3,
        history: { sleeperUsername: '1208593130748645376' },
      }),
    ])
    mocks.sportsPlayerFindMany.mockResolvedValue([
      { externalId: 'sleeper:5859', sleeperId: '5859', name: 'Brian Thomas Jr.' },
      { externalId: 'sleeper:2216', sleeperId: '2216', name: 'Mike Evans' },
    ])
    /* The question arrived on a row with no teams; a sibling row for the same Sleeper league has them. */
    mocks.leagueFindMany.mockResolvedValue([{ id: 'lg1' }, { id: 'lg-sibling' }])
    mocks.leagueTeamFindMany.mockResolvedValue([
      { leagueId: 'lg-sibling', externalId: '7', platformUserId: '1208593130748645376', teamName: 'ElTigre164', ownerName: 'ElTigre164' },
      { leagueId: 'lg-sibling', externalId: '3', platformUserId: '1227375788647530496', teamName: 'Whohatesyou', ownerName: 'Whohatesyou' },
    ])
  })

  it('turns a Sleeper user id and a roster id into the teams they are', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    if (out.kind !== 'ok') throw new Error('expected ok')
    expect(out.text).toContain('ElTigre164 got [Brian Thomas Jr.] from Whohatesyou for [Mike Evans].')
    expect(out.text).not.toContain('1208593130748645376 got')
    expect(out.text).toMatch(/CURRENT team names/)
    /* Every row for this Sleeper league is read, not just the one the question came in on. */
    expect(mocks.leagueTeamFindMany.mock.calls[0][0].where.leagueId.in).toEqual(['lg1', 'lg-sibling'])
  })

  it('finds a manager by part of their team name, on either side of the deal', async () => {
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { manager: 'tigre' })
    if (out.kind !== 'ok') throw new Error('expected ok')
    expect(out.text).toContain('Filtered to manager "tigre": 1 trade.')

    const partner = await buildLeagueTradeHistoryOutcome('lg1', 'user-1', { manager: 'Whohatesyou' })
    if (partner.kind !== 'ok') throw new Error('expected ok')
    expect(partner.text).toContain('Filtered to manager "Whohatesyou": 1 trade.')
  })

  it('never prints a bare id when no team row names it', async () => {
    mocks.leagueTeamFindMany.mockResolvedValue([])
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    if (out.kind !== 'ok') throw new Error('expected ok')
    expect(out.text).toContain('an unnamed manager got [Brian Thomas Jr.] from another manager for [Mike Evans].')
    expect(out.text).not.toMatch(/\d{12,}/)
    expect(out.text).not.toMatch(/CURRENT team names/)
  })

  it('still builds the block when the team read fails', async () => {
    mocks.leagueFindMany.mockRejectedValue(new Error('db down'))
    const out = await buildLeagueTradeHistoryOutcome('lg1', 'user-1')
    expect(out.kind).toBe('ok')
  })
})
