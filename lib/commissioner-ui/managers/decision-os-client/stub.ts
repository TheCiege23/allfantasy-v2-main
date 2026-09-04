import type { ManagerIntelligenceClient } from './types'

export const stubManagerIntelligenceClient: ManagerIntelligenceClient = {
  async getManagerDirectory() {
    return {
      data: [
        {
          id: 'stub-mgr-1',
          managerName: 'Test Manager One',
          archetype: 'Steady Operator',
          tenureSeasons: 2,
          engagementTrend: 'steady',
          reliabilityScore: 88,
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
