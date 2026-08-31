import { describe, expect, it } from 'vitest'
import {
  DRAFT_TYPES_BY_LEAGUE_FORMAT,
  SUPPORTED_SPORTS_BY_LEAGUE_FORMAT,
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

  /*
   * ⚠ THIS TEST'S NAME SAYS "MIRRORS" AND IT WAS CHECKING TWO FROZEN ANSWERS.
   * It asserted `('NFL','redraft','slow_draft') === false`; slow_draft is allowed
   * for NFL redraft now, so it went red for a matrix change while the mirroring
   * it claims to guard was never at risk.
   *
   * The two functions mirror BY CONSTRUCTION — isDraftTypeAllowedForConceptAndSport
   * calls getDraftTypesForConceptAndSport and does an includes() on the result.
   * So the property is what is worth asserting, and unlike a hardcoded pair it
   * cannot rot when a draft type is added to or removed from the matrix.
   */
  it('isDraftTypeAllowedForConceptAndSport mirrors getDraftTypesForConceptAndSport', () => {
    const everyDraftType = [
      ...new Set(Object.values(DRAFT_TYPES_BY_LEAGUE_FORMAT).flatMap((ids) => [...ids])),
    ]
    let checks = 0
    for (const format of Object.keys(DRAFT_TYPES_BY_LEAGUE_FORMAT)) {
      const sports = SUPPORTED_SPORTS_BY_LEAGUE_FORMAT[
        format as keyof typeof SUPPORTED_SPORTS_BY_LEAGUE_FORMAT
      ] ?? []
      for (const sport of sports) {
        const allowed = getDraftTypesForConceptAndSport(sport, format)
        for (const draftType of everyDraftType) {
          expect(
            isDraftTypeAllowedForConceptAndSport(sport, format, draftType),
            `${sport}/${format}/${draftType}`,
          ).toBe(allowed.includes(draftType))
          checks += 1
        }
      }
    }
    /*
     * ⚠ A LOOP THAT ITERATES ZERO TIMES PASSES. If the registry ever stopped
     * exporting these tables, or the sport lists came back empty, every assertion
     * above would simply not run and this test would go green having measured
     * nothing — the exact shape of check-that-cannot-fail this repo keeps hitting.
     */
    expect(checks).toBeGreaterThan(50)
    // And an id that is in no format's list is refused everywhere.
    expect(isDraftTypeAllowedForConceptAndSport('NFL', 'redraft', 'not_a_draft_type')).toBe(false)
  })
})
