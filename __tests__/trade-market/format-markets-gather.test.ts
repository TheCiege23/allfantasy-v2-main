import { describe, expect, it } from 'vitest'

import { bookKey, faabBudgetFromSettings, faabForTradeRow, gatherFormatObservations, seasonLeagueRow } from '@/lib/trade-market/formatMarkets'
import { attributeTrade } from '@/lib/trade-market/completedTradeObservations'

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
    // 2024 season of the league that is 1QB TODAY — but that season started four QBs.
    { transactionId: 'old-4qb', historyId: 'h-2024', season: 2024, tradeDate: null, playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] },
  ]
  const histories = [
    { id: 'h-sf', sleeperLeagueId: 'P-SF' },
    { id: 'h-sf-other-side', sleeperLeagueId: 'P-SF' },
    { id: 'h-1qb', sleeperLeagueId: 'P-OLD-1QB' },
    { id: 'h-unknown', sleeperLeagueId: 'P-GONE' },
    { id: 'h-2024', sleeperLeagueId: 'P-2024' },
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
    leagueDynastySeason: {
      findMany: async (a: W) =>
        inList(a, 'platformLeagueId').includes('P-2024')
          ? [{ platformLeagueId: 'P-2024', leagueId: 'L-1QB', metadata: { rosterPositions: ['QB', 'QB', 'QB', 'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'BN'], rawSettings: { type: 2, max_keepers: 0 } } }]
          : [],
    },
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
    expect(g.tradesConsidered).toBe(4)
    expect(g.tradesUsed).toBe(3)
    expect(g.skipped).toMatchObject({ unknown_league_format: 1 })

    const sf = g.byBook.get(bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }))!
    const one = g.byBook.get(bookKey({ format: 'DYNASTY', qbFormat: 'ONE_QB' }))!
    // Superflex chart: QB 6000 for RB 2800 — the QB's base is his SUPERFLEX value.
    expect(sf.byPlayer.get('1')).toMatchObject({ baseValue: 6000 })
    expect(sf.byPlayer.get('1')!.observations[0]!.observedValue).toBe(2800)
    // 1QB chart: the same QB is 2000 there, and that trade never reached the superflex book.
    expect(one.byPlayer.get('1')).toMatchObject({ baseValue: 2000 })
    // The 2024 trade is read on ITS season's four-QB lineup — superflex chart — not on today's 1QB one.
    expect(sf.byPlayer.get('1')!.observations.map((o) => o.transactionId).sort()).toEqual(['old-4qb', 'sf-1'])
    expect(one.byPlayer.get('1')!.observations.map((o) => o.transactionId)).toEqual(['one-1'])

    const lineupBooks = g.lineupObservations.map((o) => `${o.book.qbFormat}:${o.position}:${o.lineup.qbClass}`).sort()
    expect(lineupBooks).toEqual([
      'ONE_QB:QB:ONE_QB', 'ONE_QB:RB:ONE_QB',
      'SUPERFLEX:QB:QB_HEAVY', 'SUPERFLEX:QB:SUPERFLEX', 'SUPERFLEX:RB:QB_HEAVY', 'SUPERFLEX:RB:SUPERFLEX',
    ])
  })
})

describe('seasonLeagueRow — a past season on its own settings', () => {
  const current = { id: 'L', platformLeagueId: 'P-NOW', leagueType: 'redraft', settings: { roster_positions: ['QB', 'RB'], max_keepers: 3, scoring_settings: { rec: 1 } } }
  it('takes that season’s lineup and Sleeper type, keeps everything else from the league', () => {
    const row = seasonLeagueRow(current, 'P-2024', { rosterPositions: ['QB', 'SUPER_FLEX', 'RB'], rawSettings: { type: 2, max_keepers: 0 } })!
    expect(row).toMatchObject({ id: 'L', platformLeagueId: 'P-2024', leagueType: 'dynasty' })
    expect(row.settings).toMatchObject({ roster_positions: ['QB', 'SUPER_FLEX', 'RB'], max_keepers: 0, isDynasty: true, scoring_settings: { rec: 1 } })
  })
  it('reads the `{ position, count }` shape other importers store', () => {
    const row = seasonLeagueRow(current, 'P', { rosterPositions: [{ position: 'QB', count: 2 }, { position: 'TE', count: 2 }] })!
    expect((row.settings as Record<string, unknown>).roster_positions).toEqual(['QB:2', 'TE:2'])
    expect(row.leagueType).toBe('redraft')
  })
  it('is null without a lineup, so the resolver falls through to the next source', () => {
    expect(seasonLeagueRow(current, 'P', { rawSettings: { type: 2 } })).toBeNull()
    expect(seasonLeagueRow(current, 'P', null)).toBeNull()
  })
})

