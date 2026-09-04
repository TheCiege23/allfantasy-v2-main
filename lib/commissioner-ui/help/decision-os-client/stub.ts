import type { HelpClient } from './types'

export const stubHelpClient: HelpClient = {
  async getArticles() {
    return {
      data: [
        {
          id: 'stub-help-article-1',
          slug: 'stub-article',
          title: 'Stub fixture article.',
          category: 'getting-started',
          summary: 'Stub fixture summary.',
          body: 'Stub fixture body.',
          updatedAt: new Date().toISOString(),
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
  async getGlossary() {
    return {
      data: [
        {
          id: 'stub-help-term-1',
          term: 'Stub Term',
          definition: 'Stub fixture definition.',
        },
      ],
      error: null,
      source: 'stub',
      timestamp: new Date().toISOString(),
    }
  },
}
