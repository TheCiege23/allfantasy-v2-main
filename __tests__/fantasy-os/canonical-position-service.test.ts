import { describe, it, expect } from 'vitest'
import { normalizeProviderPosition, deriveFantasyEligibility, resolveCanonicalPosition, REFERENCE_NFL_BUCKETS, type LeaguePositionRules } from '@/lib/sports-data-gateway/canonical/canonicalPosition'

describe('5H-b — canonical position normalization (detail preserved; unknown never inferred)', () => {
  it('preserves detailed positions and never collapses to a broad bucket', () => {
    expect(normalizeProviderPosition('DE', 'NFL').canonicalPrimaryPosition).toBe('DE') // NOT DL
    expect(normalizeProviderPosition('CB', 'NFL').canonicalPrimaryPosition).toBe('CB') // NOT DB
    expect(normalizeProviderPosition('OLB', 'NFL').canonicalPrimaryPosition).toBe('OLB') // NOT LB
    expect(normalizeProviderPosition('QB', 'NFL').canonicalPrimaryPosition).toBe('QB')
  })
  it('classifies IDP vs offense correctly', () => {
    expect(normalizeProviderPosition('DE', 'NFL').isIDP).toBe(true)
    expect(normalizeProviderPosition('S', 'NFL').isIDP).toBe(true)
    expect(normalizeProviderPosition('QB', 'NFL').isIDP).toBe(false)
    expect(normalizeProviderPosition('WR', 'NFL').isIDP).toBe(false)
  })
  it('unknown/empty provider positions become UNKNOWN — never guessed', () => {
    expect(normalizeProviderPosition('FULLBACK-Z', 'NFL')).toMatchObject({ canonicalPrimaryPosition: 'UNKNOWN', isUnknown: true, isIDP: false })
    expect(normalizeProviderPosition('', 'NFL').isUnknown).toBe(true)
    expect(normalizeProviderPosition(null, 'NFL').isUnknown).toBe(true)
  })
  it('normalizes provider aliases (DST/D/ST -> DEF, HB -> RB)', () => {
    expect(normalizeProviderPosition('DST', 'NFL').canonicalPrimaryPosition).toBe('DEF')
    expect(normalizeProviderPosition('D/ST', 'NFL').canonicalPrimaryPosition).toBe('DEF')
    expect(normalizeProviderPosition('HB', 'NFL').canonicalPrimaryPosition).toBe('RB')
  })
  it('is deterministic (case/whitespace-insensitive canonical output; raw provider value echoed verbatim)', () => {
    const a = normalizeProviderPosition('de', 'NFL')
    const b = normalizeProviderPosition('DE ', 'NFL')
    expect(a.canonicalPrimaryPosition).toBe(b.canonicalPrimaryPosition)
    expect(a.isIDP).toBe(b.isIDP)
    expect(a.canonicalPrimaryPosition).toBe('DE')
  })
})

describe('5H-b — fantasy eligibility is GOVERNED BY LEAGUE RULES (never hardcoded collapse)', () => {
  it('a detailed position is always self-eligible plus any league-defined bucket that includes it', () => {
    expect(deriveFantasyEligibility('DE', REFERENCE_NFL_BUCKETS).sort()).toEqual(['DE', 'DL', 'IDP_FLEX'].sort())
    expect(deriveFantasyEligibility('CB', REFERENCE_NFL_BUCKETS).sort()).toEqual(['CB', 'DB', 'IDP_FLEX'].sort())
    expect(deriveFantasyEligibility('RB', REFERENCE_NFL_BUCKETS).sort()).toEqual(['FLEX', 'RB', 'SUPER_FLEX'].sort())
  })
  it('a league that does NOT define a bucket does not make the position eligible for it', () => {
    const noDL: LeaguePositionRules = { buckets: { DB: ['CB', 'S'] } } // league defines DB but not DL
    expect(deriveFantasyEligibility('DE', noDL)).toEqual(['DE']) // DE self-eligible only — no DL bucket exists
    expect(deriveFantasyEligibility('CB', noDL).sort()).toEqual(['CB', 'DB'].sort())
  })
  it('UNKNOWN is eligible for nothing', () => {
    expect(deriveFantasyEligibility('UNKNOWN', REFERENCE_NFL_BUCKETS)).toEqual([])
  })
  it('resolveCanonicalPosition composes normalization + governed eligibility, preserving detail', () => {
    const r = resolveCanonicalPosition('DT', 'NFL', REFERENCE_NFL_BUCKETS, { source: 'espn', effectiveDate: '2024-09-01' })
    expect(r.canonicalPrimaryPosition).toBe('DT')
    expect(r.eligibleFantasyPositions.sort()).toEqual(['DL', 'DT', 'IDP_FLEX'].sort())
    expect(r.source).toBe('espn'); expect(r.effectiveDate).toBe('2024-09-01')
  })
})
