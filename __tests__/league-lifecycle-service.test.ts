import { describe, expect, it } from 'vitest'

import { validateTransition, normalizeLifecycleState, isActionAllowed } from '@/server/services/leagueLifecycleService'
import { changedStructuralKeys } from '@/lib/league/structuralSettingsLock'

describe('leagueLifecycleService', () => {
  it('validateTransition rejects duplicate state', () => {
    const r = validateTransition('in_season', 'in_season')
    expect(r.ok).toBe(false)
  })

  it('validateTransition allows in_season -> playoffs', () => {
    const r = validateTransition('in_season', 'playoffs')
    expect(r.ok).toBe(true)
  })

  it('normalizeLifecycleState falls back for unknown', () => {
    expect(normalizeLifecycleState('not_a_state')).toBe('in_season')
  })

  it('commissioners can edit general settings while drafting', () => {
    expect(isActionAllowed('settings_edit_general', 'drafting')).toBe(true)
    // Other sections keep their mid-draft rules.
    expect(isActionAllowed('settings_edit_scoring', 'drafting')).toBe(false)
    expect(isActionAllowed('settings_edit_roster', 'drafting')).toBe(false)
  })

  it('commissioners can edit general settings in the offseason', () => {
    expect(isActionAllowed('settings_edit_general', 'offseason')).toBe(true)
    // Other offseason rules are unchanged.
    expect(isActionAllowed('settings_edit_scoring', 'offseason')).toBe(false)
    expect(isActionAllowed('settings_edit_roster', 'offseason')).toBe(false)
  })

  it('a mid-draft general save still cannot change structural keys', () => {
    // structuralPatchRefusal refuses these once a draft has started, independently of the gate.
    expect(changedStructuralKeys({ name: 'New name', leagueSize: 14, sport: 'NBA' }, { leagueSize: 12, sport: 'NFL' }))
      .toEqual(['sport', 'leagueSize'])
    expect(changedStructuralKeys({ name: 'New name', timezone: 'America/Chicago' }, { leagueSize: 12 })).toEqual([])
  })
})
