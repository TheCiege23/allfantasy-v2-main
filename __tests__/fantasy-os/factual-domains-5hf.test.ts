import { describe, it, expect } from 'vitest'
import {
  isFactualDomainEnabled,
  FACTUAL_DOMAIN_ENV,
  resolveCurrent,
  resolveAsOf,
  applyCorrection,
  normalizeApiSportsInjury,
  type CanonicalInjury,
} from '@/lib/sports-data-gateway/persistence/factualDomains'

/** Phase 5H-f — factual domain contracts (pure). Physical DB proving: SPORTS_DATA_NONPROD_EVIDENCE_5HF.md. */

describe('5H-f — domains are default-off', () => {
  it('every factual gate is off unless explicitly "true"', () => {
    for (const d of Object.keys(FACTUAL_DOMAIN_ENV) as (keyof typeof FACTUAL_DOMAIN_ENV)[]) {
      expect(isFactualDomainEnabled(d, {})).toBe(false)
      expect(isFactualDomainEnabled(d, { [FACTUAL_DOMAIN_ENV[d]]: 'true' })).toBe(true)
    }
  })
})

describe('5H-f — injury normalization (provider-supplied, no inference)', () => {
  it('maps a real API-Sports injury; unknown status stays unknown; identity unresolved', () => {
    const inj = normalizeApiSportsInjury({ player: { id: 14653, name: 'Jackson Powers-Johnson' }, team: { id: 1 }, date: '2026-06-03', status: 'Questionable', description: 'ankle' }, { retrievedAt: '2026-07-13T00:00:00Z' })
    expect(inj.status).toBe('Questionable')
    expect(inj.sourcePlayerId).toBe('14653')
    expect(inj.identityResolutionState).toBe('unresolved') // api-sports ids not canonical
    expect(inj.provenance).toContain('api_sports:injuries')
    const unknown = normalizeApiSportsInjury({ player: { id: 1 }, status: '' }, { retrievedAt: '2026-07-13T00:00:00Z' })
    expect(unknown.status).toBe('unknown') // never inferred
  })
})

describe('5H-f — correction / effective-dating (append-only, never destructive)', () => {
  const base: CanonicalInjury = { id: 'inj_v1', canonicalPlayerId: null, sport: 'NFL', source: 'api_sports', sourcePlayerId: '14653', sourceTeamId: '1', injuryType: null, bodyArea: null, status: 'Questionable', practiceStatus: null, gameDesignation: null, description: null, reportedAt: '2026-06-03T00:00:00Z', effectiveAt: '2026-06-03T00:00:00Z', retrievedAt: null, estimatedReturnAt: null, resolvedAt: null, freshnessStatus: 'fresh', coverageStatus: 'covered', identityResolutionState: 'unresolved', provenance: 'p', unsupportedReason: null, contentHash: 'h1', version: 1, isActive: true, correctionOfId: null, supersedesId: null }

  it('a correction creates a NEW version and marks the prior for deactivation (prior facts retained)', () => {
    const r = applyCorrection(base, { ...base, id: 'inj_v2', status: 'Out', effectiveAt: '2026-06-10T00:00:00Z', contentHash: 'h2' }, { domain: 'injury', source: 'api_sports', sourceCorrectionId: 'c1', reasonCode: 'status_update', receivedAt: '2026-06-10T01:00:00Z', provenance: 'p' })
    expect(r).not.toBeNull()
    expect(r!.newVersion.correctionOfId).toBe('inj_v1')
    expect(r!.deactivateId).toBe('inj_v1')
    expect(r!.correction.previousContentHash).toBe('h1')
    expect(r!.correction.correctedContentHash).toBe('h2')
  })
  it('duplicate correction (same hash + effective) is suppressed', () => {
    const dup = applyCorrection(base, { ...base, id: 'inj_dup', contentHash: 'h1', effectiveAt: '2026-06-03T00:00:00Z' }, { domain: 'injury', source: 'api_sports', sourceCorrectionId: 'c1', reasonCode: 'status_update', receivedAt: 'x', provenance: 'p' })
    expect(dup).toBeNull()
  })
  it('resolveCurrent returns the active latest; resolveAsOf returns the historical record even if now inactive', () => {
    const v1 = { ...base, id: 'v1', effectiveAt: '2026-06-03T00:00:00Z', isActive: false, status: 'Questionable' }
    const v2 = { ...base, id: 'v2', effectiveAt: '2026-06-10T00:00:00Z', isActive: true, status: 'Out' }
    expect(resolveCurrent([v1, v2])!.status).toBe('Out')
    expect(resolveAsOf([v1, v2], '2026-06-05T00:00:00Z')!.status).toBe('Questionable') // historical
    expect(resolveAsOf([v1, v2], '2026-06-11T00:00:00Z')!.status).toBe('Out')
  })
  it('out-of-order corrections resolve deterministically by effectiveAt, not insertion order', () => {
    const later = { ...base, id: 'later', effectiveAt: '2026-06-10T00:00:00Z', status: 'Out' }
    const earlier = { ...base, id: 'earlier', effectiveAt: '2026-06-03T00:00:00Z', status: 'Questionable' }
    expect(resolveCurrent([later, earlier])!.id).toBe('later') // insertion order irrelevant
  })
})

describe('5H-f — boundary separation (injury ≠ availability): a normalized injury carries no availability verdict', () => {
  it('normalized injury exposes injury status only — never an availabilityStatus/leagueEligibility field', () => {
    const inj = normalizeApiSportsInjury({ player: { id: 14653 }, team: { id: 1 }, date: '2026-06-03', status: 'Out' }, { retrievedAt: '2026-07-13T00:00:00Z' })
    const keys = Object.keys(inj)
    expect(keys).toContain('status')
    // an injury record must NOT collapse into an availability verdict (that is a separate, labeled derivation)
    expect(keys).not.toContain('availabilityStatus')
    expect(keys).not.toContain('leagueEligibilityStatus')
    expect(keys).not.toContain('derivationType')
  })
})
