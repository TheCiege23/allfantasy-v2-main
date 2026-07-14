import { describe, expect, it } from 'vitest'

import {
  getAllowedDraftTypesForLeagueType,
  isDraftTypeAllowedForLeagueType,
} from '@/lib/league-creation-wizard/league-type-registry'

describe('startup draft type allowlist', () => {
  it('keeps redraft draft options to the canonical redraft draft family', () => {
    // The format-engine allowlist (backed by draftTypeRegistry) is the broad
    // validation allowlist and includes slow_draft + mock_draft for redraft.
    // (The create-league wizard narrows this further via getDraftTypeOptions.)
    const allowed = getAllowedDraftTypesForLeagueType('redraft', 'NFL')
    expect(allowed).toEqual(['snake', 'linear', 'auction', 'slow_draft', 'mock_draft'])
    expect(isDraftTypeAllowedForLeagueType('snake', 'redraft', 'NFL')).toBe(true)
    expect(isDraftTypeAllowedForLeagueType('slow_draft', 'redraft', 'NFL')).toBe(true)
    expect(isDraftTypeAllowedForLeagueType('mock_draft', 'redraft', 'NFL')).toBe(true)
    // A devy specialty id is not a base redraft draft type.
    expect(isDraftTypeAllowedForLeagueType('devy_snake', 'redraft', 'NFL')).toBe(false)
  })

  it('keeps C2C startup options to snake, linear, and auction variants', () => {
    const allowed = getAllowedDraftTypesForLeagueType('c2c', 'NFL')
    expect(allowed).toEqual(['c2c_snake', 'c2c_linear', 'c2c_auction'])
  })
})
