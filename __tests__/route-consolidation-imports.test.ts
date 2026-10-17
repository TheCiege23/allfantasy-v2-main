import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}))

describe('route consolidation import smoke tests', () => {
  const modules = [
    '../app/api/legacy/[...path]/route',
    '../app/api/leagues/[leagueId]/survivor/[...path]/route',
    '../app/api/ai/community-insights/route',
    '../app/api/ai/decision-log/route',
    '../app/api/ai/waiver/leagues/route',
  ]

  for (const modulePath of modules) {
    it(`loads ${modulePath}`, async () => {
      const mod = await import(modulePath)
      expect(mod).toBeDefined()
    })
  }
})
