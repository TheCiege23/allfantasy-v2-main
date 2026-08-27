import { describe, expect, it } from 'vitest'

import {
  CROSS_HALF_PREMIUM_CAP,
  applyCrossHalfNeed,
  crossHalfNeedFactor,
} from '@/lib/franchise/crossHalfNeed'
import type { RosterNeed } from '@/lib/trade-intel/rosterNeed'

/**
 * The scenario this exists for: the manager is thin at running back in Peach
 * Bowl (Sleeper) and there is a college running back on the Cream Bowl (Fantrax)
 * board. Two separate leagues cannot see that. One franchise can.
 *
 * ⚠ AND THE TRAP IT AVOIDS: a naive version marks up EVERY college running back,
 * including freshmen who will not take an NFL snap until the hole has been
 * filled and re-opened twice.
 */

function need(position: string, deficit: number): RosterNeed {
  return {
    byPosition: [{ position, required: 2, have: 2 - deficit, deficit, surplus: 0 }],
    unfilledFlex: 0,
    holes: deficit > 0 ? [position] : [],
  }
}

describe('a pro-side hole lifts a college asset — but only if he arrives in time', () => {
  it('a prospect eligible next draft gets the full premium', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: 0 })
    expect(r.factor).toBeGreaterThan(1)
    expect(r.arrivalWeight).toBe(1)
    expect(r.basis).toMatch(/could fill it almost immediately/)
  })

  /**
   * ⚠ THE CORRECTION THAT MATTERS. The same hole, the same position, a player
   * four years out — the premium is gone.
   */
  it('the same hole does nothing for a player four years away', () => {
    const near = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: 0 })
    const far = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: 4 })

    expect(far.arrivalWeight).toBe(0)
    expect(far.factor).toBe(1)
    expect(near.factor!).toBeGreaterThan(far.factor!)
    expect(far.basis).toMatch(/says nothing about him/)
  })

  it('the premium decays monotonically with the wait', () => {
    const f = [0, 1, 2, 3, 4].map(
      (y) => crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: y }).factor!,
    )
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeLessThanOrEqual(f[i - 1])
  })

  it('a bigger hole is worth more, up to a cap', () => {
    const small = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 1), arrivalYears: 0 })
    const big = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 9), arrivalYears: 0 })
    expect(big.factor!).toBeGreaterThan(small.factor!)
    expect(big.factor! - 1).toBeLessThanOrEqual(CROSS_HALF_PREMIUM_CAP + 1e-9)
  })
})

describe('what it reports rather than assumes', () => {
  /**
   * ⚠ A SET ROSTER IS A FINDING, NOT AN ABSENCE. Factor 1 here means "we looked
   * and there is no hole", which is different from "we could not look".
   */
  it('no hole gives factor 1 and says the roster is set', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 0), arrivalYears: 0 })
    expect(r.factor).toBe(1)
    expect(r.basis).toMatch(/not short at RB/)
  })

  /**
   * ⚠ NULL, NOT 1.0. Returning 1.0 would claim we checked the pro roster and
   * found it made no difference.
   */
  it('an unreadable pro side gives null, not a neutral 1', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: null, arrivalYears: 0 })
    expect(r.factor).toBeNull()
    expect(r.gaps.join(' ')).toMatch(/could not read the pro side/)
  })

  it('an unknown eligibility year gives null rather than assuming he is close', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: null })
    expect(r.factor).toBeNull()
    expect(r.gaps.join(' ')).toMatch(/cannot tell whether he arrives in time/)
  })

  it('a position the pro side does not want gets no premium', () => {
    const r = crossHalfNeedFactor({ position: 'TE', proNeed: need('RB', 3), arrivalYears: 0 })
    expect(r.factor).toBe(1)
    expect(r.proDeficit).toBe(0)
  })

  /**
   * ⚠ We price against a roster that will have turned over by the time he plays.
   */
  it('always says the premium rests on today shape, not a forecast', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: 1 })
    expect(r.gaps.join(' ')).toMatch(/age, contracts and pending free agency/)
  })

  it('never claims to convert him into market units', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: 0 })
    expect(r.gaps.join(' ')).toMatch(/does not price him in the units used for NFL players/)
  })
})

describe('applyCrossHalfNeed', () => {
  it('lifts a ranked asset', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: 0 })
    expect(applyCrossHalfNeed(500, r)).toBeGreaterThan(500)
  })

  /**
   * ⚠ A need premium on an unknown quantity would manufacture a number out of a
   * roster hole.
   */
  it('leaves an unranked asset unranked', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: need('RB', 2), arrivalYears: 0 })
    expect(applyCrossHalfNeed(null, r)).toBeNull()
  })

  it('leaves the value untouched when the need could not be computed', () => {
    const r = crossHalfNeedFactor({ position: 'RB', proNeed: null, arrivalYears: 0 })
    expect(applyCrossHalfNeed(500, r)).toBe(500)
  })
})
