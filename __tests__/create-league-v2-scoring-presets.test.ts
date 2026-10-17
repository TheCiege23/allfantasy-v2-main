import { describe, expect, it } from 'vitest'

import {
  listScoringPresetOptions,
  resolveScoringPresetId,
} from '@/lib/league-creation-preset/scoring-presets'

describe('create-league scoring presets', () => {
  it('includes football presets for survivor leagues', () => {
    const options = listScoringPresetOptions({
      leagueType: 'survivor',
      sport: 'NFL',
      idpSelected: false,
    })

    expect(options.map((option) => option.id)).toContain('fb_half_ppr')
  })

  it('falls back to survivor default when the current preset is invalid', () => {
    const presetId = resolveScoringPresetId('nba_points', {
      leagueType: 'survivor',
      sport: 'NFL',
      idpSelected: false,
    })

    expect(presetId).toBe('fb_half_ppr')
  })
})

import { getScoringPresetOptionsForSelection } from '@/lib/create-league-v2/rules-engine'
import { getFallbackLeagueCreateOptionsCatalog, getAllowedScoringPresetsFromCatalog } from '@/lib/league-creation/options-catalog'
it.each(['redraft','dynasty','keeper'] as const)('exposes every MLB category preset in the wizard and server catalog for %s', leagueType => {
  const expected=['mlb_5x5_each','mlb_5x5_most','mlb_5x5_roto','mlb_6x6_each','mlb_6x6_most','mlb_6x6_roto']
  const ui=getScoringPresetOptionsForSelection({leagueType,sport:'MLB',idpSelected:false}).map(option=>option.id)
  const allowed=getAllowedScoringPresetsFromCatalog(getFallbackLeagueCreateOptionsCatalog(),leagueType,'MLB')
  expect(ui).toEqual(expect.arrayContaining(expected))
  expect(allowed).toEqual(expect.arrayContaining(expected))
})
it('keeps MLB category formats out of best ball', () => {
  const ui=getScoringPresetOptionsForSelection({leagueType:'best_ball',sport:'MLB',idpSelected:false}).map(option=>option.id)
  expect(ui).toEqual(['mlb_points'])
})
