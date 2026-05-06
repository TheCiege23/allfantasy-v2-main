import { describe, expect, it } from 'vitest'

import {
  getPrimaryProviderForSport,
  getProviderForField,
  getProviderPriorityForSport,
  isRollingInsightsPrimarySport,
  isSleeperRookieFallbackForNfl,
  normalizeProviderSport,
} from '@/lib/providers/providerPriority'

describe('providerPriority — NFL', () => {
  it('Rolling Insights is first in NFL chain', () => {
    expect(getProviderPriorityForSport('NFL')[0]).toBe('rolling_insights')
  })

  it('NBA chain omits Sleeper tier', () => {
    expect(getProviderPriorityForSport('NBA').includes('sleeper')).toBe(false)
  })

  it('normalizeProviderSport returns LeagueSport', () => {
    expect(normalizeProviderSport('nba')).toBe('NBA')
  })

  it('isRollingInsightsPrimarySport is true for supported sports', () => {
    expect(isRollingInsightsPrimarySport('SOCCER')).toBe(true)
  })

  it('primary provider for NFL is Rolling Insights', () => {
    expect(getPrimaryProviderForSport('NFL')).toBe('rolling_insights')
  })

  it('maps premium NFL domains to Rolling Insights', () => {
    expect(getProviderForField('NFL', 'player_profile')).toBe('rolling_insights')
    expect(getProviderForField('NFL', 'player_stats')).toBe('rolling_insights')
    expect(getProviderForField('NFL', 'live_scoring')).toBe('rolling_insights')
    expect(getProviderForField('NFL', 'injuries')).toBe('rolling_insights')
    expect(getProviderForField('NFL', 'depth_charts')).toBe('rolling_insights')
  })

  it('maps rookie_years_exp to Sleeper', () => {
    expect(getProviderForField('NFL', 'rookie_years_exp')).toBe('sleeper')
    expect(isSleeperRookieFallbackForNfl('rookie_years_exp')).toBe(true)
    expect(isSleeperRookieFallbackForNfl('player_stats')).toBe(false)
  })
})

describe('providerPriority — NCAA football (Rolling Insights)', () => {
  it('normalizeProviderSport maps NCAAFB / CFB aliases to NCAAF', () => {
    expect(normalizeProviderSport('NCAAFB')).toBe('NCAAF')
    expect(normalizeProviderSport('CFB')).toBe('NCAAF')
  })

  it('maps NCAAFB paid domains to Rolling Insights', () => {
    expect(getProviderForField('NCAAFB', 'player_profile')).toBe('rolling_insights')
    expect(getProviderForField('NCAAFB', 'player_stats')).toBe('rolling_insights')
    expect(getProviderForField('NCAAF', 'live_scoring')).toBe('rolling_insights')
    expect(getProviderForField('CFB', 'schedules')).toBe('rolling_insights')
    expect(getProviderForField('NCAAF', 'teams')).toBe('rolling_insights')
  })

  it('does not route NCAAF rookie_years_exp to Sleeper', () => {
    expect(getProviderForField('NCAAF', 'rookie_years_exp')).toBe('internal')
  })
})

describe('providerPriority — SOCCER (Rolling Insights + league param)', () => {
  it('maps EPL competition alias to Rolling Insights domains', () => {
    expect(getProviderForField('EPL', 'teams')).toBe('rolling_insights')
    expect(getProviderForField('SOCCER', 'live_scoring')).toBe('rolling_insights')
    expect(getProviderForField('LALIGA', 'schedules')).toBe('rolling_insights')
  })
})
