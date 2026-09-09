import type { DecisionOSClient } from './types'

/**
 * The stub Decision OS client — the only implementation that exists right
 * now, because the real Decision OS backend is not present in this
 * worktree or on origin/main (verified, documented repeatedly across this
 * program's Implementation Program and Session Completion Reports). Every
 * value below is fixture data, not a computed fact about any real league.
 * Every response is explicitly tagged `source: 'stub'` so the UI layer can
 * — and, until a real implementation exists, must — render an honest
 * "preview data" indicator rather than let this be mistaken for live
 * intelligence.
 */
function timestamp() {
  return new Date().toISOString()
}

export const stubDecisionOSClient: DecisionOSClient = {
  async getActivityTrend() {
    return {
      data: {
        // Six captures is enough to draw a line and short enough to read in a fixture.
        points: [
          { date: '2026-09-04', windowedEventCount: 61 },
          { date: '2026-09-05', windowedEventCount: 60 },
          { date: '2026-09-06', windowedEventCount: 58 },
          { date: '2026-09-07', windowedEventCount: 58 },
          { date: '2026-09-08', windowedEventCount: 55 },
          { date: '2026-09-09', windowedEventCount: 54 },
        ],
        lookbackDays: 90,
      },
      error: null,
      source: 'stub',
      timestamp: timestamp(),
    }
  },

  async getLeagueHealthSummary() {
    return {
      data: {
        score: 84,
        tier: 'advisory',
        trendLabel: '+3 this week',
        trendDirection: 'up',
        driver: 'Driven by strong trade activity',
      },
      error: null,
      source: 'stub',
      timestamp: timestamp(),
    }
  },

  async getManagerHighlights() {
    return {
      data: [
        { id: 'mgr-1', managerName: 'J. Alvarez', callout: 'Most active trader this season', tone: 'positive' },
        { id: 'mgr-2', managerName: 'T. Nguyen', callout: 'Engagement declining for 3 weeks', tone: 'risk' },
      ],
      error: null,
      source: 'stub',
      timestamp: timestamp(),
    }
  },

  async getMissionControlKpis() {
    return {
      data: {
        openRecommendations: 3,
        activeRisks: 1,
        engagementScore: 78,
        nextDeadlineLabel: 'Trade deadline in 12 days',
      },
      error: null,
      source: 'stub',
      timestamp: timestamp(),
    }
  },

}
