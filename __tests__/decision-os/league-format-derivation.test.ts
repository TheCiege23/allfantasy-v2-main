import { describe, it, expect } from 'vitest'
import { deriveLeagueFormat } from '@/lib/league-runtime/leagueFormat'

/**
 * R4b.1 — the single format-derivation rule, extracted from canonicalLeagueRules.ts so
 * every consumer (psych profiles included) shares one implementation rather than growing
 * a second, independently-drifting copy.
 */
describe('deriveLeagueFormat', () => {
  it.each([
    // [leagueType, isDynasty, expected] — every (leagueType, isDynasty) combo actually
    // observed in production on 2026-09-03 (270 leagues, 6 combos).
    ['redraft', false, 'redraft'],
    ['dynasty', true, 'dynasty'],
    ['guillotine', false, 'guillotine'],
    ['redraft', true, 'redraft'], // leagueType wins over isDynasty — the BUG-4 disagreement case, 4 leagues
    ['zombie', false, 'zombie'],
    ['survivor', false, 'survivor'],
  ] as const)('leagueType=%s isDynasty=%s -> %s', (leagueType, isDynasty, expected) => {
    expect(deriveLeagueFormat({ leagueType, isDynasty })).toBe(expected)
  })

  it('falls back to isDynasty when leagueType is null', () => {
    expect(deriveLeagueFormat({ leagueType: null, isDynasty: true })).toBe('dynasty')
    expect(deriveLeagueFormat({ leagueType: null, isDynasty: false })).toBe('redraft')
  })

  it('falls back to isDynasty when leagueType is undefined', () => {
    expect(deriveLeagueFormat({ isDynasty: true })).toBe('dynasty')
  })

  it('treats an empty or whitespace-only leagueType as absent', () => {
    expect(deriveLeagueFormat({ leagueType: '', isDynasty: true })).toBe('dynasty')
    expect(deriveLeagueFormat({ leagueType: '   ', isDynasty: false })).toBe('redraft')
  })

  it('treats a missing isDynasty as falsy, matching the original inline expression', () => {
    expect(deriveLeagueFormat({ leagueType: null })).toBe('redraft')
  })
})
