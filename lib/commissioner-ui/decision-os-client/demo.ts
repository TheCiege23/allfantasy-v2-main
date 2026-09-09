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
  /*
   * A realistic 30-capture series that DECLINES, which is the shape a real dynasty league shows
   * outside its season: the rolling window is shedding draft-week activity faster than the offseason
   * replaces it. A flat or rising demo line would teach a viewer that a falling line means trouble,
   * when for most of the year it means the calendar.
   */
  async getActivityTrend() {
    const start = 118
    /*
     * Dates are walked through a real Date so the series crosses a month boundary correctly. Building
     * them by padding an incrementing day number collapsed everything past the 31st onto one date, and
     * a chart with duplicate x-values silently stacks points on top of each other.
     */
    const first = Date.UTC(2026, 7, 11) // 2026-08-11
    const points = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(first + i * 86_400_000).toISOString().slice(0, 10)
      // A gentle decline with a small mid-series bump, so it reads as measured rather than generated.
      const drift = Math.round(i * 1.4)
      const bump = i === 12 || i === 13 ? 6 : 0
      return { date, windowedEventCount: start - drift + bump }
    })
    return { data: { points, lookbackDays: 90 }, error: null, source: 'demo', timestamp: timestamp() }
  },

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
