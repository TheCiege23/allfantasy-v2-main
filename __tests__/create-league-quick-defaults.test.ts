/**
 * Quick Create template patches — pure defaults from `quick-defaults.ts`.
 */

import { describe, expect, it } from 'vitest'

import { getQuickTemplatePatch, resolveScoringPresetAfterSportChange } from '@/lib/create-league-v2/quick-defaults'
import { getScoringPresetOptionsForSelection } from '@/lib/create-league-v2/rules-engine'
import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'

function seededBase(overrides: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    nameTouched: true,
    name: 'Quick defaults test',
    ...overrides,
  }
}

describe('getQuickTemplatePatch', () => {
  it('casual_redraft hydrates redraft, 10 teams, snake, private, valid scoring preset', () => {
    const patch = getQuickTemplatePatch('casual_redraft', seededBase({ sport: 'NFL' }))
    expect(patch.leagueType).toBe('redraft')
    expect(patch.teamCount).toBe(10)
    expect(patch.draftType).toBe('snake')
    expect(patch.standardDiscoveryVisibility).toBe('private')
    const merged = { ...seededBase({ sport: 'NFL' }), ...patch }
    const opts = getScoringPresetOptionsForSelection({
      leagueType: 'redraft',
      sport: merged.sport,
      idpSelected: false,
    })
    expect(opts.some((o) => o.id === merged.scoringPresetId)).toBe(true)
  })

  it('competitive_redraft hydrates redraft, 12 teams, snake, private', () => {
    const patch = getQuickTemplatePatch('competitive_redraft', seededBase())
    expect(patch.leagueType).toBe('redraft')
    expect(patch.teamCount).toBe(12)
    expect(patch.draftType).toBe('snake')
    expect(patch.standardDiscoveryVisibility).toBe('private')
  })

  it('dynasty hydrates dynasty, 12 teams, private, free by default', () => {
    const patch = getQuickTemplatePatch('dynasty', seededBase())
    expect(patch.leagueType).toBe('dynasty')
    expect(patch.teamCount).toBe(12)
    expect(patch.dynasty?.visibility).toBe('private')
    expect(patch.dynasty?.monetization).toBe('free')
  })

  it('best_ball hydrates best_ball, 12 teams, private, free by default', () => {
    const patch = getQuickTemplatePatch('best_ball', seededBase())
    expect(patch.leagueType).toBe('best_ball')
    expect(patch.teamCount).toBe(12)
    expect(patch.bestBall?.visibility).toBe('private')
    expect(patch.bestBall?.monetization).toBe('free')
  })

  it('guillotine hydrates guillotine, 12 teams, private', () => {
    const patch = getQuickTemplatePatch('guillotine', seededBase())
    expect(patch.leagueType).toBe('guillotine')
    expect(patch.teamCount).toBe(12)
    expect(patch.standardDiscoveryVisibility).toBe('private')
  })

  it('template patches preserve existing sport when possible', () => {
    const base = seededBase({ sport: 'NBA', leagueType: null })
    const patch = getQuickTemplatePatch('casual_redraft', base)
    const merged = { ...base, ...patch }
    expect(merged.sport).toBe('NBA')
  })
})

describe('resolveScoringPresetAfterSportChange', () => {
  it('re-resolves a valid scoring preset when sport changes', () => {
    const merged = { ...seededBase(), ...getQuickTemplatePatch('competitive_redraft', seededBase({ sport: 'NFL' })) }
    expect(merged.leagueType).toBe('redraft')
    const nextId = resolveScoringPresetAfterSportChange(merged.scoringPresetId, 'redraft', 'NBA', false)
    const opts = getScoringPresetOptionsForSelection({
      leagueType: 'redraft',
      sport: 'NBA',
      idpSelected: false,
    })
    expect(opts.some((o) => o.id === nextId)).toBe(true)
  })
})
