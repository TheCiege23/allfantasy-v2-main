import { describe, expect, it } from 'vitest'

import {
  captureDayFor,
  computeDatedBook,
  computeDatedTradeValue,
  datedLearnerLive,
  DATED_HALF_LIFE_DAYS,
  effectiveSample,
  recencyWeight,
  weightedMedian,
  type DatedGather,
} from '@/lib/trade-market/datedMarketLearner'
import { bookKey, gatherFormatObservations, recalculateFormatMarkets } from '@/lib/trade-market/formatMarkets'

/**
 * Trade learning, step 2 (owner's call, 2026-11-22): each completed trade is measured against the chart ON ITS DATE,
 * as a ratio, and recent trades count more — computed in shadow beside the current market until switched live.
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-22T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY)
const utcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())

describe('the pieces', () => {
  it('recent trades count more: the weight halves every half-life; no date, no weight', () => {
    expect(recencyWeight(NOW, NOW)).toBe(1)
    expect(recencyWeight(daysAgo(DATED_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.5, 6)
    expect(recencyWeight(daysAgo(2 * DATED_HALF_LIFE_DAYS), NOW)).toBeCloseTo(0.25, 6)
    expect(recencyWeight(null, NOW)).toBe(0)
  })

  it('a trade is measured on the newest capture on or before it, within two weeks — never a later one', () => {
    const days = [utcDay(daysAgo(40)), utcDay(daysAgo(20)), utcDay(daysAgo(5))]
    expect(captureDayFor(days, daysAgo(10))).toBe(utcDay(daysAgo(20)))
    expect(captureDayFor(days, daysAgo(3))).toBe(utcDay(daysAgo(5)))
    // Before every capture, or more than two weeks after the last one before it: not measured.
    expect(captureDayFor(days, daysAgo(60))).toBeNull()
    expect(captureDayFor([utcDay(daysAgo(40))], daysAgo(20))).toBeNull()
    expect(captureDayFor(days, null)).toBeNull()
  })

  it('weighted median and effective sample', () => {
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 2, weight: 1 }, { value: 9, weight: 5 }])).toBe(9)
    expect(weightedMedian([])).toBeNull()
    expect(effectiveSample([1, 1, 1, 1])).toBeCloseTo(4)
    // Ten trades, nine of them a year stale: worth barely more than the one recent trade.
    expect(effectiveSample([1, ...Array(9).fill(0.06)])).toBeLessThan(2.5)
  })

  it('TRADE_MARKET_LEARNER=dated is the only thing that makes it live', () => {
    expect(datedLearnerLive({ TRADE_MARKET_LEARNER: 'dated' })).toBe(true)
    expect(datedLearnerLive({ TRADE_MARKET_LEARNER: 'current' })).toBe(false)
    expect(datedLearnerLive({})).toBe(false)
  })
})

describe('one player', () => {
  const obs = (ratios: Array<[number, number]>) => ratios.map(([ratio, weight], i) => ({ transactionId: `t${i}`, ratio, weight }))

  it('recent trades decide the price: old trades at par, recent ones at a premium — the market rises', () => {
    const v = computeDatedTradeValue({
      playerId: 'p', playerName: 'A Player', position: 'WR', baseValue: 1000, tierBaselineRatio: 1,
      observations: obs([[1, 0.05], [1, 0.05], [1, 0.05], [1.1, 1], [1.1, 1], [1.1, 1]]),
    })
    expect(v.published).toBe(true)
    expect(v.direction).toBe('rising')
    // Effective sample ≈ 3.3, so the move is capped at the smallest tier however many raw trades there are.
    expect(v.adjustmentPercent).toBe(4)
    expect(v.reasons[0]).toMatch(/measured on the chart of its own day/)
  })

  it('the cap follows the evidence the weights leave: twenty trades, seventeen of them stale, move a price like three', () => {
    const v = computeDatedTradeValue({
      playerId: 'p', playerName: null, position: null, baseValue: 1000, tierBaselineRatio: 1,
      observations: obs([...Array(3).fill([1.3, 1]), ...Array(17).fill([1.3, 0.01])] as Array<[number, number]>),
    })
    // Twenty raw trades would allow ±12%; worth about three recent ones, the move stays at ±4%.
    expect(v).toMatchObject({ published: true, adjustmentPercent: 4 })
  })

  it('below five trades nothing moves; the tier baseline corrects for what players at this value normally fetch', () => {
    expect(computeDatedTradeValue({ playerId: 'p', playerName: null, position: null, baseValue: 1000, tierBaselineRatio: 1, observations: obs([[2, 1], [2, 1]]) })).toMatchObject({ published: false, marketValue: 1000 })
    const atPar = computeDatedTradeValue({ playerId: 'p', playerName: null, position: null, baseValue: 1000, tierBaselineRatio: 0.8, observations: obs(Array(20).fill([0.8, 1])) })
    expect(atPar).toMatchObject({ published: true, adjustmentPercent: 0, direction: 'stable' })
  })

  it('the book comparison: how many each market publishes and the median gap between them', () => {
    const gather: DatedGather = {
      byPlayer: new Map([['p', { name: null, position: null, baseValue: 1000, observations: obs(Array(20).fill([1.05, 1])) }]]),
      tradesUsed: 20,
      skipped: { no_dated_chart: 7 },
    }
    const current = [{ playerId: 'p', playerName: null, position: null, baseValue: 1000, marketValue: 1100, adjustmentPercent: 10, adjustmentPoints: 100, confidence: 80, sampleSize: 20, direction: 'rising' as const, published: true, reasons: [] }]
    const { comparison } = computeDatedBook(gather, current)
    // One player, so his 5% premium IS his tier's baseline: the dated market moves him 0, the current one +10 — a gap of 10.
    expect(comparison).toMatchObject({ published: 1, bothPublished: 1, medianGapPercent: 10, onlyCurrent: 0, onlyDated: 0, skipped: { no_dated_chart: 7 } })
  })
})

/** One superflex dynasty league; a QB has since soared on today's chart, so today's chart misreads the old trade. */
function fakePrisma(extraDated = 0) {
  const recentDay = utcDay(daysAgo(60))
  const writes: Array<{ calculationVersion: string; reasons: string[] }> = []
  const trades = [
    ...Array.from({ length: extraDated }, (_, i) => ({ transactionId: `t-more-${i}`, historyId: 'h', season: 2026, tradeDate: daysAgo(58), playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] })),
    // 60 days ago: QB "1" for RB "2", even on that day's chart.
    { transactionId: 't-dated', historyId: 'h', season: 2026, tradeDate: daysAgo(58), playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] },
    // 400 days ago: no capture anywhere near it.
    { transactionId: 't-old', historyId: 'h', season: 2025, tradeDate: daysAgo(400), playersGiven: ['1'], playersReceived: ['2'], picksGiven: [], picksReceived: [] },
  ]
  const today: Record<string, number> = { '1': 6000, '2': 2800 }
  const onRecentDay: Record<string, number> = { '1': 3000, '2': 3000 }
  return {
    leagueTrade: { findMany: async () => trades },
    leagueTradeHistory: { findMany: async () => [{ id: 'h', sleeperLeagueId: 'P-SF' }] },
    league: { findMany: async () => [{ id: 'L', platformLeagueId: 'P-SF', leagueType: 'dynasty', settings: { roster_positions: ['QB', 'SUPER_FLEX', 'RB', 'WR', 'TE'] } }] },
    leagueSeason: { findMany: async () => [] },
    leagueDynastySeason: { findMany: async () => [] },
    $queryRaw: async (q: { sql: string; values: unknown[] }) => {
      if (q.sql.includes('date_trunc')) return q.values[1] === 'SUPERFLEX' && q.values[0] === 'DYNASTY' ? [{ day: new Date(recentDay) }] : []
      if (!q.sql.includes('PlayerValueSnapshot')) return []
      const [ids, , format, qbFormat] = q.values as [string[], string, string, string]
      return format === 'DYNASTY' && qbFormat === 'SUPERFLEX' ? ids.filter((id) => id in today).map((id) => ({ sleeperId: id, value: today[id] })) : []
    },
    playerValueSnapshot: {
      findMany: async (a: { where: { sleeperId: { in: string[] }; capturedAt: { gte: Date } } }) =>
        a.where.capturedAt.gte.getTime() === recentDay ? a.where.sleeperId.in.map((id) => ({ sleeperId: id, value: onRecentDay[id] })) : [],
    },
    sportsPlayer: {
      findMany: async () => [
        { sleeperId: '1', name: 'A Quarterback', position: 'QB', source: 'sleeper', fetchedAt: new Date() },
        { sleeperId: '2', name: 'A Running Back', position: 'RB', source: 'sleeper', fetchedAt: new Date() },
      ],
    },
    allFantasyMarketPlayerValue: {
      findUnique: async () => null,
      upsert: async (a: { create: { calculationVersion: string; reasons: string[] } }) => {
        writes.push({ calculationVersion: a.create.calculationVersion, reasons: a.create.reasons })
        return { id: 'row', marketValue: 0, adjustmentPercent: 0, confidence: 0, sampleSize: 0 }
      },
    },
    allFantasyMarketValueAudit: { create: async () => ({}) },
    writes,
  }
}

