import { describe, it, expect } from 'vitest'
import {
  parseBirthday,
  isPlaceholderBirthday,
} from '@/lib/player-identity/backfillCanonicalBirthdays'

describe('parseBirthday', () => {
  it('reads a well-formed date at UTC midnight, so it cannot shift a day', () => {
    const d = parseBirthday('1993-07-29')
    expect(d?.toISOString()).toBe('1993-07-29T00:00:00.000Z')
  })

  it('refuses anything that is not exactly YYYY-MM-DD', () => {
    /* `new Date('9/6/02')` succeeds and means different things in different zones.
       A birthday that shifts by a day is a birthday that stops matching. */
    expect(parseBirthday('9/6/02')).toBeNull()
    expect(parseBirthday('1993-7-29')).toBeNull()
    expect(parseBirthday('1993-07-29T00:00:00Z')).toBeNull()
    expect(parseBirthday('')).toBeNull()
    expect(parseBirthday(null)).toBeNull()
  })

  it('refuses a date that silently rolls over', () => {
    // '2001-02-30' would otherwise parse to March 2nd and look valid.
    expect(parseBirthday('2001-02-30')).toBeNull()
    expect(parseBirthday('2001-13-01')).toBeNull()
  })

  it('refuses years no NFL player could have', () => {
    expect(parseBirthday('1899-05-01')).toBeNull()
    expect(parseBirthday('2030-05-01')).toBeNull()
  })
})

describe('isPlaceholderBirthday', () => {
  it('rejects January 1, which the data shows is filler', () => {
    /* 3.17 players per Jan-1 date against 1.34 for every other day, and
       2001-01-01 alone carries 8. Eight players agreeing on a birthday would be
       eight 0.95-confidence links between different people. */
    expect(isPlaceholderBirthday('2001-01-01')).toBe(true)
    expect(isPlaceholderBirthday('1995-01-01')).toBe(true)
  })

  it('keeps every other date, including January 2', () => {
    expect(isPlaceholderBirthday('2001-01-02')).toBe(false)
    expect(isPlaceholderBirthday('1993-07-29')).toBe(false)
    expect(isPlaceholderBirthday('')).toBe(false)
  })
})
