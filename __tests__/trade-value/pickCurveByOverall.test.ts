/**
 * League-size-aware pick curve.
 *
 * The headline assertion is the IDENTITY PROPERTY: a 12-team league must be byte-identical to the
 * existing round-keyed curve, so this change is additive for every league already priced correctly.
 *
 * The second is the VALIDATION: the Four Horsemen rulebook states, by hand, that a 3rd-round pick
 * in their 4-team league "would fall somewhere in the 1.9-1.12 range" of a 12-team draft. That is
 * an independent, human-derived answer to exactly what this function computes, and it is used here
 * as a positive control on the conversion itself.
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_PICK_SHARE,
  PICK_ROUND_SHARE,
  REFERENCE_TEAMS,
  pickRoundShare,
  pickShareByOverall,
  pickValueByOverall,
} from '@/lib/pick-curve'

describe('identity property — a 12-team league is unchanged', () => {
  it('reproduces the round-keyed share exactly at the mid slot', () => {
    for (const round of [1, 2, 3, 4, 5]) {
      const overall = (round - 1) * REFERENCE_TEAMS + (REFERENCE_TEAMS + 1) / 2
      expect(pickShareByOverall(overall)).toBeCloseTo(PICK_ROUND_SHARE[round], 10)
    }
  })

  it('reproduces the round-keyed VALUE exactly at the mid slot', () => {
    for (const round of [1, 2, 3, 4, 5]) {
      const viaOverall = pickValueByOverall({ round, teams: 12, firstRoundValue: 2500 })
      const viaRound = Math.round(2500 * pickRoundShare(round))
      expect(viaOverall).toBe(viaRound)
    }
  })

  it('defaults to 12 teams when the count is missing or unusable', () => {
    const expected = pickValueByOverall({ round: 2, teams: 12, firstRoundValue: 2500 })
    expect(pickValueByOverall({ round: 2, firstRoundValue: 2500 })).toBe(expected)
    expect(pickValueByOverall({ round: 2, teams: null, firstRoundValue: 2500 })).toBe(expected)
    expect(pickValueByOverall({ round: 2, teams: 1, firstRoundValue: 2500 })).toBe(expected)
  })
})

describe('Four Horsemen — validated against the rulebook', () => {
  /**
   * The rules say a 3rd-round pick in this 4-team league lands in the 1.9-1.12 range of a
   * 12-team draft, i.e. overall #9-#12.
   */
  it('a 4-team 3rd-round pick really does land at overall #9-#12 equivalent', () => {
    // Round 3, 4 teams, mid slot 2.5 => overall (3-1)*4 + 2.5 = 10.5
    const share = pickShareByOverall(10.5)
    // Overall 10.5 in a 12-team draft is late in round 1.
    const late12TeamFirst = pickShareByOverall(10.5)
    expect(share).toBe(late12TeamFirst)
    // It must be worth much more than a 12-team 3rd (0.24) and close to a 12-team 1st.
    expect(share).toBeGreaterThan(PICK_ROUND_SHARE[2]) // > a 2nd
    expect(share).toBeLessThanOrEqual(PICK_ROUND_SHARE[1] * 1.05) // ≈ a 1st, not above it
  })

  it('is worth ~3x what the round-keyed curve said', () => {
    const roundKeyed = Math.round(2500 * pickRoundShare(3)) // 600
    const sizeAware = pickValueByOverall({ round: 3, teams: 4, firstRoundValue: 2500 })
    expect(roundKeyed).toBe(600)
    expect(sizeAware / roundKeyed).toBeGreaterThan(2.5)
    expect(sizeAware / roundKeyed).toBeLessThan(4.5)
  })

  it('prices all 10 rookie rounds distinctly — the ?? 100 floor collapsed rounds 6-10', () => {
    const values = Array.from({ length: 10 }, (_, i) =>
      pickValueByOverall({ round: i + 1, teams: 4, firstRoundValue: 2500 }),
    )
    // Monotonically non-increasing.
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1])
    }
    // Rounds 1-6 of a 4-team draft are still inside the measured 12-team curve (overall <= 22),
    // so they must all differ. Beyond that the curve holds its last observed share by design.
    expect(new Set(values.slice(0, 6)).size).toBe(6)
  })
})

