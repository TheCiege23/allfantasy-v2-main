import { describe, it, expect } from 'vitest'
import {
  normalizeProviderPosition,
  deriveFantasyEligibility,
  resolveCanonicalPosition,
  isSupportedPositionSport,
  SUPPORTED_POSITION_SPORTS,
  REFERENCE_NFL_BUCKETS,
  type LeaguePositionRules,
} from '@/lib/sports-data-gateway/canonical/canonicalPosition'

/**
 * Phase 5H-b2 — governance contract for the ONE canonical position service.
 *
 * These lock the invariants the migration ledger depends on: detailed positions are preserved, broad fantasy
 * eligibility is derived ONLY from league-supplied rules (never a hardcoded collapse), unknown/unsupported
 * inputs stay explicit, and cross-sport misuse is isolated (no football map applied to another sport).
 */

// A league that defines NO broad buckets — detailed positions are only ever eligible for themselves.
const DETAILED_ONLY: LeaguePositionRules = { buckets: {} }
// A league that supports offensive FLEX but NOT SUPER_FLEX and NOT any IDP bucket.
const FLEX_NO_SF: LeaguePositionRules = { buckets: { FLEX: ['RB', 'WR', 'TE'] } }
// A league that supports SUPER_FLEX.
const SUPERFLEX: LeaguePositionRules = { buckets: { FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'] } }
// A league that supports the DB bucket but NOT DL/LB.
const DB_ONLY: LeaguePositionRules = { buckets: { DB: ['CB', 'S', 'FS', 'SS', 'DB'] } }

describe('5H-b2 — detailed position preservation (never collapse)', () => {
  it('DE stays DE (not DL)', () => {
    const r = normalizeProviderPosition('DE', 'NFL')
    expect(r.canonicalPrimaryPosition).toBe('DE')
    expect(r.isIDP).toBe(true)
    expect(r.isUnknown).toBe(false)
  })
  it('CB stays CB (not DB)', () => {
    expect(normalizeProviderPosition('CB', 'NFL').canonicalPrimaryPosition).toBe('CB')
  })
  it('OLB stays OLB (not LB)', () => {
    const r = normalizeProviderPosition('OLB', 'NFL')
    expect(r.canonicalPrimaryPosition).toBe('OLB')
    expect(r.isIDP).toBe(true)
  })
  it('offensive aliases normalize but keep their canonical identity (HB→RB, DST→DEF, PK→K, FB→FB)', () => {
    expect(normalizeProviderPosition('HB', 'NFL').canonicalPrimaryPosition).toBe('RB')
    expect(normalizeProviderPosition('DST', 'NFL').canonicalPrimaryPosition).toBe('DEF')
    expect(normalizeProviderPosition('PK', 'NFL').canonicalPrimaryPosition).toBe('K')
    expect(normalizeProviderPosition('FB', 'NFL').canonicalPrimaryPosition).toBe('FB')
  })
})

describe('5H-b2 — league-rule-derived eligibility (only what the league supports)', () => {
  it('DE is only self-eligible when the league defines no DL bucket', () => {
    expect(deriveFantasyEligibility('DE', DETAILED_ONLY)).toEqual(['DE'])
  })
  it('DE gains DL eligibility only when the league supports DL', () => {
    const withDl: LeaguePositionRules = { buckets: { DL: ['DE', 'DT', 'NT', 'EDGE', 'DL'] } }
    expect(deriveFantasyEligibility('DE', withDl).sort()).toEqual(['DE', 'DL'])
  })
  it('CB gains DB eligibility only when the league supports DB', () => {
    expect(deriveFantasyEligibility('CB', DETAILED_ONLY)).toEqual(['CB'])
    expect(deriveFantasyEligibility('CB', DB_ONLY).sort()).toEqual(['CB', 'DB'])
  })
  it('RB receives FLEX only when the league enables a compatible FLEX slot', () => {
    expect(deriveFantasyEligibility('RB', DETAILED_ONLY)).toEqual(['RB'])
    expect(deriveFantasyEligibility('RB', FLEX_NO_SF).sort()).toEqual(['FLEX', 'RB'])
  })
  it('QB receives SUPER_FLEX only when the league enables SUPER_FLEX', () => {
    expect(deriveFantasyEligibility('QB', FLEX_NO_SF)).toEqual(['QB']) // FLEX excludes QB, no SF defined
    expect(deriveFantasyEligibility('QB', SUPERFLEX).sort()).toEqual(['QB', 'SUPER_FLEX'])
  })
  it('a detailed-only league never expands eligibility beyond the position itself', () => {
    for (const pos of ['DE', 'CB', 'OLB', 'RB', 'QB', 'WR', 'TE', 'K']) {
      expect(deriveFantasyEligibility(pos, DETAILED_ONLY)).toEqual([pos])
    }
  })
})

describe('5H-b2 — unknown / missing inputs stay explicit', () => {
  it('an unrecognized position is UNKNOWN and eligible for nothing', () => {
    const r = normalizeProviderPosition('ZZ', 'NFL')
    expect(r.isUnknown).toBe(true)
    expect(r.canonicalPrimaryPosition).toBe('UNKNOWN')
    expect(deriveFantasyEligibility(r.canonicalPrimaryPosition, REFERENCE_NFL_BUCKETS)).toEqual([])
  })
  it('empty / null / undefined → UNKNOWN, never inferred', () => {
    for (const v of ['', '   ', null, undefined]) {
      expect(normalizeProviderPosition(v, 'NFL').isUnknown).toBe(true)
    }
  })
})

describe('5H-b2 — sport isolation (no cross-sport fallback)', () => {
  it('the service governs only the football sports', () => {
    expect([...SUPPORTED_POSITION_SPORTS]).toEqual(['NFL', 'NCAAF'])
    expect(isSupportedPositionSport('NFL')).toBe(true)
    expect(isSupportedPositionSport('NCAAF')).toBe(true)
    expect(isSupportedPositionSport('SOCCER')).toBe(false)
    expect(isSupportedPositionSport('NBA')).toBe(false)
    expect(isSupportedPositionSport(null)).toBe(false)
  })
  it('a non-football sport never resolves to a plausible football position (isolated → UNKNOWN)', () => {
    // 'CB' is a real NFL cornerback AND a soccer/other code; under a non-football sport it must NOT become NFL CB.
    const soccer = normalizeProviderPosition('CB', 'SOCCER' as unknown as 'NFL')
    expect(soccer.isUnknown).toBe(true)
    expect(soccer.canonicalPrimaryPosition).toBe('UNKNOWN')
    // A genuine soccer code under NFL is likewise UNKNOWN — the football map is never a fallback.
    expect(normalizeProviderPosition('GK', 'NFL').isUnknown).toBe(true)
  })
  it('NCAAF interprets football positions the same as NFL (college identity preserved, not cross-mapped)', () => {
    expect(normalizeProviderPosition('EDGE', 'NCAAF').canonicalPrimaryPosition).toBe('EDGE')
    expect(normalizeProviderPosition('EDGE', 'NCAAF').sport).toBe('NCAAF')
  })
})

describe('5H-b2 — provenance & effective-date preserved', () => {
  it('carries source + effectiveDate through when the caller supplies context', () => {
    const r = resolveCanonicalPosition('DT', 'NFL', REFERENCE_NFL_BUCKETS, { source: 'sleeper', effectiveDate: '2026-09-01' })
    expect(r.source).toBe('sleeper')
    expect(r.effectiveDate).toBe('2026-09-01')
    expect(r.canonicalPrimaryPosition).toBe('DT')
    expect(r.eligibleFantasyPositions).toContain('DL') // REFERENCE buckets define DL⊇DT
  })
  it('defaults provenance to provider / null effective-date when omitted', () => {
    const r = normalizeProviderPosition('WR', 'NFL')
    expect(r.source).toBe('provider')
    expect(r.effectiveDate).toBeNull()
  })
})
