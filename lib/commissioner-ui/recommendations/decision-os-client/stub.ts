import type { RecommendationsClient } from './types'

export const stubRecommendationsClient: RecommendationsClient = {
  async getQueue() {
    return {
      data: [
        {
          id: 'stub-rec-1',
          title: 'Test recommendation',
          rationale: 'Stub fixture rationale.',
          severity: 'standard',
          confidence: 'moderate',
          expectedImpact: 'Stub fixture impact.',
          primaryActionLabel: 'Act',
          status: 'new',
          category: 'administrative',
          sourceModuleId: 'recommendations',
          createdAt: new Date().toISOString(),
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