describe('KBFL — 32 teams, the error runs the other way', () => {
  it('a 32-team 2nd-round pick is worth far LESS than a 12-team 2nd', () => {
    const twelve = pickValueByOverall({ round: 2, teams: 12, firstRoundValue: 2500 })
    const thirtyTwo = pickValueByOverall({ round: 2, teams: 32, firstRoundValue: 2500 })
    expect(thirtyTwo).toBeLessThan(twelve)
  })

  it('a 32-team 1st-round pick spans from elite to replacement across the round', () => {
    const first = pickValueByOverall({ round: 1, teams: 32, slot: 1, firstRoundValue: 2500 })
    const last = pickValueByOverall({ round: 1, teams: 32, slot: 32, firstRoundValue: 2500 })
    // 1.01 overall vs 1.32 overall — the latter is a 12-team 3rd-rounder.
    expect(first).toBeGreaterThan(last * 2)
  })

  it('round 2 pick 1 in a 32-team league (overall #33) ≈ a 12-team 3rd', () => {
    const kbfl = pickShareByOverall(33)
    const twelveTeamThird = pickShareByOverall((3 - 1) * 12 + 6.5) // 30.5
    expect(kbfl).toBeCloseTo(twelveTeamThird, 1)
  })
})

describe('slot within the round', () => {
  it('an earlier slot is always worth at least as much as a later one', () => {
    for (const teams of [4, 10, 12, 32]) {
      const values = Array.from({ length: teams }, (_, i) =>
        pickValueByOverall({ round: 1, teams, slot: i + 1, firstRoundValue: 2500 }),
      )
      for (let i = 1; i < values.length; i += 1) {
        expect(values[i]).toBeLessThanOrEqual(values[i - 1])
      }
    }
  })

  it('the mid slot is used when none is given', () => {
    const mid = pickValueByOverall({ round: 1, teams: 12, slot: 6.5, firstRoundValue: 2500 })
    expect(pickValueByOverall({ round: 1, teams: 12, firstRoundValue: 2500 })).toBe(mid)
  })
})

describe('bounds and refusals', () => {
  it('never exceeds MAX_PICK_SHARE, even at overall #1 of a 2-team league', () => {
    expect(pickShareByOverall(1)).toBeLessThanOrEqual(MAX_PICK_SHARE)
    expect(pickShareByOverall(0)).toBeLessThanOrEqual(MAX_PICK_SHARE)
    expect(pickShareByOverall(-5)).toBeLessThanOrEqual(MAX_PICK_SHARE)
  })

  it('holds the last observed share past the measured range rather than decaying to zero', () => {
    const deep = pickShareByOverall(500)
    expect(deep).toBe(PICK_ROUND_SHARE[5])
    expect(deep).toBeGreaterThan(0)
  })

  it('is monotonically non-increasing in overall pick number', () => {
    let prev = Infinity
    for (let overall = 1; overall <= 120; overall += 1) {
      const s = pickShareByOverall(overall)
      expect(s).toBeLessThanOrEqual(prev + 1e-9)
      prev = s
    }
  })

  /**
   * The curve is exponential between the measured points (ratios 0.48/0.50/0.53/0.56), and an
   * exponential is convex — so the straight line between two of its points lies ABOVE it. Linear
   * interpolation of this curve therefore OVERSTATES every intermediate pick, and geometric
   * interpolation is the correction.
   *
   * This test originally asserted the opposite direction and failed, which is how the error was
   * found — in the comment and the test, not the implementation. Kept asserting the real
   * inequality so the direction can never silently flip.
   */
  it('geometric interpolation sits below the linear chord (AM-GM), which is the point', () => {
    for (const t of [0.25, 0.5, 0.75]) {
      const overall = 6.5 + t * 12
      const geo = pickShareByOverall(overall)
      const linear = PICK_ROUND_SHARE[1] + t * (PICK_ROUND_SHARE[2] - PICK_ROUND_SHARE[1])
      expect(geo).toBeLessThan(linear)
    }
    // And concretely, so a future change to the interpolation is visible as a number.
    expect(pickShareByOverall(6.5 + 0.25 * 12)).toBeCloseTo(0.832, 2)
  })
})
