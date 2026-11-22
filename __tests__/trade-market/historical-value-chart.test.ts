import { describe, expect, it } from 'vitest'

import {
  HISTORY_SCALE_MIN_PLAYERS,
  historicalChart,
  loadHistoricalSeries,
  measureHistoricalScale,
  seriesFromFile,
} from '@/lib/trade-market/historicalValueChart'
import { STRUCTURAL_HALF_LIFE_DAYS, structuralWeight } from '@/lib/trade-market/datedMarketLearner'
import { bookKey, gatherFormatObservations } from '@/lib/trade-market/formatMarkets'

/**
 * Trade learning, values for older seasons (owner's call, 2026-11-22): an older dynasty trade, with no FantasyCalc
 * capture near its date, is priced on the committed daily history for its own day — names matched exactly, scaled to
 * FantasyCalc where both charts cover the same days, and never priced on a later chart.
 */

const NOW = new Date('2026-11-22T12:00:00Z')
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`)

describe('a day of the history as a chart', () => {
  const series = seriesFromFile({
    playerValuesByDate: {
      '2023-03-06': { 'A.J. Brown': 8000, 'Kenneth Walker III': 5000, "Ja'Marr Chase": 9000 },
      '2023-03-07': { 'A.J. Brown': 8100 },
    },
  })!

  it('names matched exactly after normalizing; a near miss is not a match; values scaled to FantasyCalc', () => {
    const names: Record<string, string> = { '1': 'AJ Brown', '2': 'Kenneth Walker', '3': "Ja'Marr Chase", '4': 'Nobody' }
    const chart = historicalChart(series, day('2023-03-06'), ['1', '2', '3', '4'], (id) => names[id], 1.25)
    expect([...chart.entries()]).toEqual([['1', 10000], ['3', 11250]])
    expect(series.days).toEqual([day('2023-03-06'), day('2023-03-07')])
  })

  it('the committed series: dynasty 1QB and superflex, daily from 2020-04-01', () => {
    for (const q of ['ONE_QB', 'SUPERFLEX'] as const) {
      const s = loadHistoricalSeries(q)!
      expect(s.days.length).toBeGreaterThan(2000)
      expect(new Date(s.days[0]!).toISOString().slice(0, 10)).toBe('2020-04-01')
      expect(s.valuesOn(s.days[s.days.length - 1]!).size).toBeGreaterThan(100)
    }
    expect(loadHistoricalSeries('ONE_QB', '/nowhere')).toBeNull()
  })
})

describe('the scale to FantasyCalc', () => {
  const pairs = (n: number, ratio: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ hist: 1000 + i * 50, fc: (1000 + i * 50) * ratio(i) }))

  it('one number when the two charts agree; refused when too few players or too scattered', () => {
    expect(measureHistoricalScale(pairs(40, () => 1.2))).toMatchObject({ scale: 1.2, players: 40 })
    expect(measureHistoricalScale(pairs(HISTORY_SCALE_MIN_PLAYERS - 1, () => 1.2)).scale).toBeNull()
    expect(measureHistoricalScale(pairs(40, (i) => (i % 2 ? 0.6 : 1.6))).scale).toBeNull()
    // Values too small to set a scale with are left out.
    expect(measureHistoricalScale([...pairs(40, () => 1.2), ...Array.from({ length: 40 }, () => ({ hist: 100, fc: 900 }))]).scale).toBe(1.2)
  })
})

describe('structural weight', () => {
  it('halves every two years: a 2022 trade still counts for something', () => {
    expect(STRUCTURAL_HALF_LIFE_DAYS).toBe(730)
    expect(structuralWeight(new Date(NOW.getTime() - 730 * 86_400_000), NOW)).toBeCloseTo(0.5, 6)
    expect(structuralWeight(null, NOW)).toBe(0)
  })
})

/**
 * A superflex dynasty league whose only FantasyCalc capture is 2026-02-10, five days after the history ends: 40 players
 * on both, FantasyCalc 1.2× the history. A 2023-03-06 trade has no capture near it, and is priced on that day's history.
 */
function fakePrisma(fcIso = '2026-02-10') {
  const s = loadHistoricalSeries('SUPERFLEX')!
  const last = s.days[s.days.length - 1]!
  const lastDay = s.valuesOn(last)
  const top = [...lastDay.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
  const oldDay = s.valuesOn(day('2023-03-06'))
  const pair = top.filter(([n]) => oldDay.has(n)).slice(0, 2)
  const ids = top.map((_, i) => `p${i}`)
  const nameOf = new Map(top.map(([n], i) => [`p${i}`, n]))
  const fcDay = day(fcIso)
  const given = `p${top.findIndex(([n]) => n === pair[0]![0])}`
  const received = `p${top.findIndex(([n]) => n === pair[1]![0])}`
  const trades = [
    {
      transactionId: 't-2023', historyId: 'h', season: 2022, tradeDate: new Date(day('2023-03-06') + 3_600_000),
      playersGiven: [given], playersReceived: [received], picksGiven: [], picksReceived: [],
    },
    // The rest of the 40 traded in 2019 — before the history begins, so those trades stay unpriced.
    ...Array.from({ length: 20 }, (_, i) => ({
      transactionId: `t-2019-${i}`, historyId: 'h', season: 2019, tradeDate: new Date(day('2019-10-01')),
      playersGiven: [ids[2 * i]!], playersReceived: [ids[2 * i + 1]!], picksGiven: [], picksReceived: [],
    })),
  ]
  return {
    expected: { given: oldDay.get(pair[0]![0])!, received: oldDay.get(pair[1]![0])! },
    db: {
      leagueTrade: { findMany: async () => trades },
      leagueTradeHistory: { findMany: async () => [{ id: 'h', sleeperLeagueId: 'P' }] },
      league: { findMany: async () => [{ id: 'L', platformLeagueId: 'P', leagueType: 'dynasty', settings: { roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'WR', 'TE'] } }] },
      leagueSeason: { findMany: async () => [] },
      leagueDynastySeason: { findMany: async () => [] },
      $queryRaw: async (q: { sql: string; values: unknown[] }) => {
        if (q.sql.includes('date_trunc')) return q.values[0] === 'DYNASTY' && q.values[1] === 'SUPERFLEX' ? [{ day: new Date(fcDay) }] : []
        if (!q.sql.includes('PlayerValueSnapshot')) return []
        const [qids] = q.values as [string[]]
        return qids.map((id) => ({ sleeperId: id, value: Math.round((lastDay.get(nameOf.get(id)!) ?? 1000) * 1.2) }))
      },
      playerValueSnapshot: {
        findMany: async (a: { where: { sleeperId: { in: string[] }; capturedAt: { gte: Date } } }) =>
          a.where.capturedAt.gte.getTime() === fcDay
            ? a.where.sleeperId.in.filter((id) => nameOf.has(id)).map((id) => ({ sleeperId: id, value: Math.round(lastDay.get(nameOf.get(id)!)! * 1.2) }))
            : [],
      },
      // The player table names every id — the trade's two players and the rest of the 40 the scale is measured on.
      sportsPlayer: { findMany: async () => ids.map((id) => ({ sleeperId: id, name: nameOf.get(id)!, position: 'WR', source: 'sleeper', fetchedAt: new Date() })) },
    },
  }
}

describe('an older trade, priced on its own day', () => {
  it('scaled from the overlap, measured as a ratio on 2023-03-06\'s values, and counted', async () => {
    const { db, expected } = fakePrisma()
    const g = await gatherFormatObservations(db as never, { sinceSeason: 2020, now: NOW, env: {} })
    const key = bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' })
    const h = g.historyByBook.get(key)!
    expect(h.scale?.note).toContain('2026-02-10')
    expect(h.scale?.note).toContain('2026-02-05')
    const dated = g.byBookDated.get(key)!
    // The 2019 trades have no chart of their own day anywhere: unpriced, never priced on a later one.
    expect(dated.skipped.no_dated_chart).toBe(20)
    expect(h.scale).toMatchObject({ scale: 1.2, players: 40 })
    expect(h.tradesPriced).toBe(1)
    const obs = [...dated.byPlayer.values()].flatMap((p) => p.observations)
    expect(obs).toHaveLength(2)
    // A ratio is scale-free: the player given was worth what the other side paid, on that day's history.
    const ratios = obs.map((o) => o.ratio).sort((a, b) => a - b)
    expect(ratios[0]).toBeCloseTo(Math.min(expected.given / expected.received, expected.received / expected.given), 2)
  })

  it('no scale from charts too far apart: FantasyCalc first captured four months after the history ends', async () => {
    const { db } = fakePrisma('2026-06-10')
    const g = await gatherFormatObservations(db as never, { sinceSeason: 2020, now: NOW, env: {} })
    const h = g.historyByBook.get(bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }))!
    expect(h.scale).toMatchObject({ scale: null })
    expect(h.scale?.note).toContain('more than 45 days apart')
    expect(h.tradesPriced).toBe(0)
  })

  it('TRADE_HISTORY_CHART=off prices it on nothing, as before', async () => {
    const { db } = fakePrisma()
    const g = await gatherFormatObservations(db as never, { sinceSeason: 2020, now: NOW, env: { TRADE_HISTORY_CHART: 'off' } })
    const key = bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' })
    expect(g.byBookDated.get(key)!.skipped.no_dated_chart).toBe(21)
    expect(g.historyByBook.size).toBe(0)
  })
})
