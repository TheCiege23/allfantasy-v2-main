import { describe, expect, it } from 'vitest'

import {
  FIRST_ROUND_IN_MARKET_UNITS,
  PICK_ROUND_SHARE,
  pickRoundShare,
  pickRoundTable,
  pickRoundValue,
} from '@/lib/pick-curve'
import { PICK_ROUND_BASE } from '@/lib/trade-value/valueEngine'
import { PICK_BASE_VALUES } from '@/lib/dynasty-tiers'

/**
 * Five curves, one shape.
 *
 * The defect was never that any single curve was indefensible — it was that five of them
 * answered the same question differently, so the same dynasty trade graded two ways depending
 * on which module a caller imported. These pin the shape in one place and pin that each
 * module keeps its own scale.
 */

describe('pick-curve — the canonical shape', () => {
  it('decays monotonically and never goes negative', () => {
    /*
     * The free least-squares fit over 771 real trades returned a fourth round worth MORE than
     * a third and a fifth worth less than nothing. A later pick cannot beat an earlier one in
     * the same draft, and that is a property the shipped curve must have by construction
     * rather than by luck.
     */
    let prev = Infinity
    for (let r = 1; r <= 8; r++) {
      const share = pickRoundShare(r)
      expect(share).toBeGreaterThan(0)
      expect(share).toBeLessThanOrEqual(prev)
      prev = share
    }
  })

  it('anchors the first round at 1 and matches the measured shape', () => {
    expect(PICK_ROUND_SHARE[1]).toBe(1)
    expect(PICK_ROUND_SHARE[2]).toBeCloseTo(0.48, 3)
    expect(PICK_ROUND_SHARE[3]).toBeCloseTo(0.24, 3)
  })

  it('holds the last observed round rather than extrapolating past the data', () => {
    // Rounds beyond 5 were never observed in the 771 trades; inventing a decay there would be
    // a number with nothing behind it.
    expect(pickRoundShare(6)).toBe(pickRoundShare(5))
    expect(pickRoundShare(40)).toBe(pickRoundShare(5))
  })

  it('scales into whatever units the caller speaks', () => {
    expect(pickRoundValue(1, 2500)).toBe(2500)
    expect(pickRoundValue(2, 2500)).toBe(1200)
    expect(pickRoundValue(1, 100)).toBe(100)
    expect(pickRoundValue(2, 100)).toBe(48)
  })

  it('emits a round-keyed table for modules that hold one as a constant', () => {
    expect(pickRoundTable(650, 4)).toEqual({ 1: 650, 2: 312, 3: 156, 4: 83 })
  })
})

describe('pick-curve — every dynasty module now shares it', () => {
  it('leaves the canonical trade engine byte-identical', () => {
    /*
     * `valueEngine` was the best-fitting of the five and became the shape, so collapsing must
     * not have moved it. If this ever fails, the shape was changed without anyone noticing
     * that the trade path moved with it.
     */
    expect(PICK_ROUND_BASE).toEqual({ 1: 2500, 2: 1200, 3: 600, 4: 320, 5: 180 })
  })

  it('moves dynasty-tiers onto the shared shape, which is a real change', () => {
    /*
     * This was the steepest curve of the five: a second round at 0.277 of a first against the
     * canonical 0.48. Mid-round picks were under-priced here relative to every other surface,
     * and the correction is deliberate rather than incidental.
     */
    expect(PICK_BASE_VALUES[1]).toBe(650)
    expect(PICK_BASE_VALUES[2]).toBe(312)
    expect(PICK_BASE_VALUES[2] / PICK_BASE_VALUES[1]).toBeCloseTo(0.48, 3)
    // The old value, kept here so the size of the move stays legible.
    expect(PICK_BASE_VALUES[2]).not.toBe(180)
  })

  it('keeps each module anchored to its own first-round scale', () => {
    // Shape is shared; denomination is a local decision and must not have been unified.
    expect(PICK_ROUND_BASE[1]).toBe(2500)
    expect(PICK_BASE_VALUES[1]).toBe(650)
  })

  it('carries a measured pick-to-player exchange rate', () => {
    // ~950 FantasyCalc dynasty units, solved from the same 771 trades.
    expect(FIRST_ROUND_IN_MARKET_UNITS).toBeGreaterThan(500)
    expect(FIRST_ROUND_IN_MARKET_UNITS).toBeLessThan(2000)
  })
})