describe('the gather', () => {
  it('measures a trade on its own day\'s chart as a ratio, weights it by age, and leaves out a trade with no capture near it', async () => {
    const g = await gatherFormatObservations(fakePrisma() as never, { sinceSeason: 2024, now: NOW })
    const key = bookKey({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' })
    const dated = g.byBookDated.get(key)!
    const qb = dated.byPlayer.get('1')!
    // Even on that day's chart (3000 for 3000) — where today's chart would call it 2800 paid for a 6000 player.
    expect(qb.observations).toHaveLength(1)
    expect(qb.observations[0]!.ratio).toBeCloseTo(1, 6)
    expect(qb.observations[0]!.weight).toBeCloseTo(Math.pow(0.5, 58 / DATED_HALF_LIFE_DAYS), 6)
    expect(qb.baseValue).toBe(6000)
    expect(dated.skipped).toMatchObject({ no_dated_chart: 1 })
    expect(dated.tradesUsed).toBe(1)
    // The current market is untouched: still measured on today's chart.
    expect(g.byBook.get(key)!.byPlayer.get('1')!.observations.map((o) => o.observedValue).sort()).toEqual([2800, 2800])
  })

  it('shadow by default — the current market is what publishes; TRADE_MARKET_LEARNER=dated publishes the dated one', async () => {
    const shadow = await recalculateFormatMarkets(fakePrisma() as never, { sinceSeason: 2024, dryRun: true, now: NOW, env: {} })
    const live = await recalculateFormatMarkets(fakePrisma() as never, { sinceSeason: 2024, dryRun: true, now: NOW, env: { TRADE_MARKET_LEARNER: 'dated' } })
    const sf = (r: typeof shadow) => r.books.find((b) => b.concept.includes('superflex') || b.book.qbFormat === 'SUPERFLEX')!
    expect(sf(shadow)).toMatchObject({ learner: 'current', tradesUsed: 2 })
    expect(sf(live)).toMatchObject({ learner: 'dated', tradesUsed: 1 })
    expect(sf(shadow).dated).toMatchObject({ tradesUsed: 1, skipped: { no_dated_chart: 1 } })
  })

  it('what is WRITTEN follows the switch: the current market\'s rows in shadow, the dated market\'s rows when live', async () => {
    const shadowDb = fakePrisma(5)
    await recalculateFormatMarkets(shadowDb as never, { sinceSeason: 2024, dryRun: false, writeLineupFactors: false, now: NOW, env: {} })
    const liveDb = fakePrisma(5)
    await recalculateFormatMarkets(liveDb as never, { sinceSeason: 2024, dryRun: false, writeLineupFactors: false, now: NOW, env: { TRADE_MARKET_LEARNER: 'dated' } })
    expect(shadowDb.writes.length).toBeGreaterThan(0)
    expect(shadowDb.writes.every((w) => !w.reasons.join(' ').includes('chart of its own day'))).toBe(true)
    expect(liveDb.writes.length).toBeGreaterThan(0)
    expect(liveDb.writes.every((w) => w.calculationVersion === 'ct3.0-dated' && w.reasons.join(' ').includes('chart of its own day'))).toBe(true)
  })
})
