import { describe, expect, it } from 'vitest'

import {
  getCollegeClassBucket,
  isDraftEligibleCollegeClass,
  isFreshmanClass,
  isUnderclassmanClass,
  normalizeCollegeClass,
} from '@/lib/draft-room/collegeClass'
import { isDraftRoomRookie } from '@/lib/draft-room/draftPlayerRookie'
import { resolveNflRookieSource } from '@/lib/providers/nflRookieSourcePolicy'

describe('collegeClass helpers', () => {
  it('normalizes Fr / RS-Fr / Freshman', () => {
    expect(normalizeCollegeClass('Fr')).toBe('freshman')
    expect(normalizeCollegeClass('RS-Fr')).toBe('freshman')
    expect(normalizeCollegeClass('Freshman')).toBe('freshman')
  })

  it('normalizes So / Jr / Sr / Gr', () => {
    expect(normalizeCollegeClass('So')).toBe('sophomore')
    expect(normalizeCollegeClass('Jr')).toBe('junior')
    expect(normalizeCollegeClass('Sr')).toBe('senior')
    expect(normalizeCollegeClass('Gr')).toBe('graduate')
  })

  it('isFreshmanClass / underclass / draft eligible', () => {
    expect(isFreshmanClass('RS-Fr')).toBe(true)
    expect(isUnderclassmanClass('So')).toBe(true)
    expect(isDraftEligibleCollegeClass('Jr')).toBe(true)
  })

  it('getCollegeClassBucket mirrors normalizeCollegeClass', () => {
    expect(getCollegeClassBucket('Sr')).toBe('senior')
    expect(getCollegeClassBucket(null)).toBe('unknown')
  })
})

describe('NCAAF pool — freshmen vs NFL Sleeper', () => {
  it('isDraftRoomRookie true for RI class Fr (not years_exp)', () => {
    expect(
      isDraftRoomRookie(
        { name: 'X', position: 'WR', metadata: { class: 'Fr' } },
        { sport: 'NCAAF', seasonYear: 2026 },
      ),
    ).toBe(true)
  })

  it('does not treat Sleeper years_exp as freshman signal for NCAAF', () => {
    expect(
      isDraftRoomRookie(
        { name: 'Y', position: 'QB', yearsExp: 0 },
        { sport: 'NCAAF', seasonYear: 2026 },
      ),
    ).toBe(false)
  })
})

describe('NFL rookie policy', () => {
  it('uses imported flags when present', () => {
    const r = resolveNflRookieSource({ isRookie: true, seasonYear: 2026 })
    expect(r.isRookie).toBe(true)
    expect(r.source).toBe('rolling_insights_imported')
  })

  it('uses Sleeper years_exp === 0', () => {
    const r = resolveNflRookieSource({ yearsExp: 0, seasonYear: 2026 })
    expect(r.isRookie).toBe(true)
    expect(r.source).toBe('sleeper_years_exp')
  })

  it('unknown when no signals', () => {
    const r = resolveNflRookieSource({ name: 'Z', seasonYear: 2026 })
    expect(r.isRookie).toBeNull()
    expect(r.source).toBe('unknown')
  })
})
