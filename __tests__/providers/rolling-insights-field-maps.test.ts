import { describe, expect, it } from 'vitest'

import {
  ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT,
  ROLLING_INSIGHTS_FIELD_MAPS,
  getRollingInsightsFieldPath,
  getRollingInsightsMappedCanonicalFields,
  getRollingInsightsSportCode,
  getRollingInsightsUnmappedCanonicalFields,
} from '@/lib/providers/rollingInsightsFieldMaps'
import { ROLLING_INSIGHTS_NFL_UNMAPPED_PROFILE_FIELDS } from '@/lib/providers/rollingInsightsNflFieldMap'

describe('rollingInsightsFieldMaps', () => {
  it('maps NCAAF aliases to NCAAFB for RI', () => {
    expect(getRollingInsightsSportCode('NCAAF')).toBe('NCAAFB')
    expect(getRollingInsightsSportCode('NCAAFB')).toBe('NCAAFB')
    expect(getRollingInsightsSportCode('CFB')).toBe('NCAAFB')
    expect(getRollingInsightsSportCode('NCAAFOOTBALL')).toBe('NCAAFB')
  })

  it('maps NCAAB to NCAABB for RI', () => {
    expect(getRollingInsightsSportCode('NCAAB')).toBe('NCAABB')
  })

  it('NFL profile leaves rookie/draft fields unmapped', () => {
    const u = getRollingInsightsUnmappedCanonicalFields('NFL', 'profile')
    expect(u).toEqual(expect.arrayContaining([...ROLLING_INSIGHTS_NFL_UNMAPPED_PROFILE_FIELDS]))
  })

  it('NBA live map contains core box stats', () => {
    expect(getRollingInsightsFieldPath('NBA', 'live', 'points')).toBe('points')
    expect(getRollingInsightsFieldPath('NBA', 'live', 'assists')).toBe('assists')
    expect(getRollingInsightsFieldPath('NBA', 'live', 'minutes')).toBe('minutes')
    expect(getRollingInsightsMappedCanonicalFields('NBA', 'live')).toContain('threePointsMade')
  })

  it('MLB batting/pitching maps contain documented keys', () => {
    expect(getRollingInsightsFieldPath('MLB', 'live_batting', 'hr')).toBe('HR')
    expect(getRollingInsightsFieldPath('MLB', 'live_pitching', 'k')).toBe('K')
  })

  it('NHL skaters and goalies maps contain documented keys', () => {
    expect(getRollingInsightsFieldPath('NHL', 'live_skaters', 'goals')).toBe('goals')
    expect(getRollingInsightsFieldPath('NHL', 'live_goalies', 'saves')).toBe('saves')
  })

  it('NCAABB live includes starter and shooting stats', () => {
    expect(getRollingInsightsFieldPath('NCAAB', 'live', 'starter')).toBe('starter')
    expect(getRollingInsightsFieldPath('NCAABB', 'live', 'points')).toBe('points')
  })

  it('NCAAFB profile maps class to collegeClass', () => {
    expect(getRollingInsightsFieldPath('NCAAF', 'profile', 'collegeClass')).toBe('class')
    expect(getRollingInsightsFieldPath('NCAAF', 'player_stats', 'passingYards')).toContain(
      'passing_yards',
    )
    expect(getRollingInsightsFieldPath('NCAAF', 'player_stats', 'twoPointConversionPassAttempts')).toContain(
      'two_point_conversion_pass_attempts',
    )
  })

  it('NCAAFB live / schedule / team maps', () => {
    expect(getRollingInsightsFieldPath('NCAAF', 'ncaaf_live', 'gameId')).toBe('game_ID')
    expect(getRollingInsightsFieldPath('NCAAF', 'ncaaf_live_current', 'timeRemaining')).toBe(
      'full_box.current.TimeRemaining',
    )
    expect(getRollingInsightsFieldPath('NCAAF', 'ncaaf_live_team', 'homeScore')).toBe(
      'full_box.home_team.score',
    )
    expect(getRollingInsightsFieldPath('NCAAF', 'ncaaf_live_team_stats', 'pointsAgainstDefenseSpecialTeams')).toBe(
      'team_stats.points_against_defense_special_teams',
    )
    expect(getRollingInsightsFieldPath('NCAAF', 'ncaaf_live_player_box', 'fumblesRecoveries')).toBe(
      'fumbles_recoveries',
    )
    expect(getRollingInsightsFieldPath('NCAAF', 'schedule', 'postalCode')).toBe('postal_code')
    expect(getRollingInsightsFieldPath('NCAAF', 'team', 'conference')).toBe('conf')
    expect(getRollingInsightsFieldPath('NCAAF', 'ncaaf_team_season_stats', 'pointsAgainstDefenseSpecialTeams')).toContain(
      'points_against_defense_special_teams',
    )
  })

  it('FIELD_MAPS exposes NFL and NBA entries', () => {
    expect(ROLLING_INSIGHTS_FIELD_MAPS.NFL.profile).toBeDefined()
    expect(ROLLING_INSIGHTS_FIELD_MAPS.NBA?.live).toBeDefined()
  })

  it('NCAAFB endpoints use YYYY season path + schedule-week date path', () => {
    expect(ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT.NCAAFB.scheduleSeason).toContain('<YYYY>')
    expect(ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT.NCAAFB.scheduleWeek).toContain('schedule-week')
    expect(ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT.NCAAFB.teamStats).toContain('<YYYY>')
  })

  it('SOCCER profile + live maps are registered', () => {
    expect(ROLLING_INSIGHTS_FIELD_MAPS.SOCCER?.profile?.birthDateRaw).toBe('age')
    expect(getRollingInsightsFieldPath('Serie A', 'soccer_live_player', 'goals')).toBe('goals')
  })
})
