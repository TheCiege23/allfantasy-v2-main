import type { DecisionOSClient } from './types'

/**
 * Demo data catalog — one curated, internally-consistent scenario: "Iron
 * Horse Dynasty," a mid-season 12-team league with a realistic mix of
 * healthy signal and one genuine, believable concern. Designed to be
 * screenshot-safe and demo-safe — no real customer data, ever.
 *
 * A fuller catalog (multiple named scenarios — a struggling league, a
 * brand-new league, a highly competitive one) is a natural extension,
 * deliberately scoped out of this phase in favor of one well-considered
 * scenario over several shallow ones.
 */
function timestamp() {
  return new Date().toISOString()
}

export const demoDecisionOSClient: DecisionOSClient = {
  async getLeagueHealthSummary() {
    return {
      data: {
        score: 88,
        tier: 'positive',
        trendLabel: '+5 over the last month',
        trendDirection: 'up',
        driver: 'Strong trade activity and consistent lineup compliance',
      },
      error: null,
      source: 'demo',
      timestamp: timestamp(),
    }
  },

  async getManagerHighlights() {
    return {
      data: [
        { id: 'demo-mgr-1', managerName: 'Priya Natarajan', callout: 'Most active trader this season — 7 completed trades', tone: 'positive' },
        { id: 'demo-mgr-2', managerName: 'Sam Rivera', callout: 'Engagement declining — 2 missed lineup deadlines', tone: 'risk' },
        { id: 'demo-mgr-3', managerName: 'Marcus Webb', callout: 'Longest continuously active manager — 4th season', tone: 'positive' },
      ],
      error: null,
      source: 'demo',
      timestamp: timestamp(),
    }
  },

  async getMissionControlKpis() {
    return {
      data: {
        openRecommendations: 3,
        activeRisks: 1,
        engagementScore: 91,
        nextDeadlineLabel: 'Trade deadline in 9 days',
      },
      error: null,
      source: 'demo',
      timestamp: timestamp(),
    }
  },

}
