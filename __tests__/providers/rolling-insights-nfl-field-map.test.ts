import { describe, expect, it } from 'vitest'

import {
  ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_ENDPOINTS,
  ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP,
  ROLLING_INSIGHTS_NFL_ROOKIE_FALLBACK_POLICY,
  ROLLING_INSIGHTS_NFL_UNMAPPED_PROFILE_FIELDS,
  getRollingInsightsNflFieldPath,
} from '@/lib/providers/rollingInsightsNflFieldMap'

describe('Rolling Insights NFL field map', () => {
  it('maps player_id → providerPlayerId', () => {
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.providerPlayerId).toBe('player_id')
  })

  it('maps player → fullName', () => {
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.fullName).toBe('player')
  })

  it('maps team / team_id / position / position_category / status', () => {
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.teamName).toBe('team')
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.providerTeamId).toBe('team_id')
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.position).toBe('position')
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.positionCategory).toBe('position_category')
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.status).toBe('status')
  })

  it('maps height / weight / age / college / img', () => {
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.height).toBe('height')
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.weight).toBe('weight')
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.birthDateRaw).toBe('age')
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.college).toBe('college')
    expect(ROLLING_INSIGHTS_NFL_PROFILE_FIELD_MAP.headshotImageId).toBe('img')
  })

  it('lists unmapped profile fields including draft + rookie keys', () => {
    expect(ROLLING_INSIGHTS_NFL_UNMAPPED_PROFILE_FIELDS).toEqual(
      expect.arrayContaining([
        'draftYear',
        'yearsExperience',
        'experience',
        'rookie',
        'isRookie',
      ]),
    )
  })

  it('player stats map includes DK fantasy fields', () => {
    expect(ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP.fantasyPoints).toContain('DK_fantasy_points')
    expect(ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP.fantasyPointsPerGame).toContain(
      'DK_fantasy_points_per_game',
    )
  })

  it('player stats map covers offense/defense/kicking style keys', () => {
    expect(ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP.passingYards).toBe('passing_yards')
    expect(ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP.rushingYards).toBe('rushing_yards')
    expect(ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP.receivingYards).toBe('receiving_yards')
    expect(ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP.tackles).toBe('tackles')
    expect(ROLLING_INSIGHTS_NFL_PLAYER_STATS_FIELD_MAP.fieldGoalsMade).toBe('field_goals_made')
  })

  it('live map includes game_ID, game_status, player_box, team_stats paths', () => {
    expect(ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP.gameId).toBe('game_ID')
    expect(ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP.gameStatus).toBe('game_status')
    expect(ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP.playerLiveStats).toBe('player_box')
    expect(ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP.teamLiveStatsHome).toContain('team_stats')
    expect(ROLLING_INSIGHTS_NFL_LIVE_FIELD_MAP.teamLiveStatsAway).toContain('team_stats')
  })

  it('injury map includes player_id, injury, returns, date_injured', () => {
    expect(ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP.providerPlayerId).toBe('player_id')
    expect(ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP.injury).toBe('injury')
    expect(ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP.returnStatus).toBe('returns')
    expect(ROLLING_INSIGHTS_NFL_INJURY_FIELD_MAP.dateInjured).toBe('date_injured')
  })

  it('depth chart map documents id/player + dynamic position/rank markers', () => {
    expect(ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP.providerPlayerId).toBe('id')
    expect(ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP.playerName).toBe('player')
    expect(ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP.depthPositionKey).toContain('position')
    expect(ROLLING_INSIGHTS_NFL_DEPTH_CHART_FIELD_MAP.depthRankKey).toContain('rank')
  })

  it('rookie fallback policy names Sleeper years_exp', () => {
    expect(ROLLING_INSIGHTS_NFL_ROOKIE_FALLBACK_POLICY.fallback).toBe('sleeper_years_exp')
    expect(ROLLING_INSIGHTS_NFL_ROOKIE_FALLBACK_POLICY.fallbackCondition).toContain('years_exp === 0')
    expect(ROLLING_INSIGHTS_NFL_ROOKIE_FALLBACK_POLICY.cacheFallback).toContain(
      'sleeper:nfl:yearsexp:compact:v1',
    )
  })

  it('getRollingInsightsNflFieldPath resolves profile keys', () => {
    expect(getRollingInsightsNflFieldPath('profile', 'fullName')).toBe('player')
    expect(getRollingInsightsNflFieldPath('player_stats', 'fantasyPoints')).toContain('DK_fantasy_points')
  })

  it('exposes endpoint inventory', () => {
    expect(ROLLING_INSIGHTS_NFL_ENDPOINTS.playerInfo).toContain('/player-info/')
    expect(ROLLING_INSIGHTS_NFL_ENDPOINTS.live).toContain('/live/')
  })
})
