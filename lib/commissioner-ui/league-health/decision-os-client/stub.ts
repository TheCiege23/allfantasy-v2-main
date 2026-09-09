import type { LeagueHealthClient } from './types'

function timestamp() {
  return new Date().toISOString()
}

export const stubLeagueHealthClient: LeagueHealthClient = {
  async getHealthDetail() {
    return {
      data: {
        score: 84,
        tier: 'advisory',
        retentionRisk: 'elevated',
        commissionerWorkload: 'standard',
        participation: { activeManagers: 9, totalManagers: 12 },
        completeness: 70,
      },
      error: null,
      source: 'stub',
      timestamp: timestamp(),
    }
  },
  async getRisks() {
    return {
      data: [
        { id: 'risk-1', description: 'One manager inactive for 3+ weeks', severity: 'elevated', category: 'Engagement', ageInDays: 21, status: 'ongoing' },
      ],
      error: null,
      source: 'stub',
      timestamp: timestamp(),
    }
  },
  async getEvidence() {
    return {
      data: [{ label: 'Lineup compliance', detail: '10 of 12 teams set a lineup on time this week' }],
      error: null,
      source: 'stub',
      timestamp: timestamp(),
    }
  },
  async getRecommendations() {
    return { data: [], error: null, source: 'stub', timestamp: timestamp() }
  },
}
