import type { ActivityClient } from './types'

export const stubActivityClient: ActivityClient = {
  async getEvents() {
    return {
      data: [
        {
          id: 'stub-activity-1',
          type: 'stub_event',
          sourceModuleId: 'league-health',
          severity: 'informational',
          initiator: 'system',
          summary: 'Stub fixture activity event.',
          timestamp: new Date().toISOString(),
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
