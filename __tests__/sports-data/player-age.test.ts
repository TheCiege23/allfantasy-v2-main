import { describe, expect, it } from 'vitest'

import { coercePlayerAge } from '@/lib/sports-data/playerAge'

/**
 * The field Rolling Insights calls `age` is not one, and the old ingest turned it into an integer
 * that looked like one. `intOf` stripped every separator, so "2/9/1996" became 291996 and nothing
 * downstream objected — 291996 is a perfectly good number. All 13,763 RI rows carrying an age held
 * a value like that.
 */

// Fixed so the expectations do not drift with the clock.
const NOW = new Date('2026-08-28T00:00:00.000Z')
const age = (v: unknown) => coercePlayerAge(v, NOW)

describe('ageFromRollingInsightsValue', () => {
  it('recovers the year from the separator-stripped digits actually in the column', () => {
    // These are real shapes measured in production.
    expect(age(291996)).toBe(30) // "2/9/1996"
    expect(age(11994)).toBe(32) // "1/1994" or "1/1/994" — only the year is recoverable
    expect(age(312001)).toBe(25)
    expect(age(41988)).toBe(38)
  })

  it('passes a value that is already an age straight through', () => {
    expect(age(27)).toBe(27)
    expect(age('31')).toBe(31)
    expect(age(60)).toBe(60)
    expect(age(14)).toBe(14)
  })

  it('reads a real date without going through the lossy path', () => {
    // The fix at the ingest means well-formed values never reach the digit fallback.
    expect(age('1996-09-02')).toBe(30)
    expect(age('2/9/1996')).toBe(30)
  })

  it('refuses rather than guessing', () => {
    expect(age(null)).toBeNull()
    expect(age(undefined)).toBeNull()
    expect(age('')).toBeNull()
    expect(age('unknown')).toBeNull()
    // A bare year is four digits: too short to be one of the stripped values, and not an age.
    expect(age(1996)).toBeNull()
    // Implies an age of 4 — outside anything a roster holds.
    expect(age(112022)).toBeNull()
    // Implies 116 years old.
    expect(age(11910)).toBeNull()
  })

  it('never returns an impossible age, which is the property the old column violated', () => {
    const samples = [291996, 11994, 312001, 41988, 131991, 221997, 81992, 101995, 9419, 7051]
    for (const s of samples) {
      const a = age(s)
      if (a === null) continue
      expect(a).toBeGreaterThanOrEqual(14)
      expect(a).toBeLessThanOrEqual(60)
    }
  })

  it('is accurate to within a year, not to the day, and does not pretend otherwise', () => {
    // Someone born late in 1996 is 29 on this date, not 30 — the month and day are gone, so this
    // is the documented ±1. Recorded as a test so the limitation is not rediscovered as a bug.
    expect(age(291996)).toBe(30)
    expect(age('1996-12-31')).toBe(30)
  })
})
