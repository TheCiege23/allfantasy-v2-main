import { describe, expect, it } from 'vitest'

import {
  backtestNeed,
  backtestPicks,
  backtestPosture,
  cutoffAtShare,
  describeBacktest,
  improvementPct,
  splitAt,
  summarizeErrors,
} from '@/lib/trade-market/learnedMarketBacktest'
import { priorPickValue } from '@/lib/trade-market/pickMarketLearner'

/**
 * The trade-learning backtest (owner's call, 2026-11-22): fit on the earlier trades, then ask which grade predicts what
 * the LATER trades cost. A real effect must make the learned grade closer; a number that was noise must not.
 */

const CUTOFF = new Date('2025-09-01T00:00:00Z')
const before = (i: number) => new Date(CUTOFF.getTime() - (i + 1) * 86_400_000)
const after = (i: number) => new Date(CUTOFF.getTime() + i * 86_400_000)
const wobble = (i: number) => 1 + ((i % 5) - 2) / 100

describe('the parts', () => {
  it('splits strictly before / on-or-after; the default cutoff leaves the newest quarter to test', () => {
    const all = [before(1), CUTOFF, after(3)].map((tradeDate, i) => ({ obs: i, tradeDate }))
    expect(splitAt(all, CUTOFF)).toEqual({ train: [0], test: [1, 2] })
    const dates = Array.from({ length: 8 }, (_, i) => after(i))
    expect(cutoffAtShare(dates)!.getTime()).toBe(after(6).getTime())
    expect(cutoffAtShare([after(1)])).toBeNull()
  })

  it('error summaries and the improvement', () => {
    expect(summarizeErrors([0.3, 0.1, 0.2, Number.NaN])).toEqual({ trades: 3, medianError: 0.2, meanError: 0.2 })
    expect(summarizeErrors([])).toEqual({ trades: 0, medianError: null, meanError: null })
    expect(improvementPct({ trades: 1, medianError: 0.1, meanError: 0.1 }, { trades: 1, medianError: 0.05, meanError: 0.05 })).toBe(50)
  })
})

describe('contend vs rebuild', () => {
  const obs = (buyer: 'contend' | 'middle', ratio: number, n: number, at: (i: number) => Date, tag: string) =>
    Array.from({ length: n }, (_, i) => ({ obs: { transactionId: `${tag}${i}`, buyer, bought: 'veteran' as const, ratio: ratio * wobble(i), weight: 1 }, tradeDate: at(i) }))

  it('a real premium (contenders paid +10% before and after): the learned grade is closer on later trades', () => {
    const all = [...obs('contend', 1.1, 40, before, 'a'), ...obs('middle', 1, 40, before, 'b'), ...obs('contend', 1.1, 30, after, 'c'), ...obs('middle', 1, 30, after, 'd')]
    const r = backtestPosture('DYNASTY:SUPERFLEX', all, CUTOFF)
    const row = r.rows.find((x) => x.row === 'contend:veteran')!
    expect(row.trainPct).toBeCloseTo(10, 0)
    expect(row.sameDirection).toBe(true)
    expect(row.learned.meanError!).toBeLessThan(row.plain.meanError!)
    expect(r.overall.improvementPct!).toBeGreaterThan(50)
    // Middle teams are never moved by posture, so they are not in the "moved" set.
    expect(r.overall.plain.trades).toBe(30)
    expect(describeBacktest(r)).toMatch(/closer to what later trades cost.*1 published row\(s\), 1 held direction, 0 flipped/)
  })

  it('a number that was noise (+12% before, −10% after): the learned grade is worse, and the page says do not trust it', () => {
    const all = [...obs('contend', 1.12, 40, before, 'a'), ...obs('middle', 1, 40, before, 'b'), ...obs('contend', 0.9, 30, after, 'c'), ...obs('middle', 1, 30, after, 'd')]
    const r = backtestPosture('DYNASTY:SUPERFLEX', all, CUTOFF)
    expect(r.overall.improvementPct!).toBeLessThan(0)
    expect(r.rows.find((x) => x.row === 'contend:veteran')!.sameDirection).toBe(false)
    expect(describeBacktest(r)).toMatch(/FURTHER from what later trades cost — do not trust it yet.*1 flipped/)
  })

  it('unpublished earlier (too few trades): the learned grade is the plain one — no difference', () => {
    const all = [...obs('contend', 1.1, 5, before, 'a'), ...obs('middle', 1, 40, before, 'b'), ...obs('contend', 1.1, 30, after, 'c')]
    const r = backtestPosture('DYNASTY:SUPERFLEX', all, CUTOFF)
    expect(r.rows.find((x) => x.row === 'contend:veteran')!.trainPct).toBeNull()
    expect(r.overall.improvementPct).toBe(0)
  })
})

describe('need', () => {
  it('only "short" is tested, as only it is applied', () => {
    const o = (need: 'short' | 'normal' | 'short_this_week', ratio: number, n: number, at: (i: number) => Date, tag: string) =>
      Array.from({ length: n }, (_, i) => ({ obs: { transactionId: `${tag}${i}`, position: 'TE' as const, need, ratio: ratio * wobble(i), weight: 1 }, tradeDate: at(i) }))
    const all = [...o('short', 1.15, 40, before, 'a'), ...o('normal', 1, 40, before, 'b'), ...o('short', 1.15, 30, after, 'c'), ...o('short_this_week', 1.3, 30, after, 'e')]
    const r = backtestNeed('DYNASTY:SUPERFLEX', all, CUTOFF)
    expect(r.rows.map((x) => x.row)).toEqual(['QB:short', 'RB:short', 'WR:short', 'TE:short'])
    expect(r.overall.plain.trades).toBe(30)
    expect(r.overall.improvementPct!).toBeGreaterThan(50)
  })
})

describe('picks', () => {
  // Next-draft firsts really sell at 1.25× the curve, before and after the cutoff.
  const prior = priorPickValue('1:0')
  const trade = (i: number, at: (i: number) => Date, tag: string, mult: number) => ({
    obs: { transactionId: `${tag}${i}`, net: { '1:0': 1 }, y: prior * mult * wobble(i), size: prior * mult * 2 + prior, weight: 1 },
    tradeDate: at(i),
  })

  it('a real pick premium makes the learned grade closer on later trades', () => {
    const all = [...Array.from({ length: 80 }, (_, i) => trade(i, before, 'a', 1.25)), ...Array.from({ length: 30 }, (_, i) => trade(i, after, 'b', 1.25))]
    const r = backtestPicks('DYNASTY:SUPERFLEX', all, CUTOFF)
    const row = r.rows.find((x) => x.row === '1:0')!
    expect(row.trainPct!).toBeGreaterThan(10)
    expect(row.testTrades).toBe(30)
    expect(row.learned.meanError!).toBeLessThan(row.plain.meanError!)
    expect(r.overall.improvementPct!).toBeGreaterThan(0)
  })

  it('a pick premium that reversed later makes the learned grade worse', () => {
    const all = [...Array.from({ length: 80 }, (_, i) => trade(i, before, 'a', 1.3)), ...Array.from({ length: 30 }, (_, i) => trade(i, after, 'b', 0.75))]
    const r = backtestPicks('DYNASTY:SUPERFLEX', all, CUTOFF)
    expect(r.overall.improvementPct!).toBeLessThan(0)
  })
})
