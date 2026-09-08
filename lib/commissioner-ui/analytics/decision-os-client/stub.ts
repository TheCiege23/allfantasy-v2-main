import type { AnalyticsClient } from './types'

export const stubAnalyticsClient: AnalyticsClient = {
  async getSnapshot() {
    return {
      data: {
        kpis: [{ id: 'stub-kpi-1', label: 'Test KPI', value: '1' }],
        trends: [{ id: 'stub-trend-1', name: 'Test Trend', points: [{ label: 'Week 1', value: 1 }] }],
        competitiveBalance: [{ label: 'Test Metric', value: '1', interpretation: 'Stub fixture.' }],
        scoringDistribution: [{ rangeLabel: '100-119', teamCount: 1 }],
        transactionsByWeek: [{ weekLabel: 'Week 1', tradeCount: 1, waiverClaimCount: 1 }],
        rosterUtilization: [{ teamName: 'Test Team', utilizationPercent: 90 }],
        seasonComparison: [{ seasonLabel: '2025', value: 90 }],
        healthByWeek: [{ weekLabel: 'Week 1', thisSeason: 90, lastSeason: 80 }],
        healthTarget: 75,
        managerActivity: [{ managerName: 'Test Manager', actionsPerWeek: 10, priorActionsPerWeek: 12 }],
        pointsForAgainst: [{ teamName: 'Test Team', pointsFor: 100, pointsAgainst: 90 }],
        activityMix: [
          { label: 'Waiver', count: 2 },
          { label: 'Trade', count: 1 },
        ],
        managerFingerprints: [
          { managerName: 'Test Manager', aggression: 40, activity: 30, tradeFrequency: 50, riskTolerance: 20, labels: [] },
        ],
        fingerprintAxisMax: { aggression: 45, activity: 38, tradeFrequency: 100, riskTolerance: 63 },
        allTimeRecords: [{ teamName: 'Test Team', wins: 9, losses: 5, seasons: 1, titles: 1 }],
        // A fixture has no real window. Null renders the page exactly as it did before the
        // window existed, rather than asserting a freshness this data does not have.
        dataWindow: null,
        seasonLabel: '2025',
        generatedAt: new Date().toISOString(),
      },
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },

  async getSummary() {
    return {
      data: { headline: '1 KPI tracked', kpiCount: 1 },
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
