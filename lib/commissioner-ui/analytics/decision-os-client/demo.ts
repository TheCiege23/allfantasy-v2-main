import type { AnalyticsClient } from './types'

function ts() {
  return new Date().toISOString()
}

/**
 * "Iron Horse Dynasty" across a full mid-season snapshot — engagement
 * and participation trending up over 11 weeks, a tightly contested
 * competitive-balance picture, and a four-season upward trajectory
 * (2022→2025) consistent with League Health's own current score (88-91)
 * being this league's high point so far.
 */
export const demoAnalyticsClient: AnalyticsClient = {
  async getSnapshot() {
    return {
      data: {
        kpis: [
          { id: 'kpi-engagement', label: 'League Engagement Score', value: '91', trend: { direction: 'up', label: '+4 vs last month' } },
          { id: 'kpi-transactions', label: 'Total Transactions', value: '187', trend: { direction: 'up', label: '+23 this month' } },
          { id: 'kpi-balance', label: 'Competitive Balance Index', value: '0.82', trend: { direction: 'flat', label: 'Steady all season' } },
          { id: 'kpi-active', label: 'Active Managers', value: '12 of 12', trend: { direction: 'flat', label: 'No turnover this season' } },
        ],
        trends: [
          {
            id: 'trend-engagement',
            name: 'League Engagement',
            points: [
              { label: 'Wk 1', value: 82 },
              { label: 'Wk 2', value: 85 },
              { label: 'Wk 3', value: 84 },
              { label: 'Wk 4', value: 87 },
              { label: 'Wk 5', value: 89 },
              { label: 'Wk 6', value: 88 },
              { label: 'Wk 7', value: 90 },
              { label: 'Wk 8', value: 89 },
              { label: 'Wk 9', value: 91 },
              { label: 'Wk 10', value: 90 },
              { label: 'Wk 11', value: 91 },
            ],
          },
          {
            id: 'trend-participation',
            name: 'Lineup Submission Rate',
            points: [
              { label: 'Wk 1', value: 88 },
              { label: 'Wk 2', value: 90 },
              { label: 'Wk 3', value: 91 },
              { label: 'Wk 4', value: 89 },
              { label: 'Wk 5', value: 93 },
              { label: 'Wk 6', value: 92 },
              { label: 'Wk 7', value: 94 },
              { label: 'Wk 8', value: 93 },
              { label: 'Wk 9', value: 95 },
              { label: 'Wk 10', value: 94 },
              { label: 'Wk 11', value: 96 },
            ],
          },
        ],
        competitiveBalance: [
          { label: 'Point differential (1st vs. 12th)', value: '142.3 pts', interpretation: 'Narrower than league average — a tightly contested season.' },
          { label: 'Playoff race margin', value: '2 games', interpretation: 'The closest playoff race in 3 seasons.' },
          { label: 'Championship variety', value: '3 different champions in 4 seasons', interpretation: 'Healthy variety — no single dynasty.' },
        ],
        scoringDistribution: [
          { rangeLabel: '80-99', teamCount: 14 },
          { rangeLabel: '100-119', teamCount: 58 },
          { rangeLabel: '120-139', teamCount: 47 },
          { rangeLabel: '140+', teamCount: 13 },
        ],
        transactionsByWeek: [
          { weekLabel: 'Wk 6', tradeCount: 2, waiverClaimCount: 9 },
          { weekLabel: 'Wk 7', tradeCount: 1, waiverClaimCount: 11 },
          { weekLabel: 'Wk 8', tradeCount: 3, waiverClaimCount: 8 },
          { weekLabel: 'Wk 9', tradeCount: 4, waiverClaimCount: 10 },
          { weekLabel: 'Wk 10', tradeCount: 2, waiverClaimCount: 12 },
          { weekLabel: 'Wk 11', tradeCount: 5, waiverClaimCount: 9 },
        ],
        rosterUtilization: [
          { teamName: 'Priya Natarajan', utilizationPercent: 98 },
          { teamName: 'Sam Rivera', utilizationPercent: 84 },
          { teamName: 'Marcus Webb', utilizationPercent: 96 },
          { teamName: 'Devon Okafor', utilizationPercent: 91 },
          { teamName: 'The Gridiron Giants', utilizationPercent: 95 },
          { teamName: 'Waiver Wire Wizards', utilizationPercent: 89 },
          { teamName: 'Fourth and Long', utilizationPercent: 93 },
          { teamName: 'Hail Mary Heroes', utilizationPercent: 87 },
          { teamName: 'The Injury Reserve', utilizationPercent: 82 },
          { teamName: 'Bench Warmers United', utilizationPercent: 90 },
          { teamName: 'Playoff Bound', utilizationPercent: 97 },
          { teamName: 'Draft Day Dynasty', utilizationPercent: 94 },
        ],
        seasonComparison: [
          { seasonLabel: '2022', value: 74 },
          { seasonLabel: '2023', value: 78 },
          { seasonLabel: '2024', value: 85 },
          { seasonLabel: '2025', value: 91 },
        ],
        /*
         * 30a. Health tracks the engagement trend above but is its own series:
         * the chart compares it against last season and against a target, and
         * neither of those is an engagement number.
         */
        healthByWeek: [
          { weekLabel: 'Wk 1', thisSeason: 71, lastSeason: 68 },
          { weekLabel: 'Wk 2', thisSeason: 74, lastSeason: 70 },
          { weekLabel: 'Wk 3', thisSeason: 73, lastSeason: 72 },
          { weekLabel: 'Wk 4', thisSeason: 76, lastSeason: 71 },
          { weekLabel: 'Wk 5', thisSeason: 79, lastSeason: 73 },
          { weekLabel: 'Wk 6', thisSeason: 78, lastSeason: 70 },
          { weekLabel: 'Wk 7', thisSeason: 81, lastSeason: 69 },
          { weekLabel: 'Wk 8', thisSeason: 80, lastSeason: 67 },
          { weekLabel: 'Wk 9', thisSeason: 83, lastSeason: 66 },
          { weekLabel: 'Wk 10', thisSeason: 82, lastSeason: 64 },
          { weekLabel: 'Wk 11', thisSeason: 84, lastSeason: 63 },
        ],
        healthTarget: 75,
        /*
         * Ordered high to low — the leaderboard renders in given order and the
         * two managers at the bottom are the ones the call-out names. Their
         * prior figures are what make that call-out comparative.
         */
        managerActivity: [
          { managerName: 'Priya Natarajan', actionsPerWeek: 21, priorActionsPerWeek: 19 },
          { managerName: 'Playoff Bound', actionsPerWeek: 18, priorActionsPerWeek: 17 },
          { managerName: 'Marcus Webb', actionsPerWeek: 17, priorActionsPerWeek: 15 },
          { managerName: 'The Gridiron Giants', actionsPerWeek: 15, priorActionsPerWeek: 16 },
          { managerName: 'Draft Day Dynasty', actionsPerWeek: 14, priorActionsPerWeek: 13 },
          { managerName: 'Fourth and Long', actionsPerWeek: 13, priorActionsPerWeek: 14 },
          { managerName: 'Devon Okafor', actionsPerWeek: 12, priorActionsPerWeek: 11 },
          { managerName: 'Waiver Wire Wizards', actionsPerWeek: 11, priorActionsPerWeek: 12 },
          { managerName: 'Bench Warmers United', actionsPerWeek: 9, priorActionsPerWeek: 10 },
          { managerName: 'Hail Mary Heroes', actionsPerWeek: 8, priorActionsPerWeek: 9 },
          { managerName: 'Sam Rivera', actionsPerWeek: 4, priorActionsPerWeek: 13 },
          { managerName: 'The Injury Reserve', actionsPerWeek: 3, priorActionsPerWeek: 12 },
        ],
        pointsForAgainst: [
          { teamName: 'Priya Natarajan', pointsFor: 1412.6, pointsAgainst: 1203.4 },
          { teamName: 'Playoff Bound', pointsFor: 1388.2, pointsAgainst: 1241.8 },
          { teamName: 'Marcus Webb', pointsFor: 1361.9, pointsAgainst: 1288.1 },
          { teamName: 'The Gridiron Giants', pointsFor: 1330.4, pointsAgainst: 1276.5 },
          { teamName: 'Draft Day Dynasty', pointsFor: 1318.7, pointsAgainst: 1302.2 },
          { teamName: 'Fourth and Long', pointsFor: 1294.1, pointsAgainst: 1319.6 },
          { teamName: 'Devon Okafor', pointsFor: 1277.5, pointsAgainst: 1298.9 },
          { teamName: 'Waiver Wire Wizards', pointsFor: 1256.3, pointsAgainst: 1331.7 },
          { teamName: 'Bench Warmers United', pointsFor: 1240.8, pointsAgainst: 1347.2 },
          { teamName: 'Hail Mary Heroes', pointsFor: 1218.4, pointsAgainst: 1352.9 },
          { teamName: 'Sam Rivera', pointsFor: 1191.2, pointsAgainst: 1366.4 },
          { teamName: 'The Injury Reserve', pointsFor: 1164.7, pointsAgainst: 1394.1 },
        ],
        generatedAt: ts(),
      },
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },

  async getSummary() {
    return {
      data: { headline: 'Engagement up 4 points this month — 187 transactions season to date', kpiCount: 4 },
      error: null,
      source: 'demo',
      timestamp: ts(),
    }
  },
}
