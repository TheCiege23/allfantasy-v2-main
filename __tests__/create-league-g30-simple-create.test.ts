import { describe, expect, it } from 'vitest'

import { DEFAULT_V2_STATE, type CreateLeagueV2State } from '@/lib/create-league-v2/state'
import {
  IMPORT_LEAGUE_PROVIDERS,
  UNIVERSAL_CREATE_TEAM_COUNTS,
  getEnabledPremiumAdvancedSettings,
  isUniversalTeamCount,
  validateSimpleCreateState,
} from '@/lib/create-league-v2/simple-create'

function state(overrides: Partial<CreateLeagueV2State> = {}): CreateLeagueV2State {
  return {
    ...DEFAULT_V2_STATE,
    leagueType: 'redraft',
    sport: 'NFL',
    scoringPresetId: 'fb_half_ppr',
    teamCount: 12,
    draftType: 'snake',
    draftDate: '2026-08-30',
    draftTime: '20:00',
    timezone: 'America/New_York',
    privacy: 'private',
    name: 'G30 Unit League',
    nameTouched: true,
    ...overrides,
  }
}

describe('G30 simple universal create helpers', () => {
  it('accepts team counts from 2 through 32 only', () => {
    expect(UNIVERSAL_CREATE_TEAM_COUNTS[0]).toBe(2)
    expect(UNIVERSAL_CREATE_TEAM_COUNTS[UNIVERSAL_CREATE_TEAM_COUNTS.length - 1]).toBe(32)
    expect(isUniversalTeamCount(2)).toBe(true)
    expect(isUniversalTeamCount(32)).toBe(true)
    expect(isUniversalTeamCount(1)).toBe(false)
    expect(isUniversalTeamCount(33)).toBe(false)
  })

  it('validates the required simple create fields', () => {
    expect(validateSimpleCreateState(state())).toEqual([])
    expect(validateSimpleCreateState(state({ teamCount: 33, draftDate: '', name: '' }))).toEqual(
      expect.arrayContaining([
        'Enter a league name.',
        'Team count must be from 2 through 32.',
        'Choose a draft date.',
      ]),
    )
  })

  it('keeps import provider states explicit', () => {
    expect(IMPORT_LEAGUE_PROVIDERS.map((provider) => provider.id)).toEqual([
      'sleeper',
      'espn',
      'fantrax',
      'yahoo',
      'mfl',
      'manual',
    ])
    expect(IMPORT_LEAGUE_PROVIDERS.find((provider) => provider.id === 'sleeper')).toMatchObject({
      state: 'available',
      route: '/import?provider=sleeper',
    })
    expect(IMPORT_LEAGUE_PROVIDERS.filter((provider) => provider.state !== 'available').length).toBeGreaterThan(0)
  })

  it('extracts only enabled premium advanced settings', () => {
    expect(
      getEnabledPremiumAdvancedSettings({
        superflex: true,
        tePremium: false,
        leagueHealthMonitoring: true,
      }),
    ).toEqual(['superflex', 'leagueHealthMonitoring'])
  })
})
