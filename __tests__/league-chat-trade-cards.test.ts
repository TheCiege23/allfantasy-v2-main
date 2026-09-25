import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  cacheFindUnique: vi.fn(),
  cacheUpsert: vi.fn(),
  tradeFindMany: vi.fn(),
  playerFindMany: vi.fn(),
  teamFindMany: vi.fn(),
  /*
   * Cards post through `postChimmyMoment` now (as Chimmy, deduped, capped). It used to be
   * `createLeagueChatMessage`; mocking the OLD dependency would let the real moment run against
   * this file's partial Prisma and every assertion below would be measuring nothing.
   */
  postMoment: vi.fn(),
  marketValues: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    sportsDataCache: { findUnique: h.cacheFindUnique, upsert: h.cacheUpsert },
    leagueTrade: { findMany: h.tradeFindMany },
    sportsPlayer: { findMany: h.playerFindMany },
    leagueTeam: { findMany: h.teamFindMany },
  },
}))
vi.mock('@/lib/league-chat/chimmyMoments', () => ({ postChimmyMoment: h.postMoment }))
vi.mock('@/lib/league-chat/chimmyTradeMoment', () => ({ readTradeMarketValues: h.marketValues }))

import { syncTradeCardsForLeague } from '@/lib/league-chat/tradeChatCards'

const OLD = new Date('2026-08-01T00:00:00.000Z')

function trade(over: Record<string, unknown> = {}) {
  return {
    transactionId: 'tx1',
    tradeDate: new Date('2026-08-20T12:00:00.000Z'),
    week: 3,
    season: 2026,
    playersGiven: ['6813'],
    playersReceived: ['8148'],
    picksGiven: [],
    picksReceived: [],
    history: { sleeperUsername: 'Casey' },
    ...over,
  }
}

/** The first moment posted. */
function posted() {
  return h.postMoment.mock.calls[0][0] as { text: string; card: Record<string, any>; messageType: string; kind: string; dedupeKey: string }
}

/** The body of the first card posted. */
function postedBody() {
  return posted().text
}

/** The metadata of the first card posted. */
function postedMeta() {
  return posted().card
}

/** The watermark most recently written. */
function watermark() {
  const calls = h.cacheUpsert.mock.calls
  return calls[calls.length - 1][0].update.data as { since: string; checkedAt: string }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.leagueFindUnique.mockResolvedValue({ id: 'l1', userId: 'owner', platformLeagueId: 'sl-1' })
  h.cacheFindUnique.mockResolvedValue({
    data: { since: OLD.toISOString(), checkedAt: new Date(0).toISOString() },
  })
  h.tradeFindMany.mockResolvedValue([])
  h.playerFindMany.mockResolvedValue([
    { sleeperId: '6813', name: 'Travis Kelce', position: 'TE', team: 'KC' },
    { sleeperId: '8148', name: "Ja'Marr Chase", position: 'WR', team: 'CIN' },
  ])
  h.cacheUpsert.mockResolvedValue({})
  h.teamFindMany.mockResolvedValue([])
  h.postMoment.mockResolvedValue({ posted: true, messageId: 'msg1' })
  h.marketValues.mockResolvedValue(null)
})

