import type { ReportsClient } from './types'

export const stubReportsClient: ReportsClient = {
  async getTemplates() {
    return {
      data: [
        {
          id: 'stub-template-1',
          name: 'Test Report',
          description: 'Stub fixture template.',
          category: 'season_recap',
          sourceModuleIds: ['league-health'],
          schedule: { frequency: 'manual' },
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },

  async getHistory() {
    return {
      data: [
        {
          id: 'stub-report-1',
          templateId: 'stub-template-1',
          templateName: 'Test Report',
          status: 'ready',
          format: 'pdf',
          generatedAt: new Date().toISOString(),
          generatedByLabel: 'Test User',
          summary: 'Stub fixture report.',
          sizeLabel: '1 KB',
          shareStatus: 'private',
          relatedLinks: [],
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },

  async getSummary() {
    return {
      data: { headline: '1 report ready', scheduledCount: 0, readyCount: 1 },
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