describe('FAAB in the trade market', () => {
  const sides = [
    { faabIn: 35, faabOut: 0, playersInIds: [], playersOutIds: ['7'] },
    { faabIn: 0, faabOut: 35, playersInIds: ['7'], playersOutIds: [] },
  ]

  it('finds this row’s own side by its players and reads its FAAB each way', () => {
    expect(faabForTradeRow({ playersGiven: ['7'], playersReceived: [] }, sides)).toEqual({ given: 0, received: 35 })
    expect(faabForTradeRow({ playersGiven: [], playersReceived: ['7'] }, sides)).toEqual({ given: 35, received: 0 })
  })

  it('makes no claim when FAAB was not recorded or the side cannot be told apart', () => {
    expect(faabForTradeRow({ playersGiven: ['7'], playersReceived: [] }, undefined)).toBeNull()
    expect(faabForTradeRow({ playersGiven: ['9'], playersReceived: [] }, sides)).toBeNull()
    const twins = [{ faabIn: 5, faabOut: 0, playersInIds: [], playersOutIds: [] }, { faabIn: 0, faabOut: 5, playersInIds: [], playersOutIds: [] }]
    expect(faabForTradeRow({ playersGiven: [], playersReceived: [] }, twins)).toBeNull()
  })

  it('a "player for FAAB" trade, once a side worth nothing, now prices the player', () => {
    const t = { playersGiven: ['7'], playersReceived: [], picksGiven: [], picksReceived: [] }
    const chart = new Map([['7', 600]])
    expect(attributeTrade(t, chart)).toEqual({ kind: 'skip', reason: 'side_worth_nothing' })
    const priced = attributeTrade(t, chart, { extraReceived: 630 })
    expect(priced).toEqual({ kind: 'ok', records: [{ id: '7', own: 600, observedValue: 630 }] })
  })

  it('FAAB counts toward its side but is never attributed to a player', () => {
    const t = { playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] }
    const r = attributeTrade(t, new Map([['1', 3000], ['2', 2000]]), { extraReceived: 1000 })
    expect(r).toMatchObject({ kind: 'ok' })
    // Player 2 is half of a 3000 side (2000 + 1000 FAAB), so he is credited with half of 3000, not all of it.
    expect((r as { records: Array<{ id: string; observedValue: number }> }).records.find((x) => x.id === '2')!.observedValue).toBe(2000)
  })

  it('reads the league’s budget under any importer’s name', () => {
    expect(faabBudgetFromSettings({ waiver_budget: 200 })).toBe(200)
    expect(faabBudgetFromSettings({ faabBudget: 1000 })).toBe(1000)
    expect(faabBudgetFromSettings({ waiver_budget: 0 })).toBeNull()
    expect(faabBudgetFromSettings(null)).toBeNull()
  })

  it('the gather prices recorded FAAB and counts what was not recorded', async () => {
    const base = fakePrisma()
    const prisma = {
      ...base,
      leagueTrade: { findMany: async () => [{ transactionId: 'faab-1', historyId: 'h-sf', season: 2026, tradeDate: null, playersGiven: ['2'], playersReceived: [], picksGiven: [], picksReceived: [] }, ...(await base.leagueTrade.findMany())] },
      $queryRaw: async () => [
        { tx: 'faab-1', payload: { faabIn: 50, faabOut: 0, playersInIds: [], playersOutIds: ['2'] } },
        { tx: 'faab-1', payload: { faabIn: 0, faabOut: 50, playersInIds: ['2'], playersOutIds: [] } },
      ],
    }
    const g = await gatherFormatObservations(prisma as never, { sinceSeason: 2024 })
    expect(g.skipped).toMatchObject({ faab_priced: 1 })
    expect(g.skipped.faab_not_recorded).toBeGreaterThan(0)
    const sf = g.byBook.get(bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }))!
    // $50 of a $100 budget is half of the full-budget value (1800) = 900 for the RB.
    expect(sf.byPlayer.get('2')!.observations.find((o) => o.transactionId === 'faab-1')!.observedValue).toBe(900)
  })
})
