import { describe, expect, it } from 'vitest'

import { getCategoryPresetDefinitions } from '@/lib/category-scoring'
import { CATEGORY_PRESET_IDS } from '@/lib/category-scoring/types'
import { resolveLeagueCategories, validateScoringTypeChange } from '@/lib/category-scoring/leagueScoringType'
import { nativeCategoryScoringContext } from '@/lib/category-scoring/nativeCategoryScoringContext'

/*
 * The scoring and standings engines read a category league's list through `resolveLeagueCategories`,
 * which only knows the presets in `SPORT_SCORING_TYPES`. An NHL category league (`nhl_standard`,
 * offered at creation) was missing there, so it resolved to no categories and scored nothing.
 */
describe('every creatable category preset resolves', () => {
  it.each(CATEGORY_PRESET_IDS)('%s resolves to its preset list', (id) => {
    expect(resolveLeagueCategories({}, id)?.length).toBeGreaterThan(0)
    expect(resolveLeagueCategories({}, id)).toEqual(getCategoryPresetDefinitions(id))
  })

  it('an NHL category league has a native scoring context, head-to-head and roto', () => {
    const h2h = nativeCategoryScoringContext(
      { scoring_mode: 'h2h_category', category_preset_id: 'nhl_standard', category_record_mode: 'most' },
      'NHL',
    )
    expect(h2h?.categories.map((c) => c.label)).toEqual(getCategoryPresetDefinitions('nhl_standard')!.map((c) => c.label))
    expect(
      nativeCategoryScoringContext({ scoring_mode: 'roto', category_preset_id: 'nhl_standard', category_record_mode: 'roto' }, 'NHL'),
    ).not.toBeNull()
  })

  it('an NHL league can switch to categories after creation', () => {
    const none = { mode: 'points', presetId: null, recordMode: null, categoryIds: null }
    expect(validateScoringTypeChange('NHL', { mode: 'h2h_category' }, none)).toMatchObject({ ok: true, next: { presetId: 'nhl_standard' } })
    expect(validateScoringTypeChange('NHL', { mode: 'roto' }, none)).toMatchObject({
      ok: true,
      next: { presetId: 'nhl_standard', recordMode: 'roto' },
    })
  })
})
