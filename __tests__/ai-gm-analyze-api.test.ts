import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { POST as legacyPost, GET as legacyGet } from '@/server/api-route-modules/legacy/ai-gm-analyze/route'

// Mock dependencies
vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: vi.fn(() => ({
    success: true,
    remaining: 4,
    retryAfterSec: 0,
  })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

// Origin is CSRF protection only. Identity comes from the shared legacy gate; the caller here is
// signed in as the account linked to Sleeper user `user1`.
vi.mock('@/lib/api-auth', () => ({
  validateRequestOrigin: vi.fn(() => true),
  forbiddenResponse: vi.fn((msg) => new NextResponse(JSON.stringify({ error: msg }), { status: 403 })),
}))

const gateMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/legacy/requireLegacySleeperIdentity', () => ({
  requireLegacySleeperIdentity: (...args: unknown[]) => gateMock(...args),
}))
const signedInAsUser1 = () => ({
  ok: true,
  identity: { sleeperUsername: 'user1', actorId: 'appuser-1', source: 'session' },
})
const anonymous = () => ({
  ok: false,
  response: NextResponse.json({ error: 'Sign in to use this.' }, { status: 401 }),
})

vi.mock('@/lib/sleeper-client', () => ({
  getSleeperUser: vi.fn(async (username) => ({
    user_id: 'user-123',
    username,
    display_name: 'Test User',
  })),
  getLeagueInfo: vi.fn(async () => ({
    league_id: 'league-123',
    name: 'Test League',
    settings: { type: 2 }, // dynasty
    roster_positions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'],
  })),
  getLeagueRosters: vi.fn(async () => [
    {
      roster_id: 1,
      owner_id: 'user-123',
      players: ['111', '222', '333'],
    },
    {
      roster_id: 2,
      owner_id: 'user-456',
      players: ['444', '555', '666'],
    },
  ]),
  getAllPlayers: vi.fn(async () => ({
    '111': { first_name: 'Justin', last_name: 'Jefferson', position: 'WR' },
    '222': { first_name: 'Austin', last_name: 'Ekeler', position: 'RB' },
    '333': { first_name: 'Travis', last_name: 'Kelce', position: 'TE' },
    '444': { first_name: 'Derrick', last_name: 'Henry', position: 'RB' },
    '555': { first_name: 'CeeDee', last_name: 'Lamb', position: 'WR' },
    '666': { first_name: 'Joe', last_name: 'Burrow', position: 'QB' },
  })),
  getLeagueUsers: vi.fn(async () => [
    { user_id: 'user-123', username: 'user1', display_name: 'Test User' },
    { user_id: 'user-456', username: 'user2', display_name: 'Other User' },
  ]),
}))

vi.mock('@/lib/ai-gm-intelligence', () => ({
  buildComprehensiveTradeContext: vi.fn(async () => ({
    leagueName: 'Test League',
    leagueSettings: {
      isDynasty: true,
      isSuperFlex: true,
      isTeePremium: false,
      scoringType: 'PPR',
      rosterPositions: ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'],
      teamCount: 12,
    },
    marketValues: {
      playersGiven: [{ id: '111', name: 'Justin Jefferson', value: 9000 }],
      playersReceived: [{ id: '444', name: 'Derrick Henry', value: 8500 }],
    },
    userTradingProfile: {
      tradeCount: 5,
      recentTrades: 2,
      preferredAssets: ['WR', 'RB'],
    },
    playerNewsAndSentiment: [],
  })),
  generateAIGMAnalysis: vi.fn(async () => ({
    verdict: 'ACCEPT',
    confidence: 0.82,
    reasoning: 'Good value trade - acquiring elite RB',
    strengths: ['Addresses RB need', 'Fair market value'],
    concerns: ['Losing WR depth'],
  })),
  runPreAnalysisForUser: vi.fn(async () => ({
    ready: true,
    username: 'user1',
    leaguesAnalyzed: 2,
    lastAnalysisAt: new Date().toISOString(),
  })),
}))

vi.mock('@/lib/analytics-server', () => ({
  trackLegacyToolUsage: vi.fn(async () => ({})),
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: vi.fn((config) => {
    return (handler) => handler
  }),
}))

