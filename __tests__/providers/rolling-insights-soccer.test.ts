import { describe, expect, it } from 'vitest'

import { ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT, getRollingInsightsFieldPath, getRollingInsightsSportCode } from '@/lib/providers/rollingInsightsFieldMaps'
import { buildRollingInsightsSoccerUrl } from '@/lib/providers/rollingInsightsSoccerUrl'
import { normalizeSoccerLeague } from '@/lib/providers/rollingInsightsSoccerLeague'
import { isSoccerGameReplaced, normalizeRollingInsightsSoccerStatus, shouldExpectSoccerLiveData } from '@/lib/providers/rollingInsightsSoccerStatus'
import { normalizeRollingInsightsSoccerDraws } from '@/lib/providers/rollingInsightsSoccerTeamStats'

describe('Rolling Insights SOCCER', () => {
  it('maps competition aliases to SOCCER vendor code', () => {
    expect(getRollingInsightsSportCode('SOCCER')).toBe('SOCCER')
    expect(getRollingInsightsSportCode('EPL')).toBe('SOCCER')
    expect(getRollingInsightsSportCode('LA_LIGA')).toBe('SOCCER')
  })

  it('normalizes league labels to EPL / LALIGA / SERIEA', () => {
    expect(normalizeSoccerLeague('Premier League')).toBe('EPL')
    expect(normalizeSoccerLeague('English Premier League')).toBe('EPL')
    expect(normalizeSoccerLeague('LA_LIGA')).toBe('LALIGA')
    expect(normalizeSoccerLeague('Serie A')).toBe('SERIEA')
  })

  it('exposes SOCCER team_info and schedule field paths', () => {
    expect(getRollingInsightsFieldPath('EPL', 'team', 'league')).toBe('league')
    expect(getRollingInsightsFieldPath('SOCCER', 'schedule', 'gameId')).toBe('game_ID')
    expect(getRollingInsightsFieldPath('SOCCER', 'profile', 'birthDateRaw')).toBe('age')
    expect(getRollingInsightsFieldPath('SOCCER', 'soccer_live', 'gameId')).toBe('game_ID')
    expect(getRollingInsightsFieldPath('SOCCER', 'soccer_live_team_stats', 'corners')).toBe('team_stats.corners')
    expect(getRollingInsightsFieldPath('SOCCER', 'soccer_live_goalkeeper', 'saves')).toBe('saves')
    expect(getRollingInsightsFieldPath('SOCCER', 'soccer_team_season_stats', 'goalsScored')).toBe(
      'regular_season.goals_scored',
    )
  })

  it('documents schedule-daily + weekly endpoints', () => {
    expect(ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT.SOCCER.scheduleDay).toContain('schedule-daily')
    expect(ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT.SOCCER.scheduleWeek).toContain('schedule-weekly')
    expect(ROLLING_INSIGHTS_ENDPOINTS_BY_SPORT.SOCCER.scheduleDayAlias).toContain('/schedule/')
  })

  it('URL builder requires league + token', () => {
    expect(buildRollingInsightsSoccerUrl('team_info', { token: '', league: 'EPL' }).ok).toBe(false)
    expect(buildRollingInsightsSoccerUrl('team_info', { token: 't', league: 'nope' }).ok).toBe(false)
    const ok = buildRollingInsightsSoccerUrl('team_info', { token: 'x', league: 'EPL' })
    expect(ok.ok && ok.url.includes('league=EPL') && ok.url.includes('RSC_token=x')).toBe(true)
  })

  it('URL builder adds relegated for team_info', () => {
    const r = buildRollingInsightsSoccerUrl('team_info', {
      token: 't',
      league: 'EPL',
      relegated: true,
    })
    expect(r.ok && r.url.includes('relegated=TRUE')).toBe(true)
  })

  it('status helpers treat replaced as no live expectation', () => {
    expect(isSoccerGameReplaced('replaced')).toBe(true)
    expect(shouldExpectSoccerLiveData('replaced')).toBe(false)
    expect(normalizeRollingInsightsSoccerStatus(null)).toBe('unknown')
  })

  it('draws merge ties + draws', () => {
    expect(normalizeRollingInsightsSoccerDraws({ draws: 4 })).toBe(4)
    expect(normalizeRollingInsightsSoccerDraws({ ties: 3 })).toBe(3)
    expect(normalizeRollingInsightsSoccerDraws({ draws: 1, ties: 9 })).toBe(1)
  })
})
