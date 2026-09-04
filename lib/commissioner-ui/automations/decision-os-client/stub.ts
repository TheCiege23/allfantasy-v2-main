import type { AutomationClient } from './types'

export const stubAutomationClient: AutomationClient = {
  async getCatalog() {
    return {
      data: [
        {
          id: 'stub-auto-1',
          name: 'Test automation',
          description: 'Stub fixture automation.',
          category: 'communications',
          status: 'enabled',
          health: 'positive',
          schedule: { triggerType: 'manual', description: 'Manual only.' },
          totalRunsCount: 1,
          successRatePercent: 100,
          relatedLinks: [],
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },

  async getExecutionHistory(automationId) {
    return {
      data: [
        {
          id: 'stub-exec-1',
          automationId,
          startedAt: new Date().toISOString(),
          durationMs: 100,
          result: 'success',
          summary: 'Stub fixture execution.',
          detail: 'Stub fixture execution detail.',
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },

  async getSummary() {
    return {
      data: { totalCount: 1, activeCount: 1, needsAttentionCount: 0, headline: '1 of 1 automations active' },
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
