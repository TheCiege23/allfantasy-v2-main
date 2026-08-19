import { describe, it, expect } from 'vitest'
import {
  normalizeFantasyCalcValue,
  deriveValuationGrouping,
  assertValueBoundary,
  valueEligibilityForLeague,
  type CanonicalPlayerValue,
} from '@/lib/sports-data-gateway/canonical/canonicalValue'
import { REFERENCE_NFL_BUCKETS } from '@/lib/sports-data-gateway/canonical/canonicalPosition'

/**
 * Phase 5H-c — canonical VALUE contract. Locks: strict boundary separation (valuation vs ranking vs adp), format
 * isolation (redraft vs dynasty, scoring), detailed-position preservation, IDP + kicker handling, unknown/unresolved/
 * stale/unsupported honesty, and FantasyCalc-as-provider-valuation.
 */

const dynastyPPR = { leagueFormat: 'dynasty', scoringFormat: 'ppr' } as const
const redraftPPR = { leagueFormat: 'redraft', scoringFormat: 'ppr' } as const

function byType(records: CanonicalPlayerValue[], t: string) {
  return records.find((r) => r.valueType === t)
}

describe('5H-c value — FantasyCalc normalization is provider valuation, boundaries stay distinct', () => {
  const input = { sourcePlayerId: '4046', canonicalPlayerId: 'canon-1', providerPosition: 'RB', dynastyValue: 8000, redraftValue: 6000, overallRank: 3, adp: 4.2, tier: 1 }

  it('produces DISTINCT valuation / ranking / adp records (never merged)', () => {
    const recs = normalizeFantasyCalcValue(input, dynastyPPR, { sport: 'NFL', identityResolutionState: 'resolved' })
    const val = byType(recs, 'provider_valuation')!
    const rank = byType(recs, 'ranking')!
    const adp = byType(recs, 'adp')!
    expect(val.source).toBe('fantasycalc')
    expect(val.value).toBe(8000) // dynasty value for a dynasty league
    expect(val.rank).toBeNull()
    expect(rank.rank).toBe(3)
    expect(rank.value).toBeNull() // ranking never carries a value
    expect(adp.value).toBe(4.2)
    recs.forEach((r) => expect(assertValueBoundary(r)).toBe(true))
  })

  it('redraft league selects redraftValue, not dynasty value', () => {
    const val = byType(normalizeFantasyCalcValue(input, redraftPPR, { sport: 'NFL' }), 'provider_valuation')!
    expect(val.value).toBe(6000)
    expect(val.leagueFormat).toBe('redraft')
  })

  it('scoring + league format stay explicit and isolated', () => {
    const half = byType(normalizeFantasyCalcValue(input, { leagueFormat: 'dynasty', scoringFormat: 'half_ppr' }, {}), 'provider_valuation')!
    expect(half.scoringFormat).toBe('half_ppr')
    expect(half.leagueFormat).toBe('dynasty')
  })

  it('FantasyCalc is always provider_valuation — never observed_statistic or a projection', () => {
    const recs = normalizeFantasyCalcValue(input, dynastyPPR, {})
    expect(recs.every((r) => r.valueType !== 'observed_statistic' && r.valueType !== 'provider_projection')).toBe(true)
  })
})

describe('5H-c value — position governance (detail preserved, IDP + kicker)', () => {
  it('detailed IDP position is preserved in positionContext (DE stays DE)', () => {
    const val = byType(normalizeFantasyCalcValue({ providerPosition: 'DE', dynastyValue: 1200 }, dynastyPPR, { sport: 'NFL' }), 'provider_valuation')!
    expect(val.positionContext).toBe('DE')
  })
  it('valuation grouping is non-destructive: DE groups to DL for comparison, positionContext still DE', () => {
    expect(deriveValuationGrouping('DE', 'NFL')).toBe('DL')
    expect(deriveValuationGrouping('OLB', 'NFL')).toBe('LB')
    expect(deriveValuationGrouping('CB', 'NFL')).toBe('DB')
  })
  it('kicker value grouping stays separate from offensive skill', () => {
    expect(deriveValuationGrouping('K', 'NFL')).toBe('K')
    expect(deriveValuationGrouping('RB', 'NFL')).toBe('RB')
    expect(deriveValuationGrouping('K', 'NFL')).not.toBe(deriveValuationGrouping('RB', 'NFL'))
  })
  it('unknown position gets no valuation bucket silently', () => {
    expect(deriveValuationGrouping('UNKNOWN', 'NFL')).toBeNull()
    expect(deriveValuationGrouping('ZZ', 'NFL')).toBe('ZZ') // preserved as itself, never invented as a plausible family
  })
  it('league-rule-derived eligibility available from a value record', () => {
    const val = byType(normalizeFantasyCalcValue({ providerPosition: 'DE', dynastyValue: 1200 }, dynastyPPR, { sport: 'NFL' }), 'provider_valuation')!
    expect(valueEligibilityForLeague(val, REFERENCE_NFL_BUCKETS).sort()).toContain('DL')
    expect(valueEligibilityForLeague(val, { buckets: {} })).toEqual(['DE'])
  })
})

describe('5H-c value — identity, freshness, coverage honesty', () => {
  it('unresolved identity when no canonical id supplied', () => {
    const val = byType(normalizeFantasyCalcValue({ providerPosition: 'WR', dynastyValue: 5000 }, dynastyPPR, {}), 'provider_valuation')!
    expect(val.identityResolutionState).toBe('unresolved')
    expect(val.canonicalPlayerId).toBeNull()
  })
  it('resolved identity is carried through', () => {
    const val = byType(normalizeFantasyCalcValue({ canonicalPlayerId: 'c9', providerPosition: 'WR', dynastyValue: 5000 }, dynastyPPR, { identityResolutionState: 'resolved' }), 'provider_valuation')!
    expect(val.identityResolutionState).toBe('resolved')
    expect(val.canonicalPlayerId).toBe('c9')
  })
  it('stale freshness is preserved, not silently treated fresh', () => {
    const val = byType(normalizeFantasyCalcValue({ providerPosition: 'WR', dynastyValue: 5000 }, dynastyPPR, { freshnessStatus: 'stale' }), 'provider_valuation')!
    expect(val.freshnessStatus).toBe('stale')
  })
  it('no value fields present → not_found coverage, never a fabricated value', () => {
    const recs = normalizeFantasyCalcValue({ providerPosition: 'WR' }, dynastyPPR, {})
    expect(recs).toHaveLength(1)
    expect(recs[0].coverageStatus).toBe('not_found')
    expect(recs[0].value).toBeNull()
  })
  it('unsupported sport → UNKNOWN position, isolated', () => {
    const val = byType(normalizeFantasyCalcValue({ providerPosition: 'CB', dynastyValue: 1000 }, dynastyPPR, { sport: 'NCAAF' }), 'provider_valuation')!
    expect(val.positionContext).toBe('CB') // NCAAF is supported; detail preserved
    expect(val.sport).toBe('NCAAF')
  })
})
