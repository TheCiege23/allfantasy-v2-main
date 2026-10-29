import { describe, expect, it } from 'vitest'

import {
  getAllowedDraftTypesForLeagueType,
  isDraftTypeAllowedForLeagueType,
} from '@/lib/league-creation-wizard/league-type-registry'

describe('startup draft type allowlist', () => {
  /*
   * Redraft (and keeper) now also offer slow and mock drafts at creation —
   * DRAFT_TYPES_REDRAFT in lib/draft-types/draftTypeRegistry.ts, both marked
   * createLeagueSelectable. draft-type-support-matrix.test.ts records the same change.
   * What must stay out are the devy_/c2c_ variants, which belong to their own formats.
   */
  it('offers redraft the base draft families plus slow and mock, and no devy/c2c variants', () => {
    const allowed = getAllowedDraftTypesForLeagueType('redraft', 'NFL')
    expect(allowed).toEqual(['snake', 'linear', 'auction', 'slow_draft', 'mock_draft'])
    expect(allowed.some((id) => id.startsWith('c2c_') || id.startsWith('devy_'))).toBe(false)
    expect(isDraftTypeAllowedForLeagueType('slow_draft', 'redraft', 'NFL')).toBe(true)
    expect(isDraftTypeAllowedForLeagueType('c2c_snake', 'redraft', 'NFL')).toBe(false)
  })

  it('keeps C2C startup options to snake, linear, and auction variants', () => {
    const allowed = getAllowedDraftTypesForLeagueType('c2c', 'NFL')
    expect(allowed).toEqual(['c2c_snake', 'c2c_linear', 'c2c_auction'])
  })
})
