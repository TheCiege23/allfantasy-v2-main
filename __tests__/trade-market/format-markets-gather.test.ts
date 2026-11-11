import { describe, expect, it } from 'vitest'

import { bookKey, gatherFormatObservations } from '@/lib/trade-market/formatMarkets'

/**
 * 🛑 The point of the format split: a superflex trade is measured on the SUPERFLEX chart and lands in the
 * superflex book; a 1QB trade on the 1QB chart; a trade whose league cannot be identified is left out.
 */
function fakePrisma() {
  const trades = [
    // Superflex dynasty league: QB 1 for RB 2.
    { transactionId: 'sf-1', historyId: 'h-sf', season: 2026, tradeDate: null, playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] },
    { transactionId: 'sf-1', historyId: 'h-sf-other-side', season: 2026, tradeDate: null, playersGiven: ['2'], playersReceived: ['1'], picksGiven: [], picksReceived: [] },
    // 1QB dynasty league (found only through league_seasons): the same two players.
    { transactionId: 'one-1', historyId: 'h-1qb', season: 2025, tradeDate: null, playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] },
    // Unknown league.
    { transactionId: 'x-1', historyId: 'h-unknown', season: 2026, tradeDate: null, playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] },
  ]
  const histories = [
    { id: 'h-sf', sleeperLeagueId: 'P-SF' },
    { id: 'h-sf-other-side', sleeperLeagueId: 'P-SF' },
    { id: 'h-1qb', sleeperLeagueId: 'P-OLD-1QB' },
    { id: 'h-unknown', sleeperLeagueId: 'P-GONE' },
  ]
  const leagues = [
    { id: 'L-SF', platformLeagueId: 'P-SF', leagueType: 'dynasty', settings: { roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'] } },
    { id: 'L-1QB', platformLeagueId: 'P-NOW-1QB', leagueType: 'dynasty', settings: { roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'] } },
  ]
  const snapshots = [
    { sleeperId: '1', value: 2000, format: 'DYNASTY', qbFormat: 'ONE_QB' },
    { sleeperId: '2', value: 3000, format: 'DYNASTY', qbFormat: 'ONE_QB' },
    { sleeperId: '1', value: 6000, format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
    { sleeperId: '2', value: 2800, format: 'DYNASTY', qbFormat: 'SUPERFLEX' },
  ]
  type W = { where: Record<string, { in?: string[] }> }
  const inList = (w: W, key: string) => w.where[key]?.in ?? []
  return {
    leagueTrade: { findMany: async () => trades },
    leagueTradeHistory: { findMany: async (a: W) => histories.filter((h) => inList(a, 'id').includes(h.id)) },
    league: {
      findMany: async (a: W) =>
        a.where.platformLeagueId ? leagues.filter((l) => inList(a, 'platformLeagueId').includes(l.platformLeagueId)) : leagues.filter((l) => inList(a, 'id').includes(l.id)),
    },
    leagueSeason: { findMany: async (a: W) => (inList(a, 'platformLeagueId').includes('P-OLD-1QB') ? [{ platformLeagueId: 'P-OLD-1QB', leagueId: 'L-1QB' }] : []) },
    playerValueSnapshot: { findMany: async () => snapshots },
    sportsPlayer: {
      findMany: async () => [
        { sleeperId: '1', name: 'A Quarterback', position: 'QB', source: 'sleeper', fetchedAt: new Date() },
        { sleeperId: '2', name: 'A Running Back', position: 'RB', source: 'sleeper', fetchedAt: new Date() },
      ],
    },
  }
}

describe('gatherFormatObservations', () => {
  it('measures each trade on its own league’s chart, counts the trade once, and leaves an unknown league out', async () => {
    const g = await gatherFormatObservations(fakePrisma() as never, { sinceSeason: 2024 })
    expect(g.tradesConsidered).toBe(3)
    expect(g.tradesUsed).toBe(2)
    expect(g.skipped).toMatchObject({ unknown_league_format: 1 })

    const sf = g.byBook.get(bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }))!
    const one = g.byBook.get(bookKey({ format: 'DYNASTY', qbFormat: 'ONE_QB' }))!
    // Superflex chart: QB 6000 for RB 2800 — the QB's base is his SUPERFLEX value.
    expect(sf.byPlayer.get('1')).toMatchObject({ baseValue: 6000 })
    expect(sf.byPlayer.get('1')!.observations[0]!.observedValue).toBe(2800)
    // 1QB chart: the same QB is 2000 there, and that trade never reached the superflex book.
    expect(one.byPlayer.get('1')).toMatchObject({ baseValue: 2000 })
    expect(sf.byPlayer.get('1')!.observations).toHaveLength(1)

    const lineupBooks = g.lineupObservations.map((o) => `${o.book.qbFormat}:${o.position}:${o.lineup.qbClass}`).sort()
    expect(lineupBooks).toEqual(['ONE_QB:QB:ONE_QB', 'ONE_QB:RB:ONE_QB', 'SUPERFLEX:QB:SUPERFLEX', 'SUPERFLEX:RB:SUPERFLEX'])
  })
})
