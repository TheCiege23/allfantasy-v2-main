import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  leagueFindUnique: vi.fn(),
  cacheFindUnique: vi.fn(),
  cacheUpsert: vi.fn(),
  tradeFindMany: vi.fn(),
  playerFindMany: vi.fn(),
  createMessage: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    league: { findUnique: h.leagueFindUnique },
    sportsDataCache: { findUnique: h.cacheFindUnique, upsert: h.cacheUpsert },
    leagueTrade: { findMany: h.tradeFindMany },
    sportsPlayer: { findMany: h.playerFindMany },
  },
}))
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({
  createLeagueChatMessage: h.createMessage,
}))

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

/** The body of the first card posted. */
function postedBody() {
  return h.createMessage.mock.calls[0][2] as string
}

/** The metadata of the first card posted. */
function postedMeta() {
  return h.createMessage.mock.calls[0][3].metadata as Record<string, any>
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
  h.createMessage.mockResolvedValue({ id: 'msg1' })
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
    expect(h.createMessage).not.toHaveBeenCalled()
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
    expect(h.createMessage.mock.calls[0][3].type).toBe('trade')
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
    expect(h.createMessage).toHaveBeenCalledTimes(1)
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
