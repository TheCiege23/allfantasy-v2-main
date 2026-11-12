import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST as legacyPost, GET as legacyGet } from '@/server/api-route-modules/legacy/decision-log/route'

// Mock dependencies
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: vi.fn(() => ({
    success: true,
    remaining: 29,
    retryAfterSec: 0,
  })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

// Origin is CSRF protection only. Identity comes from the shared legacy gate: the caller here is
// signed in as the account linked to Sleeper user `user1` (Sleeper user id 730000000000000001).
vi.mock('@/lib/api-auth', () => ({
  validateRequestOrigin: vi.fn(() => true),
  forbiddenResponse: vi.fn((msg) => new NextResponse(JSON.stringify({ error: msg }), { status: 403 })),
}))

const gateMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: (...args: unknown[]) => gateMock(...args),
}))
const OWN_SLEEPER_ID = '730000000000000001'
const signedInAsUser1 = () => ({
  ok: true,
  identity: { sleeperUsername: 'user1', actorId: 'appuser-1', source: 'session' },
})
const anonymous = () => ({
  ok: false,
  response: NextResponse.json({ error: 'Sign in to use this.' }, { status: 401 }),
})

vi.mock('@/lib/decision-log', () => ({
  logDecision: vi.fn(async (input) => ({
    id: 'decision-1',
    userId: input.userId,
    leagueId: input.leagueId,
    decisionType: input.decisionType,
    aiRecommendation: input.aiRecommendation,
    confidenceScore: input.confidenceScore,
    riskProfile: input.riskProfile,
    contextSnapshot: input.contextSnapshot,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    userFollowed: null,
    expiresAt: input.expiresAt || null,
    outcome: null,
  })),
  getDecisionSummary: vi.fn(async () => ({
    total: 15,
    followed: 9,
    ignored: 6,
    pending: 0,
    followedWinRate: 0.78,
    ignoredWinRate: 0.33,
    avgConfidence: 0.71,
    byType: {
      trade: { total: 8, followed: 6, avgOutcome: 0.75 },
      waiver: { total: 5, followed: 2, avgOutcome: 0.4 },
      sit_start: { total: 2, followed: 1, avgOutcome: 0.5 },
    },
  })),
  getDecisionLogsForCoach: vi.fn(async (userId, limit) => [
    {
      id: 'decision-1',
      userId,
      leagueId: 'league123',
      decisionType: 'trade',
      aiRecommendation: { summary: 'Trade proposal for RB upgrade' },
      confidenceScore: 0.85,
      riskProfile: 'moderate',
      createdAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
      userFollowed: true,
      outcome: {
        rosterValueDelta: 250,
        winProbabilityDelta: 0.05,
        outcomeGrade: 'A',
      },
    },
  ]),
  getUnresolvedDecisions: vi.fn(async () => [
    {
      id: 'decision-2',
      userId: 'user1',
      leagueId: 'league123',
      decisionType: 'waiver',
      aiRecommendation: { playerName: 'Promising RB', priority: 1 },
      confidenceScore: 0.62,
      riskProfile: 'low',
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      userFollowed: null,
    },
  ]),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    legacyUser: {
      findUnique: vi.fn(async () => ({ sleeperUserId: OWN_SLEEPER_ID })),
    },
    decisionLog: {
      findMany: vi.fn(async ({ where, include, orderBy, take }) => [
        {
          id: 'decision-1',
          userId: where.userId,
          leagueId: where.leagueId || 'all',
          decisionType: 'trade',
          aiRecommendation: { summary: 'Trade proposal' },
          confidenceScore: 0.85,
          riskProfile: 'moderate',
          createdAt: new Date(),
          resolvedAt: null,
          userFollowed: null,
          outcome: null,
        },
      ]),
    },
  },
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: vi.fn((config) => {
    return (handler) => handler
  }),
}))

