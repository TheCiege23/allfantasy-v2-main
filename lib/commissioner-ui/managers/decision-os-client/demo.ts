import type { ManagerIntelligenceClient } from './types'

/** Same "Iron Horse Dynasty" demo league as Mission Control and League Health, kept internally consistent. */
export const demoManagerIntelligenceClient: ManagerIntelligenceClient = {
  async getManagerDirectory() {
    return {
      data: [
        {
          id: 'demo-mgr-1',
          managerName: 'Priya Natarajan',
          archetype: 'Active Trader',
          tenureSeasons: 3,
          engagementTrend: 'rising',
          reliabilityScore: 96,
          recognition: 'Most active trader this season — 7 completed trades',
        },
        {
          id: 'demo-mgr-2',
          managerName: 'Sam Rivera',
          archetype: 'Quiet Participant',
          tenureSeasons: 1,
          engagementTrend: 'declining',
          reliabilityScore: 61,
          riskFlag: 'Engagement declining for 2 weeks — may benefit from a personal check-in',
        },
        {
          id: 'demo-mgr-3',
          managerName: 'Marcus Webb',
          archetype: 'Steady Operator',
          tenureSeasons: 4,
          engagementTrend: 'steady',
          reliabilityScore: 92,
          recognition: 'Longest continuously active manager — 4th season',
        },
        {
          id: 'demo-mgr-4',
          managerName: 'Devon Okafor',
          archetype: 'Connector',
          tenureSeasons: 1,
          engagementTrend: 'rising',
          reliabilityScore: 85,
          recognition: 'Recently joined as co-commissioner',
        },
      ],
      error: null,
      source: 'demo',
      timestamp: new Date().toISOString(),
    }
  },
}