describe('trade cards', () => {
  /*
   * THE safety property. Production holds 7,829 ingested trades going back to
   * 2022; a first run that carded "everything without a card" would dump years
   * of history into 36 live league chats at once.
   */
  it('posts nothing the first time it sees a league', async () => {
    h.cacheFindUnique.mockResolvedValue(null)

    const out = await syncTradeCardsForLeague('l1')

    expect(out).toEqual({ status: 'seeded' })
    expect(h.postMoment).not.toHaveBeenCalled()
    expect(h.tradeFindMany).not.toHaveBeenCalled()
  })

  it('records a watermark on that first run so the next one has a floor', async () => {
    h.cacheFindUnique.mockResolvedValue(null)

    await syncTradeCardsForLeague('l1')

    expect(h.cacheUpsert).toHaveBeenCalledTimes(1)
  })

  it('only looks for trades newer than the watermark', async () => {
    await syncTradeCardsForLeague('l1')

    expect(h.tradeFindMany.mock.calls[0][0].where.tradeDate).toEqual({ gt: OLD })
  })

  it('posts a card naming both sides', async () => {
    h.tradeFindMany.mockResolvedValue([trade()])

    const out = await syncTradeCardsForLeague('l1')

    expect(out).toEqual({ status: 'scanned', posted: 1 })
    expect(postedBody()).toBe("Casey traded Travis Kelce for Ja'Marr Chase")
    expect(posted().messageType).toBe('trade')
  })

  /* Names or nothing — every traded id in production resolves. */
  it('never prints a raw player id', async () => {
    h.tradeFindMany.mockResolvedValue([trade()])

    await syncTradeCardsForLeague('l1')

    expect(postedBody()).not.toContain('6813')
    expect(postedBody()).not.toContain('8148')
  })

  it('says so when a player cannot be named', async () => {
    h.playerFindMany.mockResolvedValue([])
    h.tradeFindMany.mockResolvedValue([trade()])

    await syncTradeCardsForLeague('l1')

    expect(postedBody()).toContain('an unknown player')
  })

  /*
   * `LeagueTrade` is stored per owner, so the same transaction appears once per
   * roster. Carding rows would post every trade twice, from both directions.
   */
  it('posts one card per trade, not one per side', async () => {
    h.tradeFindMany.mockResolvedValue([
      trade({ playersGiven: ['6813'], playersReceived: ['8148'], history: { sleeperUsername: 'Casey' } }),
      trade({ playersGiven: ['8148'], playersReceived: ['6813'], history: { sleeperUsername: 'Jordan' } }),
    ])

    const out = await syncTradeCardsForLeague('l1')

    expect(out).toEqual({ status: 'scanned', posted: 1 })
    expect(h.postMoment).toHaveBeenCalledTimes(1)
  })

  it('counts picks on either side', async () => {
    h.tradeFindMany.mockResolvedValue([
      trade({ playersGiven: [], picksGiven: [{ season: 2027, round: 1 }, { season: 2027, round: 2 }] }),
    ])

    await syncTradeCardsForLeague('l1')

    expect(postedBody()).toContain('2 picks')
    expect(postedMeta().tradeCard.picksGave).toBe(2)
  })

  it('describes an empty side as nothing rather than blank', async () => {
    h.tradeFindMany.mockResolvedValue([trade({ playersGiven: [], picksGiven: [] })])

    await syncTradeCardsForLeague('l1')

    expect(postedBody()).toContain('traded nothing for')
  })

  it('advances the watermark to the newest trade it carded', async () => {
    const newest = new Date('2026-08-22T09:00:00.000Z')
    h.tradeFindMany.mockResolvedValue([trade({ transactionId: 'tx2', tradeDate: newest })])

    await syncTradeCardsForLeague('l1')

    expect(watermark().since).toBe(newest.toISOString())
  })

  /* A busy chat polls every few seconds; scanning on each would be absurd. */
  it('throttles repeat scans', async () => {
    h.cacheFindUnique.mockResolvedValue({
      data: { since: OLD.toISOString(), checkedAt: new Date().toISOString() },
    })

    expect(await syncTradeCardsForLeague('l1')).toEqual({ status: 'throttled' })
    expect(h.tradeFindMany).not.toHaveBeenCalled()
  })

  it('moves the throttle even when it finds nothing', async () => {
    await syncTradeCardsForLeague('l1')

    expect(watermark().since).toBe(OLD.toISOString())
    expect(h.cacheUpsert).toHaveBeenCalled()
  })

  it('caps how many it will post in one pass', async () => {
    h.tradeFindMany.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) =>
        trade({ transactionId: `tx${i}`, tradeDate: new Date(Date.parse('2026-08-20T00:00:00Z') + i * 1000) }),
      ),
    )

    const out = await syncTradeCardsForLeague('l1')

    expect(out).toEqual({ status: 'scanned', posted: 5 })
  })

  it('skips a league with no Sleeper id, which has no trades to find', async () => {
    h.leagueFindUnique.mockResolvedValue({ id: 'l1', userId: 'owner', platformLeagueId: null })

    expect(await syncTradeCardsForLeague('l1')).toEqual({ status: 'skipped', reason: 'not-sleeper' })
  })

  /* A chat that failed to load because a card could not be written would be worse. */
  it('never throws when the database is unhappy', async () => {
    h.tradeFindMany.mockRejectedValue(new Error('db down'))

    expect(await syncTradeCardsForLeague('l1')).toEqual({ status: 'skipped', reason: 'error' })
  })

  it('ignores an empty league id', async () => {
    expect(await syncTradeCardsForLeague('')).toEqual({ status: 'skipped', reason: 'no-league' })
    expect(h.leagueFindUnique).not.toHaveBeenCalled()
  })
})

