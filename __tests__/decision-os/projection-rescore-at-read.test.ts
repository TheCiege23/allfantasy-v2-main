import { describe, it, expect } from 'vitest'

import { rescoreProjectionFacts, type ProjectionFact } from '@/lib/decision-os/projection/facts'

/**
 * The property that makes caching projections at APP level safe.
 *
 * `loadProjectionFacts` originally rescored inside itself, so caching its output would have stored
 * ONE league's IDP points for every league in the sport. That is the defect 1.1b spent a whole
 * change unpicking in Waiver OS and Trade OS — sources declaring `level: 'league'` while deriving
 * user-specific facts — and at app level it would have been worse, because the entry is shared by
 * everyone rather than by one league's members.
 *
 * The fix is a split: cache the canonical fact WITH its raw component amounts, and rescore at
 * read. These tests pin the half that makes it work — one stored object, two leagues, two
 * different correct answers.
 */

const base: ProjectionFact = {
  playerId: 'p1',
  playerName: 'Test Linebacker',
  sport: 'NFL',
  position: 'LB',
  season: 2026,
  week: 3,
  points: 9.06,
  storedPoints: 9.06,
  rescored: false,
  storedPreset: null,
  unscoredComponents: [],
  confidenceLevel: 'medium',
  computedAt: '2026-08-31T07:50:00.000Z',
  validUntil: null,
  factors: { idp: { componentAmounts: { soloTackle: 6, assistTackle: 3, sack: 0.5 } } },
}

describe('rescoreProjectionFacts — one cached fact, many leagues', () => {
  it('🛑 gives two leagues DIFFERENT points from the SAME cached object', () => {
    const balanced = { idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_sack: 2 }
    const tackleHeavy = { idp_tkl_solo: 2, idp_tkl_ast: 1.5, idp_sack: 2 }

    const a = rescoreProjectionFacts([base], balanced)[0]!
    const b = rescoreProjectionFacts([base], tackleHeavy)[0]!

    expect(a.points).not.toBe(b.points)
    expect(b.points).toBeGreaterThan(a.points)
    // The cached input is untouched — rescoring must never mutate the shared object.
    expect(base.points).toBe(9.06)
    expect(base.rescored).toBe(false)
  })

  it('marks a rescored fact so a surface can tell whose rules produced the number', () => {
    const out = rescoreProjectionFacts([base], { idp_tkl_solo: 2, idp_tkl_ast: 1.5 })[0]!
    expect(out.rescored).toBe(true)
    // "9.1 under YOUR rules" and "9.1 under our default" are different claims.
    expect(out.points).not.toBe(out.storedPoints)
  })

  it('returns facts UNCHANGED when the league has no IDP rules — never zeroed', () => {
    const out = rescoreProjectionFacts([base], null)
    expect(out[0]!.points).toBe(9.06)
    expect(out[0]!.rescored).toBe(false)
  })

  it('leaves a fact with no stored components alone rather than dropping it', () => {
    // Older rows and non-IDP players carry no amounts. A null rescore means the stored value
    // stands, which is `rescoreIdpForLeague`'s own contract.
    const noFactors: ProjectionFact = { ...base, factors: null }
    const out = rescoreProjectionFacts([noFactors], { idp_tkl_solo: 9 })[0]!
    expect(out.points).toBe(9.06)
    expect(out.rescored).toBe(false)
  })

  it('names components the league does not score instead of silently lowering the number', () => {
    // A league that ignores `sack` should be able to see that it ignored it.
    const out = rescoreProjectionFacts([base], { idp_tkl_solo: 1, idp_tkl_ast: 0.5 })[0]!
    expect(out.rescored).toBe(true)
    expect(out.unscoredComponents).toContain('sack')
  })
})
