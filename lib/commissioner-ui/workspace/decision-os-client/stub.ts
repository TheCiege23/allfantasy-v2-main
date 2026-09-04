import type { WorkspaceClient } from './types'

export const stubWorkspaceClient: WorkspaceClient = {
  async getTasks() {
    return {
      data: [
        {
          id: 'stub-task-1',
          title: 'Test task',
          description: 'Stub fixture task.',
          status: 'open',
          priority: 'standard',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          automationCandidate: false,
          relatedLinks: [],
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
