import { describe, expect, it } from 'vitest'

import {
  DEVY_FIRST_PICK_VALUE,
  DEVY_POINTS,
  devyAssetValue,
  devyShareAtRank,
  gradeDevyTrade,
  rankDevyPool,
  type DevyTradeSide,
} from '@/lib/trade-intel/devyTradeValue'
import { projectDevyOutlook } from '@/lib/trade-intel/devyOutlook'

/**
 * The scenario: a devy manager is offered two mid-board prospects for his best
 * one. Every instinct says "two for one is fine". A model that adds ordinal
 * standings agrees with him, because 50 + 50 beats 95. A model with a convex
 * curve does not, and it is right — that is the whole reason this module exists
 * rather than devyOutlook's 0-100 being summed directly.
 */

const SEASON = 2026

function outlookFor(overrides: Record<string, unknown> = {}, eligible = 2028) {
  return projectDevyOutlook({
    player: { recruitingComposite: 0.95, projectedDraftRound: 1, ...overrides },
    draftEligibleYear: eligible,
    currentSeason: SEASON,
  })
}

const OUTLOOK = outlookFor()
/** Same player, no wait — isolates the curve from the horizon discount. */
const NO_WAIT = outlookFor({}, SEASON)

function valueAt(rank: number | null, outlook = NO_WAIT) {
  return devyAssetValue({ devyRank: rank, outlook })
}

describe('the curve is convex, which is the point', () => {
  it('the top devy asset is worth more than two mid-board ones combined', () => {
    const elite = valueAt(1).value!
    const midA = valueAt(30).value!
    const midB = valueAt(34).value!

    expect(elite).toBeGreaterThan(midA + midB)
  })

  it('value falls as rank falls, and never goes negative', () => {
    const ranks = [1, 13, 25, 37, 49, 200]
    const values = ranks.map((r) => valueAt(r).value!)

    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1])
    }
    expect(Math.min(...values)).toBeGreaterThan(0)
  })

  it('the top asset anchors the scale', () => {
    expect(valueAt(1).value).toBe(DEVY_FIRST_PICK_VALUE)
  })

  /**
   * ⚠ The pick curve holds its last observed share past round 5 rather than
   * extrapolating to zero, so a deep prospect keeps a floor instead of becoming
   * free.
   */
  it('a deep prospect keeps a floor rather than decaying to nothing', () => {
    expect(valueAt(5000).value).toBe(valueAt(60).value)
  })
})

describe('the curve interpolates within a round', () => {
  /**
   * ⚠ THE BUG THIS REPLACED. Reading pickRoundShare directly made ranks 1-12 all
   * worth exactly the top value, so the best prospect on the board priced
   * identically to the twelfth — discarding the one signal we actually have.
   */
  it('does not flatten the top of the board', () => {
    expect(valueAt(1).value!).toBeGreaterThan(valueAt(12).value!)
    expect(valueAt(2).value!).toBeGreaterThan(valueAt(6).value!)
  })

  it('hits the measured round anchors exactly at each boundary', () => {
    // 1, 0.48, 0.24 are the fitted shares in lib/pick-curve.ts.
    expect(devyShareAtRank(1)).toBeCloseTo(1, 10)
    expect(devyShareAtRank(13)).toBeCloseTo(0.48, 10)
    expect(devyShareAtRank(25)).toBeCloseTo(0.24, 10)
    expect(devyShareAtRank(37)).toBeCloseTo(0.128, 10)
  })

  it('is monotone across the whole board, with no step back up', () => {
    for (let r = 2; r <= 200; r++) {
      expect(devyShareAtRank(r)).toBeLessThanOrEqual(devyShareAtRank(r - 1))
    }
  })

  it('flattens past the deepest observed round rather than extrapolating to zero', () => {
    expect(devyShareAtRank(60)).toBeCloseTo(devyShareAtRank(500), 10)
  })
})

