import { describe, expect, it } from 'vitest'

import {
  COMPLETED_MIN_SAMPLE,
  computeCompletedTradeValue,
  type CompletedTradeObservation,
} from '@/lib/trade-market/completedTradeObservations'

/**
 * AllFantasy's own market values, from completed trades. The engine these feed has never written
 * a row: it reads `RedraftTradeProposal` (0 rows) while 7,781 real trades sit in `LeagueTrade`.
 */

let seq = 0
const obs = (observedValue: number): CompletedTradeObservation => ({
  transactionId: `tx${++seq}`,
  playerId: 'p1',
  observedValue,
  season: 2025,
  tradeDate: null,
})

const compute = (values: number[], baseValue = 1000, tierBaselineRatio = 1) =>
  computeCompletedTradeValue({
    playerId: 'p1',
    playerName: 'Test Player',
    position: 'WR',
    baseValue,
    observations: values.map(obs),
    tierBaselineRatio,
  })

describe('computeCompletedTradeValue — what it refuses', () => {
  it('will not move a price on a thin sample', () => {
    const r = compute([2000, 2000, 2000, 2000])
    expect(r.published).toBe(false)
    expect(r.adjustmentPercent).toBe(0)
    // The chart value passes through untouched rather than becoming null.
    expect(r.marketValue).toBe(1000)
  })

  it('counts distinct trades, not observations', () => {
    // The same trade seen twice is one piece of evidence.
    const dup = Array.from({ length: 8 }, () => ({ ...obs(1100), transactionId: 'same' }))
    const r = computeCompletedTradeValue({
      playerId: 'p1', playerName: null, position: null, baseValue: 1000,
      observations: dup, tierBaselineRatio: 1,
    })
    expect(r.sampleSize).toBe(1)
    expect(r.published).toBe(false)
  })
})

describe('computeCompletedTradeValue — the tier baseline', () => {
  it('reads a player who matches his tier as stable, not as falling', () => {
    /*
     * THE CORRECTION. Attribution conserves value in the SUM, so the mean observed/chart ratio is
     * 1.07 — but the median is 0.82, because stars dominate the sum and sit near 1 while the many
     * smaller players sit below it. Measured against a flat 1.0 the median player is charged for
     * his tier: the population came out 147 falling to 56 rising. Against his own tier it is
     * 82/82.
     */
    const r = compute(Array.from({ length: 10 }, () => 820), 1000, 0.82)
    expect(r.published).toBe(true)
    expect(Math.abs(r.adjustmentPercent)).toBeLessThanOrEqual(0.5)
    expect(r.direction).toBe('stable')
  })

  it('still reads a genuine premium as rising, measured against that tier', () => {
    const r = compute(Array.from({ length: 10 }, () => 950), 1000, 0.82)
    expect(r.direction).toBe('rising')
    expect(r.adjustmentPercent).toBeGreaterThan(0)
  })

  it('reads a player the market keeps discounting as falling', () => {
    const r = compute(Array.from({ length: 10 }, () => 700), 1000, 0.82)
    expect(r.direction).toBe('falling')
  })
})

describe('computeCompletedTradeValue — resistance to one lopsided deal', () => {
  it('takes the median, so a single blockbuster does not define a player', () => {
    /*
     * One deal where he is the headline piece implies a value many times his chart price. A mean
     * would let it define him permanently — the manager-tendency work hit exactly this and had to
     * move off the arithmetic mean.
     */
    const steady = Array.from({ length: 9 }, () => 1000)
    const r = compute([...steady, 40000], 1000, 1)
    expect(Math.abs(r.adjustmentPercent)).toBeLessThanOrEqual(0.5)
  })

  it('caps the move by sample tier, because five trades cannot prove a 12% mispricing', () => {
    const thin = compute(Array.from({ length: COMPLETED_MIN_SAMPLE }, () => 5000), 1000, 1)
    expect(thin.adjustmentPercent).toBeLessThanOrEqual(4)
    const thick = compute(Array.from({ length: 20 }, () => 5000), 1000, 1)
    expect(thick.adjustmentPercent).toBeGreaterThan(thin.adjustmentPercent)
    expect(thick.adjustmentPercent).toBeLessThanOrEqual(12)
  })

  it('lowers confidence when the trades disagree with each other', () => {
    const tight = compute(Array.from({ length: 12 }, () => 1000), 1000, 1)
    const wild = compute([100, 3000, 200, 2500, 150, 2800, 300, 2200, 250, 2600, 180, 2400], 1000, 1)
    expect(wild.confidence).toBeLessThan(tight.confidence)
  })
})
