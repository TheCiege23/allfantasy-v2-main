import { afterEach, describe, expect, it } from 'vitest'

import {
  getDraftTypeOptions,
  getScoringPresetOptionsForSelection,
  resolveValidDraftTypeForSelection,
  resolveValidScoringPresetIdForSelection,
} from '@/lib/create-league-v2/rules-engine'
import { setClientLeagueCreateOptionsCatalog } from '@/lib/create-league-v2/options-catalog-client'
import { LEAGUE_CREATE_OPTIONS_CATALOG_V1 } from '@/lib/league-creation/options-catalog-seed-data'

describe('create-league-v2 concept-first flow guards', () => {
  afterEach(() => {
    setClientLeagueCreateOptionsCatalog(null)
  })

  it('uses concept+sport draft filtering even when catalog is loaded', () => {
    setClientLeagueCreateOptionsCatalog(LEAGUE_CREATE_OPTIONS_CATALOG_V1)

    const salaryCapDrafts = getDraftTypeOptions('salary_cap', 'NFL').map((option) => option.id)

    expect(salaryCapDrafts).toContain('auction')
    expect(salaryCapDrafts).not.toContain('auto')
    expect(salaryCapDrafts).not.toContain('snake')
    expect(salaryCapDrafts).not.toContain('offline')
  })

  it('resets invalid draft type to first allowed value for concept+sport', () => {
    const resolved = resolveValidDraftTypeForSelection({
      leagueType: 'survivor',
      sport: 'NFL',
      idpSelected: false,
      currentDraftType: 'mock_draft',
    })

    const allowed = getDraftTypeOptions('survivor', 'NFL').map((option) => option.id)
    expect(allowed).toContain(resolved)
    expect(resolved).not.toBe('mock_draft')
  })

  it('resets invalid scoring preset to an allowed concept+sport preset', () => {
    const resolved = resolveValidScoringPresetIdForSelection('nba_points', {
      leagueType: 'redraft',
      sport: 'NFL',
      idpSelected: false,
    })

    const allowed = getScoringPresetOptionsForSelection({
      leagueType: 'redraft',
      sport: 'NFL',
      idpSelected: false,
    }).map((option) => option.id)

    expect(allowed).toContain(resolved)
    expect(resolved).not.toBe('nba_points')
  })
})
