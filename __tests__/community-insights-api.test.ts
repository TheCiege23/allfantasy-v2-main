import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { GET as legacyGet } from '@/server/api-route-modules/legacy/community-insights/route'

// Mock dependencies
// The route checks ORIGIN for the plain public read, and a real NextAuth session only for
// `summarize=true` (a paid model call). `requireAuthOrOrigin` is no longer used: it reads as
// authentication while passing any anonymous caller with a matching Origin.
vi.mock('@/lib/api-auth', () => ({
  validateRequestOrigin: vi.fn(() => true),
  forbiddenResponse: vi.fn((msg) => new NextResponse(JSON.stringify({ error: msg }), { status: 403 })),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsNews: {
      findMany: vi.fn(async () => [
        {
          id: 'news-1',
          sport: 'nfl',
          title: 'Patrick Mahomes to undergo surgery',
          source: 'ESPN',
          team: 'KC',
          publishedAt: new Date(),
        },
        {
          id: 'news-2',
          sport: 'nfl',
          title: 'KC Chiefs prepare for season finale',
          source: 'NFL.com',
          team: 'KC',
          publishedAt: new Date(),
        },
        {
          id: 'news-3',
          sport: 'nfl',
          title: 'Injury concerns plague AFC East',
          source: 'Twitter',
          team: 'NE',
          publishedAt: new Date(),
        },
      ]),
    },
  },
}))

// 60029d4a6 (Slice 18) moved the route off prisma.sportsInjury onto the canonical injury read
// port; the suite kept mocking the old delegate, so the route read nothing from it.
const listInjuryFactsMock = vi.hoisted(() =>
  vi.fn(async (_args: { sport: string; statuses?: string[]; maxAgeHours?: number; limit?: number }) => ({
    facts: [
      {
        id: 'inj-1',
        playerName: 'Travis Kelce',
        team: 'KC',
        position: 'TE',
        status: 'Questionable',
        description: 'Knee injury',
      },
      {
        id: 'inj-2',
        playerName: 'Mahomes',
        team: 'KC',
        position: 'QB',
        status: 'Out',
        description: 'Surgery recovery',
      },
    ],
    newestFetchedAt: new Date(),
    feedStale: false,
  })),
)

const requireAuthMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth-guard', () => ({ requireAuth: () => requireAuthMock() }))

const openaiCreateMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: listInjuryFactsMock,
}))

vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: vi.fn(() => ({
    chat: {
      completions: {
        create: (...args: unknown[]) => openaiCreateMock(...args),
      },
    },
  })),
}))

const OPENAI_REPLY = {
          choices: [
            {
              message: {
                content: 'Patrick Mahomes undergoes surgery; Travis Kelce questionable for next week. Monitor KC backfield and TE depth.',
              },
            },
          ],
}

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: vi.fn((config) => {
    return (handler) => handler
  }),
}))

