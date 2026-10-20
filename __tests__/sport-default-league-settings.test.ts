import { describe, expect, it } from 'vitest'
import {
  getDefaultLeagueSettings,
  getDefaultLeagueSettingsForVariant,
  buildInitialLeagueSettings,
} from '@/lib/sport-defaults/LeagueDefaultSettingsService'

describe('Default League Settings by Sport', () => {
  it('returns complete defaults for all required sports', () => {
    const sports = ['NFL', 'NBA', 'MLB', 'NHL', 'NCAAF', 'NCAAB'] as const

    for (const sport of sports) {
      const def = getDefaultLeagueSettings(sport)
      expect(def.sport_type).toBe(sport)
      expect(def.default_team_count).toBeGreaterThanOrEqual(8)
      expect(def.regular_season_length).toBeGreaterThan(0)
      expect(def.playoff_team_count).toBeGreaterThan(0)
      expect(def.playoff_structure).toBeTruthy()
      expect(typeof def.matchup_frequency).toBe('string')
      expect(typeof def.season_labeling).toBe('string')
      expect(def.scoring_mode).toBe('points')
      expect(def.roster_mode).toBe('redraft')
      expect(typeof def.waiver_mode).toBe('string')
      expect(def.trade_review_mode).toBe('commissioner')
      expect(Array.isArray(def.standings_tiebreakers)).toBe(true)
      expect(def.standings_tiebreakers.length).toBeGreaterThan(0)
      expect(typeof def.schedule_unit).toBe('string')
      expect(typeof def.injury_slot_behavior).toBe('string')
      expect(typeof def.lock_time_behavior).toBe('string')
    }
  })

  it('keeps expected sport-specific schedule defaults', () => {
    expect(getDefaultLeagueSettings('NFL').regular_season_length).toBe(18)
    // Full real calendars, from lib/sportConfig/dailySportSeasonShape.ts.
    expect(getDefaultLeagueSettings('NBA').regular_season_length).toBe(25)
    expect(getDefaultLeagueSettings('MLB').regular_season_length).toBe(27)
    expect(getDefaultLeagueSettings('NHL').regular_season_length).toBe(28)
    expect(getDefaultLeagueSettings('NCAAF').regular_season_length).toBe(15)
    expect(getDefaultLeagueSettings('NCAAB').regular_season_length).toBe(18)

    expect(getDefaultLeagueSettings('MLB').lock_time_behavior).toBe('slate_lock')
    expect(getDefaultLeagueSettings('NFL').lock_time_behavior).toBe('first_game')
  })

  it('builds variant-aware initial settings for NFL IDP while preserving core defaults', () => {
    const idpDefaults = getDefaultLeagueSettingsForVariant('NFL', 'IDP')
    const baseDefaults = getDefaultLeagueSettings('NFL')
    const initialSettings = buildInitialLeagueSettings('NFL', 'IDP')

    expect(idpDefaults.default_team_count).toBe(baseDefaults.default_team_count)
    expect(idpDefaults.regular_season_length).toBe(baseDefaults.regular_season_length)
    expect(initialSettings.sport_type).toBe('NFL')
    expect(initialSettings.draft_rounds).toBe(18)
    expect(initialSettings.schedule_unit).toBe('week')
    expect(initialSettings.lock_time_behavior).toBe('first_game')
  })
})
