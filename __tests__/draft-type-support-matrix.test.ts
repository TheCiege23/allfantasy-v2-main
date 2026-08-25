import { describe, expect, it } from 'vitest'
import {
  DRAFT_TYPES_BY_LEAGUE_FORMAT,
  getDraftTypesForConceptAndSport,
  isDraftTypeAllowedForConceptAndSport,
  listCreateLeagueWireDraftTypeIds,
  mapCanonicalDraftTypeToEngineCore,
  resolveEffectiveDraftTypeForConcept,
} from '@/lib/draft-types/draftTypeRegistry'
import { getAllowedDraftTypesForFormat } from '@/lib/league/format-engine'
import { getDraftTypeOptions } from '@/lib/create-league-v2/rules-engine'
import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'

describe('draft type support matrix', () => {
  it('keeps format-engine lists aligned with registry BY_LEAGUE_FORMAT', () => {
    const fromRegistry = DRAFT_TYPES_BY_LEAGUE_FORMAT
    for (const key of Object.keys(fromRegistry) as (keyof typeof fromRegistry)[]) {
      const engine = getAllowedDraftTypesForFormat('NFL', key)
      expect(engine).toEqual([...fromRegistry[key]])
    }
  })

  it('exposes salary cap draft mode (auction) — not snake', () => {
    const cap = getDraftTypesForConceptAndSport('NFL', 'salary_cap')
    expect(cap).toContain('auction')
    expect(cap).not.toContain('snake')
  })

  it('restricts devy/c2c to specialty ids for supported sports only', () => {
    const devy = getDraftTypesForConceptAndSport('NFL', 'devy')
    expect(devy).toEqual(['devy_snake', 'devy_linear', 'devy_auction'])
    expect(getDraftTypesForConceptAndSport('MLB', 'devy')).toEqual(
      getDraftTypesForConceptAndSport('NFL', 'redraft')
    )
  })

  it('create-league v2 salary_cap options include auction + auto only', () => {
    const opts = getDraftTypeOptions('salary_cap', 'NFL').map((o) => o.id)
    expect(opts).toContain('auction')
    expect(opts).toContain('auto')
    expect(opts).not.toContain('slow_draft')
    expect(opts).not.toContain('mock_draft')
    expect(opts).not.toContain('offline')
  })

  it('create-league v2 Big Brother startup stays constrained to snake only', () => {
    const opts = getDraftTypeOptions('big_brother', 'NFL').map((o) => o.id)
    expect(opts).toContain('snake')
    expect(opts).not.toContain('auction')
    expect(opts).not.toContain('team')
    expect(opts).not.toContain('auto')
    expect(opts).not.toContain('offline')
  })

  it('resolveEffectiveDraftTypeForConcept maps devy/c2c bases to canonical ids', () => {
    expect(resolveEffectiveDraftTypeForConcept('devy', 'snake')).toBe('devy_snake')
    expect(resolveEffectiveDraftTypeForConcept('devy', 'auction')).toBe('devy_auction')
    expect(resolveEffectiveDraftTypeForConcept('c2c', 'snake')).toBe('c2c_snake')
    expect(resolveEffectiveDraftTypeForConcept('c2c', 'auction')).toBe('c2c_auction')
    expect(resolveEffectiveDraftTypeForConcept('devy', 'offline')).toBe('offline')
  })

  it('mapCanonicalDraftTypeToEngineCore collapses specialty and timing types', () => {
    expect(mapCanonicalDraftTypeToEngineCore('devy_snake')).toBe('snake')
    expect(mapCanonicalDraftTypeToEngineCore('c2c_auction')).toBe('auction')
    expect(mapCanonicalDraftTypeToEngineCore('slow_draft')).toBe('snake')
    expect(mapCanonicalDraftTypeToEngineCore('mock_draft')).toBe('snake')
    expect(mapCanonicalDraftTypeToEngineCore('mock_draft_linear')).toBe('linear')
    expect(mapCanonicalDraftTypeToEngineCore('supplemental_draft_linear')).toBe('linear')
    expect(mapCanonicalDraftTypeToEngineCore('dispersal_draft_snake')).toBe('snake')
    expect(mapCanonicalDraftTypeToEngineCore('offline')).toBe('snake')
  })

  it('wire allowlist includes execution modes for legacy API parity', () => {
    const wire = listCreateLeagueWireDraftTypeIds()
    expect(wire).toContain('offline')
    expect(wire).toContain('auto')
    expect(wire).toContain('team')
  })

  it('validateCreatePayload clears devy canonical ids that match the matrix (blocked only by the college creation gate)', () => {
    const r = validateCreatePayload({
      concept: 'devy',
      sport: 'NFL',
      scoringPreset: 'fb_half_ppr',
      teamCount: 12,
      draftType: 'devy_snake',
      leagueName: 'Matrix Test Devy',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.errors.some((e) => e.code === 'COLLEGE_FORMATS_NOT_OPEN')).toBe(true)
      expect(r.errors.some((e) => e.path === 'draftType')).toBe(false)
    }
  })

  it('blocks invalid concept + draft pairs consistently', () => {
    const bad = validateCreatePayload({
      concept: 'salary_cap',
      sport: 'NFL',
      scoringPreset: 'fb_half_ppr',
      teamCount: 12,
      draftType: 'snake',
      leagueName: 'Should Fail',
    })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors.some((e) => e.path === 'draftType')).toBe(true)
    }
  })

  it('isDraftTypeAllowedForConceptAndSport mirrors getDraftTypesForConceptAndSport', () => {
    /*
     * ⚠ This asserted `('NFL', 'redraft', 'slow_draft') === false`, which stopped being true when
     * `595959f64` (2026-06-12) added `slow_draft` and `mock_draft` to the redraft concept matrix.
     * It is the CONCEPT matrix — what may be persisted — not the wizard menu; redraft's wizard
     * hides `slow_draft` separately, via `NON_PICKABLE_REDFRAFT_DRAFT_IDS`. See
     * `draft-type-startup-allowlist.test.ts` for both halves stated together.
     *
     * The mirror claim in this test's name is now asserted rather than asserted-by-example, so the
     * pair cannot drift apart again without failing here.
     */
    for (const id of getDraftTypesForConceptAndSport('NFL', 'redraft')) {
      expect(isDraftTypeAllowedForConceptAndSport('NFL', 'redraft', id), id).toBe(true)
    }
    expect(isDraftTypeAllowedForConceptAndSport('NFL', 'redraft', 'devy_snake')).toBe(false)
    expect(isDraftTypeAllowedForConceptAndSport('NFL', 'salary_cap', 'snake')).toBe(false)
  })
})