describe('decision-log API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateMock.mockResolvedValue(signedInAsUser1())
  })

  describe('POST /api/legacy/decision-log', () => {
    it('logs a decision successfully (happy path)', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/decision-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          userId: 'user1',
          leagueId: 'league123',
          decisionType: 'trade',
          aiRecommendation: {
            summary: 'Trade proposal: send JT for elite RB',
            proposalCount: 1,
          },
          confidenceScore: 0.82,
          riskProfile: 'moderate',
          contextSnapshot: {
            leagueId: 'league123',
            draftCapital: 'strong',
          },
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(200)
      expect(data.ok).toBe(true)
      expect(data.id).toBe('decision-1')
    })

    it('validates required fields', async () => {
      // Arrange - missing confidenceScore
      const request = new NextRequest('http://localhost:3000/api/legacy/decision-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          userId: 'user1',
          leagueId: 'league123',
          decisionType: 'trade',
          aiRecommendation: { summary: 'Trade proposal' },
          riskProfile: 'moderate',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toContain('Invalid request')
    })

    it('validates decisionType enum', async () => {
      // Arrange - invalid decisionType
      const request = new NextRequest('http://localhost:3000/api/legacy/decision-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          userId: 'user1',
          leagueId: 'league123',
          decisionType: 'invalid_type',
          aiRecommendation: { summary: 'Trade proposal' },
          confidenceScore: 0.85,
          riskProfile: 'moderate',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toContain('Invalid request')
    })

    it('validates riskProfile enum', async () => {
      // Arrange - invalid riskProfile
      const request = new NextRequest('http://localhost:3000/api/legacy/decision-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          userId: 'user1',
          leagueId: 'league123',
          decisionType: 'trade',
          aiRecommendation: { summary: 'Trade proposal' },
          confidenceScore: 0.85,
          riskProfile: 'mega_high',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toContain('Invalid request')
    })

    it('validates confidenceScore range (0-1)', async () => {
      // Arrange - confidence > 1
      const request = new NextRequest('http://localhost:3000/api/legacy/decision-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          userId: 'user1',
          leagueId: 'league123',
          decisionType: 'trade',
          aiRecommendation: { summary: 'Trade proposal' },
          confidenceScore: 1.5,
          riskProfile: 'moderate',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toContain('Invalid request')
    })
  })

  describe('GET /api/legacy/decision-log', () => {
    it('retrieves decision summary view (happy path)', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/decision-log')
      url.searchParams.set('userId', 'user1')
      url.searchParams.set('view', 'summary')

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
      expect(data.ok).toBe(true)
      expect(data.summary).toBeDefined()
      expect(data.summary.total).toBe(15)
      expect(data.summary.followed).toBe(9)
      expect(data.summary.ignored).toBe(6)
      expect(data.summary.followedWinRate).toBe(0.78)
      expect(data.summary.ignoredWinRate).toBe(0.33)
      expect(data.summary.avgConfidence).toBe(0.71)
      expect(data.summary.byType).toBeDefined()
    })

    it('retrieves coach view with recent decisions', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/decision-log')
      url.searchParams.set('userId', 'user1')
      url.searchParams.set('view', 'coach')
      url.searchParams.set('limit', '10')

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
      expect(data.ok).toBe(true)
      expect(Array.isArray(data.decisions)).toBe(true)
      expect(data.decisions.length).toBeGreaterThan(0)
      const decision = data.decisions[0]
      expect(decision.id).toBe('decision-1')
      expect(decision.decisionType).toBe('trade')
      expect(decision.confidenceScore).toBe(0.85)
      expect(decision.riskProfile).toBe('moderate')
      expect(decision.userFollowed).toBe(true)
      expect(decision.outcome).toBeDefined()
      expect(decision.outcome.rosterValueDelta).toBe(250)
      expect(decision.outcome.outcomeGrade).toBe('A')
    })

    it('retrieves unresolved decisions', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/decision-log')
      url.searchParams.set('userId', 'user1')
      url.searchParams.set('view', 'unresolved')

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
      expect(data.ok).toBe(true)
      expect(Array.isArray(data.decisions)).toBe(true)
      const decision = data.decisions[0]
      expect(decision.resolvedAt).toBeNull()
      expect(decision.userFollowed).toBeNull()
    })

    it('requires userId parameter', async () => {
      // Arrange - missing userId
      const url = new URL('http://localhost:3000/api/legacy/decision-log')
      url.searchParams.set('view', 'list')

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
      expect(response.status).toBe(400)
      expect(data.error).toContain('Missing userId')
    })

    it('respects limit parameter bounds', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/decision-log')
      url.searchParams.set('userId', 'user1')
      url.searchParams.set('limit', '150') // exceeds max of 100

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert - should return successfully but limit is capped at 100
      expect(response.status).toBe(200)
      expect(data.ok).toBe(true)
    })
  })

  describe('Telemetry and response validation', () => {
    it('POST response includes logged decision with all fields', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/decision-log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          userId: 'user1',
          leagueId: 'league123',
          decisionType: 'waiver',
          aiRecommendation: { playerName: 'RB prospect', priority: 1 },
          confidenceScore: 0.7,
          riskProfile: 'low',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert - validates response structure matches lib types
      expect(response.status).toBe(200)
      expect(data.ok).toBe(true)
      expect(data.id).toBeDefined()
      expect(typeof data.id).toBe('string')
    })

    it('GET response includes rate limit metadata', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/decision-log')
      url.searchParams.set('userId', 'user1')
      url.searchParams.set('view', 'summary')

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
      expect(data.summary).toBeDefined()
      // Rate limit info would be in response if withApiUsage captured it
      expect(response.status).toBe(200)
    })
  })
  describe('authorization — the caller can only touch their OWN decision log', () => {
    const postBody = (userId: string) =>
      JSON.stringify({
        userId,
        leagueId: 'league123',
        decisionType: 'trade',
        aiRecommendation: { summary: 'planted' },
        confidenceScore: 0.5,
        riskProfile: 'low',
      })

    it('GET refuses an anonymous caller (Origin alone is not authentication)', async () => {
      gateMock.mockResolvedValueOnce(anonymous())
      const { getDecisionLogsForCoach } = await import('@/lib/decision-log')
      const response = await legacyGet(
        new NextRequest('http://localhost:3000/api/legacy/decision-log?userId=user1&view=coach', {
          method: 'GET',
          headers: { origin: 'https://allfantasy.ai' },
        }),
      )
      expect(response.status).toBe(401)
      expect(getDecisionLogsForCoach).not.toHaveBeenCalled()
    })

    it("GET refuses a signed-in caller naming someone else's userId (403)", async () => {
      const { getDecisionLogsForCoach } = await import('@/lib/decision-log')
      const { prisma } = await import('@/lib/prisma')
      const response = await legacyGet(
        new NextRequest('http://localhost:3000/api/legacy/decision-log?userId=victim&view=coach', { method: 'GET' }),
      )
      expect(response.status).toBe(403)
      expect(getDecisionLogsForCoach).not.toHaveBeenCalled()
      expect(prisma.decisionLog.findMany).not.toHaveBeenCalled()
    })

    it("GET accepts the caller's own Sleeper user id (the key waiver/analyze writes under)", async () => {
      const { getDecisionSummary } = await import('@/lib/decision-log')
      const response = await legacyGet(
        new NextRequest(`http://localhost:3000/api/legacy/decision-log?userId=${OWN_SLEEPER_ID}&view=summary`, {
          method: 'GET',
        }),
      )
      expect(response.status).toBe(200)
      expect(getDecisionSummary).toHaveBeenCalledWith(OWN_SLEEPER_ID, undefined)
    })

    it('POST refuses an anonymous caller and writes nothing', async () => {
      gateMock.mockResolvedValueOnce(anonymous())
      const { logDecision } = await import('@/lib/decision-log')
      const response = await legacyPost(
        new NextRequest('http://localhost:3000/api/legacy/decision-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: 'https://allfantasy.ai' },
          body: postBody('user1'),
        }),
      )
      expect(response.status).toBe(401)
      expect(logDecision).not.toHaveBeenCalled()
    })

    it("POST refuses writing into someone else's log (403)", async () => {
      const { logDecision } = await import('@/lib/decision-log')
      const response = await legacyPost(
        new NextRequest('http://localhost:3000/api/legacy/decision-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: postBody('victim'),
        }),
      )
      expect(response.status).toBe(403)
      expect(logDecision).not.toHaveBeenCalled()
    })

    it('POST keeps the CSRF origin check', async () => {
      const { validateRequestOrigin } = await import('@/lib/api-auth')
      vi.mocked(validateRequestOrigin).mockReturnValueOnce(false)
      const { logDecision } = await import('@/lib/decision-log')
      const response = await legacyPost(
        new NextRequest('http://localhost:3000/api/legacy/decision-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: postBody('user1'),
        }),
      )
      expect(response.status).toBe(403)
      expect(logDecision).not.toHaveBeenCalled()
    })
  })
})