describe('trade cards are Chimmy moments', () => {
  /** Mocked market values as `readTradeMarketValues` returns them — Chase 8,800, Kelce 3,560. */
  const MARKET = [
    { player: { sleeperId: '8148', name: "Ja'Marr Chase", position: 'WR', maybeTeam: 'CIN' }, value: 8800 },
    { player: { sleeperId: '6813', name: 'Travis Kelce', position: 'TE', maybeTeam: 'KC' }, value: 3560 },
  ]

  it('posts each trade as a Chimmy "trade" moment, deduped on the Sleeper transaction', async () => {
    h.tradeFindMany.mockResolvedValue([trade()])

    await syncTradeCardsForLeague('l1')

    expect(posted()).toMatchObject({ leagueId: 'l1', kind: 'trade', dedupeKey: 'sleeper:tx1', messageType: 'trade' })
  })

  it('folds Chimmy’s take — winner and real numbers — into the same message as the card', async () => {
    h.marketValues.mockResolvedValue({ players: MARKET, isDynasty: true })
    h.tradeFindMany.mockResolvedValue([
      trade({ playersGiven: ['6813'], playersReceived: ['8148'], history: { sleeperUsername: 'Casey' } }),
      trade({ playersGiven: ['8148'], playersReceived: ['6813'], history: { sleeperUsername: 'Jordan' } }),
    ])

    const out = await syncTradeCardsForLeague('l1')

    expect(out).toEqual({ status: 'scanned', posted: 1 })
    expect(h.postMoment).toHaveBeenCalledTimes(1)
    expect(postedBody()).toMatch(
      /^On paper, Casey wins this one, and it isn't close: 8,800 of market value coming in, 3,560 going out \(\+5,240\)\. Jordan/,
    )
    expect(postedMeta().tradeCard).toMatchObject({ manager: 'Casey', partner: 'Jordan', valueGave: 3560, valueGot: 8800 })
  })

  it('names a manager stored as a Sleeper user id by the league’s own name', async () => {
    h.teamFindMany.mockResolvedValue([{ platformUserId: '736512345', ownerName: 'Casey', teamName: 'Casey’s Crew' }])
    h.tradeFindMany.mockResolvedValue([trade({ history: { sleeperUsername: '736512345' } })])

    await syncTradeCardsForLeague('l1')

    expect(postedBody()).toBe("Casey traded Travis Kelce for Ja'Marr Chase")
    expect(postedBody()).not.toContain('736512345')
  })

  it('posts nothing while Chimmy is switched off, and never cards those trades later', async () => {
    h.leagueFindUnique.mockResolvedValue({ id: 'l1', userId: 'owner', platformLeagueId: 'sl-1', settings: { chimmySpeaksUp: false } })

    const before = Date.now()
    expect(await syncTradeCardsForLeague('l1')).toEqual({ status: 'scanned', posted: 0 })
    expect(h.tradeFindMany).not.toHaveBeenCalled()
    expect(h.postMoment).not.toHaveBeenCalled()
    expect(Date.parse(watermark().since)).toBeGreaterThanOrEqual(before)
  })

  it('a moment the day’s cap refused is not counted as posted, and the watermark still moves past it', async () => {
    const newest = new Date('2026-08-22T09:00:00.000Z')
    h.postMoment.mockResolvedValue({ posted: false, reason: 'daily_cap' })
    h.tradeFindMany.mockResolvedValue([trade({ tradeDate: newest })])

    expect(await syncTradeCardsForLeague('l1')).toEqual({ status: 'scanned', posted: 0 })
    expect(watermark().since).toBe(newest.toISOString())
  })
})
