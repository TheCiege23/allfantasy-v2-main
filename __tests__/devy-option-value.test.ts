import { describe, it, expect } from 'vitest'
import {
  devyOptionValue,
  DEVY_MARKET_SCALE,
  OBSERVED_BOARD_TO_PICK_CURVE_RATIO,
} from '@/lib/devy/devyOptionValue'

const SEASON = 2026

describe('devyOptionValue', () => {
  it('prices a well-sampled cohort in board units', () => {
    const out = devyOptionValue({
      position: 'WR',
      recruitingStars: 4,
      draftEligibleYear: 2028,
      currentSeason: SEASON,
      name: 'Test Receiver',
    })
    expect(out.scale).toBe(DEVY_MARKET_SCALE)
    expect(out.value).not.toBeNull()
    expect(out.value!).toBeGreaterThan(0)
    expect(out.missing).toEqual([])
    // value = P x E x discount, and every factor is reported so it can be checked.
    expect(out.value).toBe(
      Math.round(out.pDrafted! * out.arrivalValue! * out.horizonDiscount!),
    )
  })

  /*
   * ⚠ THE FIVE-STAR HOLE, AND WHAT CLOSED IT. On stars alone a 5-star cannot be
   * priced: those cells hold 18-31 recruits against a minSample of 50, so the
   * BEST prospects returned null. The composite band 0.95+ holds 123 WRs, so the
   * same player prices once his composite is supplied. Both halves are asserted,
   * because the fallback silently answering would hide which table was used.
   */
  it('cannot price a 5-star on stars alone', () => {
    const out = devyOptionValue({
      position: 'WR', recruitingStars: 5, draftEligibleYear: 2028, currentSeason: SEASON,
    })
    expect(out.value).toBeNull()
    expect(out.pSource).toBeNull()
    expect(out.basis).toMatch(/not a low value/)
  })

  it('prices that same 5-star once a composite is supplied', () => {
    const out = devyOptionValue({
      position: 'WR', recruitingStars: 5, recruitingComposite: 0.97,
      draftEligibleYear: 2028, currentSeason: SEASON,
    })
    expect(out.value).not.toBeNull()
    expect(out.pSource).toBe('composite')
    expect(out.pSampleSize!).toBeGreaterThanOrEqual(50)
  })

  /*
   * ⚠ AND THE HOLE IS NOT CLOSED EVERYWHERE. TE's 0.95+ band holds 22 recruits,
   * still under the floor. It must stay null rather than borrow another
   * position's rate — an elite tight end is rare, not average.
   */
  it('still declines where the composite band is itself too thin', () => {
    const out = devyOptionValue({
      position: 'TE', recruitingStars: 5, recruitingComposite: 0.97,
      draftEligibleYear: 2028, currentSeason: SEASON,
    })
    expect(out.value).toBeNull()
  })

  it('prefers the composite over the star bucket and says which it used', () => {
    const composite = devyOptionValue({
      position: 'WR', recruitingStars: 4, recruitingComposite: 0.93,
      draftEligibleYear: 2028, currentSeason: SEASON,
    })
    const starsOnly = devyOptionValue({
      position: 'WR', recruitingStars: 4, draftEligibleYear: 2028, currentSeason: SEASON,
    })
    expect(composite.pSource).toBe('composite')
    expect(starsOnly.pSource).toBe('stars')
    // The whole point of the calibration: a high-composite 4-star is not priced
    // the same as the bucket average.
    expect(composite.value!).toBeGreaterThan(starsOnly.value!)
  })

  /*
   * ⚠ THE SEPARATION THE CALIBRATION WAS ADOPTED FOR. Two 4-star receivers at
   * opposite ends of the bucket must not price alike. If these converge, the
   * composite has stopped being read and the module is back to stars.
   */
  it('separates two players who share a star rating', () => {
    const hi = devyOptionValue({
      position: 'WR', recruitingStars: 4, recruitingComposite: 0.93,
      draftEligibleYear: 2028, currentSeason: SEASON,
    })
    const lo = devyOptionValue({
      position: 'WR', recruitingStars: 4, recruitingComposite: 0.87,
      draftEligibleYear: 2028, currentSeason: SEASON,
    })
    expect(hi.value!).toBeGreaterThan(lo.value! * 2)
  })

  it('names each missing factor rather than returning a bare null', () => {
    const out = devyOptionValue({
      position: 'WR',
      recruitingStars: 4,
      draftEligibleYear: null,
      currentSeason: SEASON,
    })
    expect(out.value).toBeNull()
    expect(out.missing).toContain('draftEligibleYear')
    // The factors that WERE measured are still reported, so a caller can see
    // which half of the estimate exists.
    expect(out.pDrafted).not.toBeNull()
    expect(out.arrivalValue).not.toBeNull()
  })

  it('discounts a longer wait strictly harder', () => {
    const near = devyOptionValue({
      position: 'RB', recruitingStars: 4, draftEligibleYear: 2026, currentSeason: SEASON,
    })
    const far = devyOptionValue({
      position: 'RB', recruitingStars: 4, draftEligibleYear: 2029, currentSeason: SEASON,
    })
    expect(near.value!).toBeGreaterThan(far.value!)
  })

  /*
   * ⚠ THE ORDERING THAT PROVES THE BASE RATE IS DOING THE WORK. A 4-star is
   * drafted several times more often than a 2-star, so the option must price
   * far apart even though both share an arrival value. If these ever converge,
   * P has stopped being read.
   */
  it('separates star tiers by a wide margin', () => {
    const four = devyOptionValue({
      position: 'WR', recruitingStars: 4, draftEligibleYear: 2028, currentSeason: SEASON,
    })
    const two = devyOptionValue({
      position: 'WR', recruitingStars: 2, draftEligibleYear: 2028, currentSeason: SEASON,
    })
    expect(four.value!).toBeGreaterThan(two.value! * 5)
  })

  it('refuses to price an unknown position', () => {
    const out = devyOptionValue({
      position: 'CB', recruitingStars: 4, draftEligibleYear: 2028, currentSeason: SEASON,
    })
    expect(out.value).toBeNull()
  })

  /*
   * The pick-curve gap is recorded as data, never applied. If someone later
   * exports a conversion, this is the line that should make them justify it.
   */
  it('records the pick-curve ratio without exposing a conversion', async () => {
    expect(OBSERVED_BOARD_TO_PICK_CURVE_RATIO.measuredRatios.length).toBe(3)
    expect(OBSERVED_BOARD_TO_PICK_CURVE_RATIO.caveat).toMatch(/[Nn]ot a sanctioned conversion/)
    const mod: Record<string, unknown> = await import('@/lib/devy/devyOptionValue')
    const converters = Object.keys(mod).filter((k) => /toPick|toMarket|convert/i.test(k))
    expect(converters).toEqual([])
  })

  /*
   * ⚠ PRODUCTION OUTRANKS RECRUITING, WHICH IS THE WHOLE POINT OF THE
   * CALIBRATION. A modest recruit who produces must out-price a blue-chip who
   * has not. If this ever inverts, the hierarchy has been reordered.
   */
  it('lets production override recruiting rank', () => {
    const producedWell = devyOptionValue({
      position: 'WR', recruitingStars: 3, recruitingComposite: 0.82,
      ppaSeasonTotal: 90, draftEligibleYear: 2027, currentSeason: SEASON,
    })
    const blueChipNoSnaps = devyOptionValue({
      position: 'WR', recruitingStars: 5, recruitingComposite: 0.97,
      draftEligibleYear: 2027, currentSeason: SEASON,
    })
    expect(producedWell.pSource).toBe('production')
    expect(blueChipNoSnaps.pSource).toBe('composite')
    expect(producedWell.value!).toBeGreaterThan(blueChipNoSnaps.value!)
  })

  it('moves as production accumulates', () => {
    const at = (ppa: number | null) =>
      devyOptionValue({
        position: 'RB', recruitingStars: 4, recruitingComposite: 0.9,
        ppaSeasonTotal: ppa, draftEligibleYear: 2027, currentSeason: SEASON,
      }).value!
    // The signal that makes a devy value live rather than static.
    expect(at(50)).toBeGreaterThan(at(15))
    expect(at(15)).toBeGreaterThan(at(2))
  })

  /*
   * ⚠ NO PRODUCTION FALLS BACK, IT DOES NOT SCORE ZERO. In the historical cohort
   * a peak of zero means a finished career with nothing in it; for a freshman it
   * means "not yet". Reading the second as the first would price every incoming
   * player as a resolved bust.
   */
  it('falls back to recruiting rather than reading no-production as a bust', () => {
    const freshman = devyOptionValue({
      position: 'RB', recruitingStars: 4, recruitingComposite: 0.92,
      ppaSeasonTotal: 0, draftEligibleYear: 2029, currentSeason: SEASON,
    })
    expect(freshman.pSource).toBe('composite')
    expect(freshman.value).not.toBeNull()
    expect(freshman.value!).toBeGreaterThan(0)
  })

  /*
   * ⚠ THE SCALE GUARD. `ppaTotal` (per-play average, ~0.7) is a different
   * quantity from `ppaSeasonTotal` (season sum, 20-400). Passing the wrong one
   * puts every player in the bottom quintile — uniformly, so nothing looks
   * broken. A per-play value must never reach the top of the table.
   */
  it('does not treat a per-play average as a season total', () => {
    const perPlayByMistake = devyOptionValue({
      position: 'WR', recruitingStars: 4, recruitingComposite: 0.93,
      ppaSeasonTotal: 0.73, draftEligibleYear: 2027, currentSeason: SEASON,
    })
    const realSeasonTotal = devyOptionValue({
      position: 'WR', recruitingStars: 4, recruitingComposite: 0.93,
      ppaSeasonTotal: 73, draftEligibleYear: 2027, currentSeason: SEASON,
    })
    expect(realSeasonTotal.value!).toBeGreaterThan(perPlayByMistake.value! * 10)
  })
})