describe('ai-gm-analyze API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateMock.mockResolvedValue(signedInAsUser1())
  })

  describe('GET /api/legacy/ai-gm-analyze', () => {
    it('checks readiness for analysis (happy path)', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/ai-gm-analyze')
      url.searchParams.set('username', 'user1')
      url.searchParams.set('leagueId', 'league123')

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
      expect(data.ready).toBe(true)
      expect(data.username).toBe('user1')
      expect(data.leaguesAnalyzed).toBe(2)
      expect(data.lastAnalysisAt).toBeDefined()
    })

    it('without a username parameter, reads the readiness of the CALLER (never a default to anyone else)', async () => {
      // Arrange - missing username: identity comes from the session, not the query
      const url = new URL('http://localhost:3000/api/legacy/ai-gm-analyze')

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
      expect(data.username).toBe('user1')
      const { runPreAnalysisForUser } = await import('@/lib/ai-gm-intelligence')
      expect(runPreAnalysisForUser).toHaveBeenCalledWith('user1', '')
    })

    it('refuses an anonymous caller (Origin alone is not authentication)', async () => {
      gateMock.mockResolvedValueOnce(anonymous())
      const { runPreAnalysisForUser } = await import('@/lib/ai-gm-intelligence')
      const response = await legacyGet(
        new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze?username=user1', {
          method: 'GET',
          headers: { origin: 'https://allfantasy.ai' },
        }),
      )
      expect(response.status).toBe(401)
      expect(runPreAnalysisForUser).not.toHaveBeenCalled()
    })

    it('passes the named username to the gate to COMPARE, and stops on its refusal', async () => {
      gateMock.mockResolvedValueOnce({
        ok: false,
        response: NextResponse.json({ code: 'SLEEPER_USERNAME_MISMATCH' }, { status: 403 }),
      })
      const { runPreAnalysisForUser } = await import('@/lib/ai-gm-intelligence')
      const response = await legacyGet(
        new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze?username=victim', { method: 'GET' }),
      )
      expect(response.status).toBe(403)
      expect(gateMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ requestedUsername: 'victim' }))
      expect(runPreAnalysisForUser).not.toHaveBeenCalled()
    })
  })

  describe('POST /api/legacy/ai-gm-analyze', () => {
    it('generates AI GM analysis for trade (happy path)', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          username: 'user1',
          leagueId: 'league123',
          sport: 'nfl',
          trade: {
            playersGiving: ['111'], // Justin Jefferson
            playersReceiving: ['444'], // Derrick Henry
            picksGiving: [],
            picksReceiving: [],
            partnerRosterId: 2,
          },
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert - validate response structure
      expect(response.status).toBe(200)
      expect(data.analysis).toBeDefined()
      expect(data.analysis.verdict).toBe('ACCEPT')
      expect(data.analysis.confidence).toBe(0.82)
      expect(data.analysis.reasoning).toBeDefined()
      expect(data.analysis.strengths).toBeDefined()
      expect(Array.isArray(data.analysis.strengths)).toBe(true)
      expect(data.analysis.concerns).toBeDefined()

      // Validate context metadata
      expect(data.context).toBeDefined()
      expect(data.context.leagueName).toBe('Test League')
      expect(data.context.leagueSettings).toBeDefined()
      expect(data.context.leagueSettings.isDynasty).toBe(true)
      expect(data.context.leagueSettings.isSuperFlex).toBe(true)
      expect(data.context.marketValues).toBeDefined()
      expect(data.context.userTradingProfile).toBeDefined()
    })

    it('validates required fields in request', async () => {
      // Arrange - missing leagueId
      const request = new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          username: 'user1',
          trade: {
            playersGiving: ['111'],
            playersReceiving: ['444'],
          },
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toContain('leagueId')
    })

    it('refuses an anonymous POST before any model or provider call', async () => {
      gateMock.mockResolvedValueOnce(anonymous())
      const { generateAIGMAnalysis } = await import('@/lib/ai-gm-intelligence')
      const { getSleeperUser } = await import('@/lib/sleeper-client')
      const response = await legacyPost(
        new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', origin: 'https://allfantasy.ai' },
          body: JSON.stringify({ username: 'user1', leagueId: 'league123', trade: { playersGiving: ['111'] } }),
        }),
      )
      expect(response.status).toBe(401)
      expect(getSleeperUser).not.toHaveBeenCalled()
      expect(generateAIGMAnalysis).not.toHaveBeenCalled()
    })

    it('POST spends no model call for a guest and rate-limits per actor', async () => {
      const response = await legacyPost(
        new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'user1', leagueId: 'league123', trade: { playersGiving: ['111'] } }),
        }),
      )
      expect(response.status).toBe(200)
      const opts = gateMock.mock.calls[0]![1] as { allowGuest?: boolean; rateLimit?: unknown; requestedUsername?: string }
      expect(opts.allowGuest).toBeFalsy()
      expect(opts.rateLimit).toBeDefined()
      expect(opts.requestedUsername).toBe('user1')
    })

    it('returns 404 when user not found', async () => {
      // Mock getSleeperUser to return null
      const { getSleeperUser } = await import('@/lib/sleeper-client')
      vi.mocked(getSleeperUser).mockResolvedValueOnce(null)

      const request = new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          username: 'user1',
          leagueId: 'league123',
          trade: {
            playersGiving: ['111'],
            playersReceiving: ['444'],
          },
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(404)
      expect(data.error).toContain('Sleeper user not found')
    })

    it('includes market values in response', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          username: 'user1',
          leagueId: 'league123',
          trade: {
            playersGiving: ['111', '222'], // JJ + Ekeler
            playersReceiving: ['444'], // Henry
            picksGiving: ['1.01'],
            picksReceiving: [],
            partnerRosterId: 2,
          },
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert - validate market value data
      expect(response.status).toBe(200)
      expect(data.context.marketValues.playersGiven).toBeDefined()
      expect(Array.isArray(data.context.marketValues.playersGiven)).toBe(true)
      expect(data.context.marketValues.playersGiven.length).toBeGreaterThan(0)
      expect(data.context.marketValues.playersReceived).toBeDefined()
      expect(Array.isArray(data.context.marketValues.playersReceived)).toBe(true)
    })
  })

  describe('Telemetry and response validation', () => {
    it('analysis verdict is one of expected values', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          username: 'user1',
          leagueId: 'league123',
          trade: {
            playersGiving: ['111'],
            playersReceiving: ['444'],
            partnerRosterId: 2,
          },
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(['ACCEPT', 'REJECT', 'NEUTRAL']).toContain(data.analysis.verdict)
      expect(data.analysis.confidence).toBeGreaterThanOrEqual(0)
      expect(data.analysis.confidence).toBeLessThanOrEqual(1)
    })

    it('includes player information in trade context', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/ai-gm-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          username: 'user1',
          leagueId: 'league123',
          trade: {
            playersGiving: ['111'], // Justin Jefferson
            playersReceiving: ['444'], // Derrick Henry
            partnerRosterId: 2,
          },
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert - validate player names were formatted
      expect(response.status).toBe(200)
      expect(data.context.marketValues).toBeDefined()
      expect(data.context.marketValues.playersGiven).toBeDefined()
      const playersGiven = data.context.marketValues.playersGiven
      expect(playersGiven[0].name).toContain('Jefferson')
    })
  })
})
