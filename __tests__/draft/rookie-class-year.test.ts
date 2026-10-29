import { describe, expect, it } from 'vitest'
import { isRookieEligibleForFilter, rookieClassYear } from '@/lib/draft-room/rookieFilterPredicate'

// A 2026 NBA draftee: drafted June 2026, rookie season 2026-27.
const nbaRookie = { sport: 'NBA', draftYear: 2026 }
const nhlRookie = { sport: 'NHL', draftYear: 2026, age: 22 }

describe('rookie class year', () => {
  it('keeps an NBA rookie a rookie after January 1 of his rookie season', () => {
    expect(isRookieEligibleForFilter(nbaRookie, { now: new Date('2026-11-01T12:00:00Z') })).toBe(true)
    expect(isRookieEligibleForFilter(nbaRookie, { now: new Date('2027-01-15T12:00:00Z') })).toBe(true)
    expect(isRookieEligibleForFilter(nbaRookie, { now: new Date('2027-06-20T12:00:00Z') })).toBe(true)
  })

  it('rolls to the new class in July, after the June draft', () => {
    expect(isRookieEligibleForFilter(nbaRookie, { now: new Date('2027-07-05T12:00:00Z') })).toBe(false)
    expect(isRookieEligibleForFilter({ sport: 'NBA', draftYear: 2027 }, { now: new Date('2027-07-05T12:00:00Z') })).toBe(true)
  })

  it('applies the same class year to NHL draftees', () => {
    expect(isRookieEligibleForFilter(nhlRookie, { now: new Date('2027-03-01T12:00:00Z') })).toBe(true)
  })

  it("prefers the league's own season when the caller has one", () => {
    expect(isRookieEligibleForFilter(nbaRookie, { seasonYear: 2026, now: new Date('2028-01-01T00:00:00Z') })).toBe(true)
    expect(isRookieEligibleForFilter(nbaRookie, { seasonYear: 2027, now: new Date('2027-01-15T12:00:00Z') })).toBe(false)
  })

  it('leaves MLB debut years on the calendar season', () => {
    expect(rookieClassYear('MLB', new Date('2027-01-15T12:00:00Z'))).toBe(2027)
    expect(isRookieEligibleForFilter({ sport: 'MLB', debutYear: 2027 }, { now: new Date('2027-04-01T12:00:00Z') })).toBe(true)
  })
})
