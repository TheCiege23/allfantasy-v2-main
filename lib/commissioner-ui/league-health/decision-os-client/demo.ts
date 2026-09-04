import type { LeagueHealthClient } from './types'

function timestamp() {
  return new Date().toISOString()
}

/** "Iron Horse Dynasty" — the same demo league as Mission Control's demo client, kept internally consistent. */
export const demoLeagueHealthClient: LeagueHealthClient = {
  async getHealthDetail() {
    return {
      data: {
        score: 88,
        tier: 'positive',
        baseline: 100,
        deductions: [
          { label: 'Engagement', points: -6 },
          { label: 'Retention', points: -4 },
          { label: 'Competitive Balance', points: -2 },
        ],
        subScores: { engagement: 91, retention: 89, competitiveBalance: 93, risk: 95 },
      },
      error: null,
      source: 'demo',
      timestamp: timestamp(),
    }
  },
  async getRisks() {
    return {
      data: [
        {
          id: 'demo-risk-1',
          description: 'Sam Rivera (Blue Ridge Bandits) has missed lineup deadlines two weeks running',
          severity: 'elevated',
          category: 'Engagement',
          ageInDays: 14,
          status: 'ongoing',
        },
      ],
      error: null,
      source: 'demo',
      timestamp: timestamp(),
    }
  },
  async getEvidence() {
    return {
      data: [
        { label: 'Lineup compliance', detail: '11 of 12 teams set a lineup on time this week' },
        { label: 'Trade activity', detail: '7 completed trades this season, above the league’s 3-season average of 5' },
        { label: 'Standings spread', detail: 'Gap between 1st and 8th place has narrowed to two games' },
      ],
      error: null,
      source: 'demo',
      timestamp: timestamp(),
    }
  },
  async getRecommendations() {
    return {
      data: [
        {
          id: 'demo-lh-rec-1',
          title: 'Manager engagement declining',
          rationale: 'Sam Rivera has missed lineup deadlines two weeks running, after a strong first half.',
          severity: 'elevated',
          confidence: 'high',
          expectedImpact: 'A personal check-in has resolved similar patterns in this league before',
          primaryActionLabel: 'Send Check-In',
          status: 'new',
          category: 'health_and_risk',
          sourceModuleId: 'league-health',
          createdAt: timestamp(),
        },
      ],
      error: null,
      source: 'demo',
      timestamp: timestamp(),
    }
  },
}