describe('devy points are not market units', () => {
  it('tags every result with the devy-points scale', () => {
    expect(valueAt(1).scale).toBe(DEVY_POINTS)
    expect(DEVY_POINTS).not.toBe('fantasycalc')
  })

  /**
   * ⚠ THE REGRESSION THAT WOULD BE SILENT. 950 is FIRST_ROUND_IN_MARKET_UNITS.
   * If the anchor is ever "helpfully" aligned to it, devy assets acquire a
   * market price nobody measured and the whole separate-scale decision is
   * undone without a single test failing elsewhere.
   */
  it('the anchor is deliberately not the market first-round constant', () => {
    expect(DEVY_FIRST_PICK_VALUE).not.toBe(950)
  })

  it('always names the borrowed curve and the missing market', () => {
    const gaps = valueAt(1).gaps.join(' ')
    expect(gaps).toMatch(/borrowed from the NFL rookie-pick curve/)
    expect(gaps).toMatch(/no market prices college players/)
    expect(valueAt(1).basis).toMatch(/convert to nothing else/)
  })
})

describe('an unranked player is not a worthless one', () => {
  it('prices null, never zero', () => {
    const v = valueAt(null)
    expect(v.value).toBeNull()
    expect(v.devyRank).toBeNull()
    expect(v.basis).toMatch(/not a low valuation/)
  })

  it('rankDevyPool leaves unscored players unranked rather than last', () => {
    const pool = [
      { item: 'known-good', outlook: { score: 90 } },
      { item: 'unknown', outlook: { score: null } },
      { item: 'known-ok', outlook: { score: 40 } },
    ]
    const ranked = rankDevyPool(pool)

    expect(ranked.find((r) => r.item === 'known-good')!.devyRank).toBe(1)
    expect(ranked.find((r) => r.item === 'known-ok')!.devyRank).toBe(2)
    expect(ranked.find((r) => r.item === 'unknown')!.devyRank).toBeNull()
  })
})

describe('the wait is priced on top of the curve', () => {
  it('the same rank is worth less the further out he is', () => {
    const near = devyAssetValue({ devyRank: 1, outlook: outlookFor({}, SEASON) })
    const far = devyAssetValue({ devyRank: 1, outlook: outlookFor({}, SEASON + 3) })

    expect(near.value!).toBeGreaterThan(far.value!)
  })

  it('reports the discount separately, so both terms are visible', () => {
    const v = devyAssetValue({ devyRank: 1, outlook: OUTLOOK })
    expect(v.timeDiscount).toBe(OUTLOOK.timeDiscount)
    expect(v.boardRound).toBe(1)
  })
})

describe('gradeDevyTrade', () => {
  const side = (label: string, rank: number | null): DevyTradeSide => ({
    label,
    value: valueAt(rank),
  })

  it('one elite prospect beats two mid ones, which raw standings would get backwards', () => {
    const v = gradeDevyTrade({
      give: [side('Elite WR', 1)],
      get: [side('Mid RB', 30), side('Mid TE', 34)],
    })

    expect(v.conclusive).toBe(true)
    expect(v.net).toBeLessThan(0)
    expect(v.basis).toMatch(/You give up \d+ devy points/)
  })

  it('a level deal reports level', () => {
    const v = gradeDevyTrade({ give: [side('A', 5)], get: [side('B', 5)] })
    expect(v.net).toBe(0)
    expect(v.basis).toMatch(/level/)
  })

  /**
   * ⚠ THE FAILURE THIS GUARDS. An unpriced side sums to 0, which reads as "he
   * gave up nothing" and reports the other side as a free win — the same defect
   * as grading a trade C off zero points.
   */
  it('refuses a verdict when one whole side is unranked', () => {
    const v = gradeDevyTrade({
      give: [side('Unknown A', null), side('Unknown B', null)],
      get: [side('Ranked', 3)],
    })

    expect(v.conclusive).toBe(false)
    expect(v.basis).toMatch(/No verdict/)
    expect(v.basis).toMatch(/free win/)
    expect(v.giveUnpriced).toEqual(['Unknown A', 'Unknown B'])
  })

  it('still grades when only some assets are unranked, and says how many', () => {
    const v = gradeDevyTrade({
      give: [side('Ranked A', 1)],
      get: [side('Ranked B', 20), side('Unknown', null)],
    })

    expect(v.conclusive).toBe(true)
    expect(v.getUnpriced).toEqual(['Unknown'])
    expect(v.basis).toMatch(/1 player in this deal could not be ranked/)
  })

  it('carries the gaps up from every asset without duplicating them', () => {
    const v = gradeDevyTrade({ give: [side('A', 1)], get: [side('B', 2)] })
    expect(v.gaps).toEqual([...new Set(v.gaps)])
    expect(v.gaps.join(' ')).toMatch(/borrowed from the NFL rookie-pick curve/)
  })
})
