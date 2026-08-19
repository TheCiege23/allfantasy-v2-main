import { describe, it, expect } from 'vitest'
import {
  checkApprovedNonProdTarget,
  assertApprovedNonProdTarget,
  APPROVED_NONPROD_PROJECT_ID,
} from '@/lib/sports-data-gateway/persistence/nonprodSafetyGuard'
import {
  isCanonicalDomainEnabled,
  CANONICAL_DOMAIN_ENV,
  contentHash,
  buildCanonicalImageRow,
  buildCanonicalValueRow,
  computeLeagueHealthSnapshot,
  shadowCompareImage,
  shadowCompareValue,
} from '@/lib/sports-data-gateway/persistence/canonicalPersistence'
import { resolveCanonicalImage } from '@/lib/sports-data-gateway/canonical/canonicalImage'
import { normalizeFantasyCalcValue } from '@/lib/sports-data-gateway/canonical/canonicalValue'

/** Phase 5H-e — canonical persistence contracts (pure). Physical DB proving lives in SPORTS_DATA_NONPROD_MIGRATION_EVIDENCE_5HE.md. */

describe('5H-e — non-production safety guard fails closed', () => {
  const ok = { projectId: APPROVED_NONPROD_PROJECT_ID, projectName: 'decision-os-phaseA-verify', markerPresent: true }
  it('accepts only the approved project + name + present marker', () => {
    expect(checkApprovedNonProdTarget(ok).ok).toBe(true)
  })
  it('rejects a wrong project id', () => {
    expect(checkApprovedNonProdTarget({ ...ok, projectId: 'prod-xyz' }).ok).toBe(false)
  })
  it('rejects a missing marker', () => {
    expect(checkApprovedNonProdTarget({ ...ok, markerPresent: false }).ok).toBe(false)
  })
  it('rejects anything that looks like production', () => {
    expect(checkApprovedNonProdTarget({ ...ok, looksLikeProduction: true }).ok).toBe(false)
  })
  it('the throwing wrapper fails closed', () => {
    expect(() => assertApprovedNonProdTarget({ projectId: null, projectName: null, markerPresent: false })).toThrow(/refusing to run/)
    expect(() => assertApprovedNonProdTarget(ok)).not.toThrow()
  })
})

describe('5H-e — domains are default-off', () => {
  it('every domain gate is off unless explicitly "true"', () => {
    for (const d of Object.keys(CANONICAL_DOMAIN_ENV) as (keyof typeof CANONICAL_DOMAIN_ENV)[]) {
      expect(isCanonicalDomainEnabled(d, {})).toBe(false)
      expect(isCanonicalDomainEnabled(d, { [CANONICAL_DOMAIN_ENV[d]]: 'false' })).toBe(false)
      expect(isCanonicalDomainEnabled(d, { [CANONICAL_DOMAIN_ENV[d]]: 'true' })).toBe(true)
    }
  })
})

describe('5H-e — deterministic mappers + idempotency hash', () => {
  it('contentHash is deterministic and order-sensitive', () => {
    expect(contentHash(['a', 1, true])).toBe(contentHash(['a', 1, true]))
    expect(contentHash(['a', 1])).not.toBe(contentHash([1, 'a']))
  })
  it('image row: same reference → same id/hash (idempotent); placeholder is inactive', () => {
    const ref = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [{ tier: 'verified_official', source: 'espn', url: 'https://a/x.png', imageType: 'headshot', sport: 'NFL' }] })
    const r1 = buildCanonicalImageRow(ref)
    const r2 = buildCanonicalImageRow(ref)
    expect(r1.id).toBe(r2.id)
    expect(r1.contentHash).toBe(r2.contentHash)
    expect(r1.isActive).toBe(true)
    const ph = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p2', sport: 'NFL', imageType: 'headshot', candidates: [{ tier: 'placeholder', source: 'placeholder', url: null, imageType: 'headshot', sport: 'NFL' }] })
    expect(buildCanonicalImageRow(ph).isActive).toBe(false)
  })
  it('value row: valuation vs ranking stay distinct rows (never merged)', () => {
    const recs = normalizeFantasyCalcValue({ sourcePlayerId: '9509', canonicalPlayerId: 'espn:1', providerPosition: 'RB', dynastyValue: 10135, overallRank: 3 }, { leagueFormat: 'dynasty', scoringFormat: 'ppr' }, { sport: 'NFL' })
    const rows = recs.map(buildCanonicalValueRow)
    const types = rows.map((r) => r.valueType).sort()
    expect(types).toEqual(['provider_valuation', 'ranking'])
    const val = rows.find((r) => r.valueType === 'provider_valuation')!
    const rank = rows.find((r) => r.valueType === 'ranking')!
    expect(val.value).toBe(10135)
    expect(val.rank).toBeNull()
    expect(rank.value).toBeNull()
    expect(rank.rank).toBe(3)
    expect(val.id).not.toBe(rank.id) // distinct persistence rows
    expect(val.positionDetail).toBe('RB')
  })
})

describe('5H-e — league health calculator (deterministic, no invented metrics)', () => {
  const facts = { tenantId: 't1', leagueId: 'l1', sport: 'NFL', season: '2026', weekOrPeriod: 'w1', totalManagers: 12, activeManagers: 11, lineupsSet: 110, lineupSlotsExpected: 120, waiverParticipants: 6, tradesCompleted: 1, draftComplete: true, hasScheduleIntegrity: true, hasScoringIntegrity: true }
  it('separates observed / derived / risk; recommendations are NOT observed metrics', () => {
    const s = computeLeagueHealthSnapshot(facts)
    expect(s.observed.activeManagerCount).toBe(11)
    expect(s.observed.inactiveManagerCount).toBe(1)
    expect(s.derived.lineupCompletionRate).toBeCloseTo(0.917, 3)
    expect(s.riskFlags).toContain('inactive_managers')
    expect(s.positiveSignals).toContain('draft_complete')
    // no recommendation field exists on observed/derived
    expect(Object.keys(s.observed)).not.toContain('recommendation')
  })
  it('is deterministic (idempotent recompute)', () => {
    expect(computeLeagueHealthSnapshot(facts)).toEqual(computeLeagueHealthSnapshot(facts))
  })
  it('missing inputs → partial coverage, never invented', () => {
    const s = computeLeagueHealthSnapshot({ ...facts, missingInputs: ['chat_activity'] })
    expect(s.coverageStatus).toBe('partial')
  })
})

describe('5H-e — shadow comparison (pure, no payloads)', () => {
  const ref = resolveCanonicalImage({ entityType: 'player', canonicalEntityId: 'p1', sport: 'NFL', imageType: 'headshot', candidates: [{ tier: 'verified_official', source: 'espn', url: 'https://a/x.png', imageType: 'headshot', sport: 'NFL' }] })
  it('image: identical → match; differing → source_diff; presence mismatch → presence_diff', () => {
    expect(shadowCompareImage('https://a/x.png', ref).match).toBe(true)
    expect(shadowCompareImage('https://a/other.png', ref).category).toBe('source_diff')
    expect(shadowCompareImage(null, ref).category).toBe('presence_diff')
  })
  it('value: identical → match; differing → value_diff', () => {
    const [val] = normalizeFantasyCalcValue({ providerPosition: 'RB', dynastyValue: 10135 }, { leagueFormat: 'dynasty', scoringFormat: 'ppr' }, {})
    expect(shadowCompareValue(10135, val).match).toBe(true)
    expect(shadowCompareValue(9000, val).category).toBe('value_diff')
  })
})
