/**
 * Per-game → rest-of-season conversion.
 *
 * The headline test is the 17× trap: feeding a per-game rate where a rest-of-season total is
 * expected understates a player by roughly the number of weeks left, silently, with every wrong
 * value looking like a plausible price. These pin the conversion so it can only happen one way.
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FANTASY_FINAL_WEEK,
  perGameFromRos,
  reprojectRos,
  rosFromPerGame,
  weeksRemaining,
} from '@/lib/af-projections/restOfSeason'

describe('weeksRemaining', () => {
  it('counts the current week itself', () => {
    // Projecting FOR week 1 through a week-17 final = 17 games, not 16.
    expect(weeksRemaining({ currentWeek: 1 })).toBe(17)
    expect(weeksRemaining({ currentWeek: 17 })).toBe(1)
  })

  it('honours a league that ends earlier than the default', () => {
    expect(weeksRemaining({ currentWeek: 10, finalWeek: 16 })).toBe(7)
    expect(weeksRemaining({ currentWeek: 10, finalWeek: 14 })).toBe(5)
  })

  it('returns 0 once the season is past, never a negative', () => {
    expect(weeksRemaining({ currentWeek: 18, finalWeek: 17 })).toBe(0)
    expect(weeksRemaining({ currentWeek: 20, finalWeek: 17 })).toBe(0)
  })

  it('subtracts a bye that is still ahead', () => {
    const withoutBye = weeksRemaining({ currentWeek: 5 })!
    const withBye = weeksRemaining({ currentWeek: 5, byeWeek: 9 })!
    expect(withBye).toBe(withoutBye - 1)
  })

  it('does NOT subtract a bye that has already passed', () => {
    // Week 9 bye, asking in week 10 — he has already had it.
    expect(weeksRemaining({ currentWeek: 10, byeWeek: 9 })).toBe(weeksRemaining({ currentWeek: 10 }))
  })

  it('subtracts a bye falling exactly on the current week', () => {
    expect(weeksRemaining({ currentWeek: 9, byeWeek: 9 })).toBe(weeksRemaining({ currentWeek: 9 })! - 1)
  })

  it('ignores a bye beyond the final week', () => {
    expect(weeksRemaining({ currentWeek: 5, finalWeek: 14, byeWeek: 16 }))
      .toBe(weeksRemaining({ currentWeek: 5, finalWeek: 14 }))
  })

  it('refuses rather than guessing when the week is unusable', () => {
    for (const w of [null, undefined, NaN, 0, -3, 99]) {
      expect(weeksRemaining({ currentWeek: w as number })).toBeNull()
    }
  })

  it('refuses a nonsense final week', () => {
    expect(weeksRemaining({ currentWeek: 5, finalWeek: 0 })).toBeNull()
    expect(weeksRemaining({ currentWeek: 5, finalWeek: 99 })).toBeNull()
  })

  it('uses the documented default when no final week is given', () => {
    expect(weeksRemaining({ currentWeek: 1 })).toBe(DEFAULT_FANTASY_FINAL_WEEK)
  })
})

describe('rosFromPerGame — the 17x trap', () => {
  it('converts the measured cases from the audit correctly', () => {
    expect(rosFromPerGame(19.5, 17)).toBeCloseTo(331.5, 2)
    expect(rosFromPerGame(18.0, 17)).toBeCloseTo(306, 2)
    expect(rosFromPerGame(9.2, 17)).toBeCloseTo(156.4, 2)
  })

  it('a per-game rate and its ROS total differ by the week count — that IS the bug', () => {
    const perGame = 19.5
    const ros = rosFromPerGame(perGame, 17)!
    expect(ros / perGame).toBeCloseTo(17, 5)
  })

  it('returns NULL, never 0, for unusable input', () => {
    // 🛑 A 0 would enter the value engine as "this player will score nothing", which is a real
    // claim. "We could not compute this" must not be able to impersonate it.
    for (const p of [null, undefined, NaN, -1]) {
      expect(rosFromPerGame(p as number, 17)).toBeNull()
    }
    for (const w of [null, undefined, NaN, -1]) {
      expect(rosFromPerGame(19.5, w as number)).toBeNull()
    }
  })

  it('distinguishes a genuine zero rate from a refusal', () => {
    // A player projected at 0.0/game IS a real projection of nothing.
    expect(rosFromPerGame(0, 17)).toBe(0)
    // Zero weeks left is also real: the season is over.
    expect(rosFromPerGame(19.5, 0)).toBe(0)
    // But a missing input is null.
    expect(rosFromPerGame(null, 17)).toBeNull()
  })
})

describe('perGameFromRos — the inverse', () => {
  it('round-trips', () => {
    const ros = rosFromPerGame(14.25, 13)!
    expect(perGameFromRos(ros, 13)).toBeCloseTo(14.25, 2)
  })

  it('refuses to divide by zero or a missing divisor', () => {
    expect(perGameFromRos(100, 0)).toBeNull()
    expect(perGameFromRos(100, null)).toBeNull()
    expect(perGameFromRos(100, -5)).toBeNull()
  })

  it('a low total and a late-season total are only distinguishable WITH the divisor', () => {
    // Same stored total, different horizons: one is a star in week 14, one is a scrub in week 3.
    const star = rosFromPerGame(19.0, 4)!   // 76 over 4 weeks
    const scrub = rosFromPerGame(5.07, 15)! // ~76 over 15 weeks
    expect(star).toBeCloseTo(scrub, 0)
    // Identical totals, and the divisor is the only thing that separates them.
    expect(perGameFromRos(star, 4)!).toBeGreaterThan(perGameFromRos(scrub, 15)! * 3)
  })
})

describe('reprojectRos — a league with its own horizon', () => {
  it('re-projects a stored 17-week total onto a 14-week league', () => {
    const stored = rosFromPerGame(12, 17)! // 204
    expect(reprojectRos({ storedRos: stored, storedWeeks: 17, targetWeeks: 14 })).toBeCloseTo(168, 1)
  })

  it('is the identity when the horizons match', () => {
    const stored = rosFromPerGame(12, 17)!
    expect(reprojectRos({ storedRos: stored, storedWeeks: 17, targetWeeks: 17 })).toBeCloseTo(stored, 1)
  })

  it('refuses when any part is missing, rather than doing half the conversion', () => {
    expect(reprojectRos({ storedRos: 200, storedWeeks: null, targetWeeks: 14 })).toBeNull()
    expect(reprojectRos({ storedRos: null, storedWeeks: 17, targetWeeks: 14 })).toBeNull()
    expect(reprojectRos({ storedRos: 200, storedWeeks: 17, targetWeeks: null })).toBeNull()
  })

  it('POSITIVE CONTROL — re-projecting actually changes the number', () => {
    // If this were a no-op the tests above would pass while the function did nothing.
    const stored = rosFromPerGame(12, 17)!
    const shorter = reprojectRos({ storedRos: stored, storedWeeks: 17, targetWeeks: 8 })!
    expect(shorter).toBeLessThan(stored * 0.6)
  })
})