describe('community-insights API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Signed in by default, so the summarize happy paths run as an authenticated caller.
    requireAuthMock.mockResolvedValue({ ok: true, userId: 'appuser-1', session: null })
    openaiCreateMock.mockResolvedValue(OPENAI_REPLY)
  })

  describe('GET /api/legacy/community-insights', () => {
    it('retrieves community insights without summarization (happy path)', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(200)
      expect(data.trending).toBeDefined()
      expect(Array.isArray(data.trending)).toBe(true)
      expect(data.recentNews).toBeDefined()
      expect(Array.isArray(data.recentNews)).toBe(true)
      expect(data.injuries).toBeDefined()
      expect(Array.isArray(data.injuries)).toBe(true)
      expect(data.dataFreshness).toBeDefined()
      expect(data.audit).toBeDefined()

      // Validate audit structure
      expect(data.audit.sourcesUsed).toBeDefined()
      expect(Array.isArray(data.audit.sourcesUsed)).toBe(true)
      expect(['news', 'injuries']).toEqual(expect.arrayContaining(data.audit.sourcesUsed))
      expect(data.audit.partialData).toBe(false)
      expect(data.audit.errors).toBeDefined()
    })

    it('retrieves community insights with AI summarization (happy path)', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')
      url.searchParams.set('summarize', 'true')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(200)
      expect(data.aiSummary).toBeDefined()
      expect(typeof data.aiSummary).toBe('string')
      expect(data.aiSummary).toContain('Patrick Mahomes')
      expect(data.audit.sourcesUsed).toContain('ai_summary')
    })

    it('includes trending topics aggregation', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(data.trending).toBeDefined()
      expect(Array.isArray(data.trending)).toBe(true)
      // Should have KC team with 2 articles (Mahomes surgery + season prep)
      const kcTopic = data.trending.find((t: any) => t.topic === 'KC')
      expect(kcTopic).toBeDefined()
      expect(kcTopic.count).toBe(2)
      expect(Array.isArray(kcTopic.articles)).toBe(true)
    })

    it('formats recent news articles correctly', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(data.recentNews).toBeDefined()
      expect(data.recentNews.length).toBeGreaterThan(0)
      const article = data.recentNews[0]
      expect(article.title).toBeDefined()
      expect(article.source).toBeDefined()
      expect(article.team).toBeDefined()
      expect(article.publishedAt).toBeDefined()
    })

    it('formats injury data correctly', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(data.injuries).toBeDefined()
      expect(Array.isArray(data.injuries)).toBe(true)
      const injury = data.injuries[0]
      expect(injury.playerName).toBeDefined()
      expect(injury.team).toBeDefined()
      expect(injury.position).toBeDefined()
      expect(injury.status).toBeDefined()
      expect(['Out', 'Doubtful', 'Questionable', 'IR']).toContain(injury.status)
      expect(injury.description).toBeDefined()
      expect(listInjuryFactsMock).toHaveBeenCalledWith(
        expect.objectContaining({ sport: 'NFL', statuses: ['Out', 'Doubtful', 'Questionable', 'IR'] }),
      )
    })

    it('includes data freshness metrics', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(data.dataFreshness).toBeDefined()
      expect(data.dataFreshness.newsCount).toBeGreaterThanOrEqual(0)
      expect(data.dataFreshness.injuryCount).toBeGreaterThanOrEqual(0)
      expect(data.dataFreshness.trendingTopics).toBeGreaterThanOrEqual(0)
    })
  })

  describe('Error handling and edge cases', () => {
    it('returns 403 when the request origin is not allowed', async () => {
      const { validateRequestOrigin } = await import('@/lib/api-auth')
      vi.mocked(validateRequestOrigin).mockReturnValueOnce(false)

      const url = new URL('http://localhost:3000/api/legacy/community-insights')
      const request = new NextRequest(url, {
        method: 'GET',
        headers: { 'X-API-Key': 'invalid-key' },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(403)
      expect(data.error).toBeDefined()
    })

    it('refuses summarize=true without a signed-in session, and never calls the model', async () => {
      requireAuthMock.mockResolvedValueOnce({
        ok: false,
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      })
      const url = new URL('http://localhost:3000/api/legacy/community-insights')
      url.searchParams.set('summarize', 'true')

      const response = await legacyGet(new NextRequest(url, { method: 'GET' }))

      expect(response.status).toBe(401)
      expect(openaiCreateMock).not.toHaveBeenCalled()
    })

    it('serves the public (non-summarized) read without a session', async () => {
      requireAuthMock.mockResolvedValue({
        ok: false,
        response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      })
      const response = await legacyGet(
        new NextRequest(new URL('http://localhost:3000/api/legacy/community-insights'), { method: 'GET' }),
      )

      expect(response.status).toBe(200)
      expect(requireAuthMock).not.toHaveBeenCalled()
      expect(openaiCreateMock).not.toHaveBeenCalled()
    })

    it('gracefully handles missing data sources', async () => {
      // Mock partial failure
      const { prisma } = await import('@/lib/prisma')
      vi.mocked(prisma.sportsNews.findMany).mockRejectedValueOnce(new Error('Database error'))

      const url = new URL('http://localhost:3000/api/legacy/community-insights')
      const request = new NextRequest(url, {
        method: 'GET',
        headers: { 'X-API-Key': 'test-key' },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert - should still return 200 with audit info about partial data
      expect([200, 500]).toContain(response.status)
      expect(data.audit).toBeDefined()
    })

    it('truncates trending topics to max 8', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')
      const request = new NextRequest(url, {
        method: 'GET',
        headers: { 'X-API-Key': 'test-key' },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(data.trending.length).toBeLessThanOrEqual(8)
    })

    it('truncates recent news to max 10', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')
      const request = new NextRequest(url, {
        method: 'GET',
        headers: { 'X-API-Key': 'test-key' },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(data.recentNews.length).toBeLessThanOrEqual(10)
    })
  })

  describe('Telemetry and response validation', () => {
    it('response includes complete audit trail', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/community-insights')
      const request = new NextRequest(url, {
        method: 'GET',
        headers: { 'X-API-Key': 'test-key' },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert
      expect(data.audit.sourcesUsed).toBeDefined()
      expect(typeof data.audit.partialData).toBe('boolean')
      expect(data.audit.missingSources).toBeDefined()
      expect(Array.isArray(data.audit.missingSources)).toBe(true)
      expect(data.audit.errors).toBeDefined()
      expect(Array.isArray(data.audit.errors)).toBe(true)
    })
  })
})
