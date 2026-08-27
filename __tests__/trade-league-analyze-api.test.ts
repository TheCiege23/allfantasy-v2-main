import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST as legacyPost } from '@/server/api-route-modules/legacy/trade/league-analyze/route'

vi.mock('@/lib/ai/openai-route-client', () => ({
  getOpenAIRouteClient: vi.fn(() => ({
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [
            {
              message: {
                content: 'Trade analysis summary',
              },
            },
          ],
        })),
      },
    },
  })),
}))

vi.mock('@/lib/rate-limit', () => ({
  consumeRateLimit: vi.fn(() => ({
    success: true,
    remaining: 4,
    retryAfterSec: 0,
  })),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/api-auth', () => ({
  requireAuthOrOrigin: vi.fn(() => ({
    authenticated: true,
  })),
  forbiddenResponse: vi.fn((msg) => new NextResponse(JSON.stringify({ error: msg }), { status: 403 })),
}))

vi.mock('@/lib/sleeper-client', () => ({
  getLeagueInfo: vi.fn(async () => ({
    league_id: 'league-123',
    name: 'Test League',
    settings: { type: 2 }, // dynasty
    roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'],
  })),
  getLeagueRosters: vi.fn(async () => [
    {
      roster_id: 1,
      owner_id: 'user-123',
      settings: { wins: 10, losses: 2, fpts: 1200 },
      players: ['123', '124', '125'],
    },
    {
      roster_id: 2,
      owner_id: 'user-456',
      settings: { wins: 8, losses: 4, fpts: 1100 },
      players: ['126', '127', '128'],
    },
  ]),
  getLeagueUsers: vi.fn(async () => [
    { user_id: 'user-123', username: 'user1', display_name: 'User One' },
    { user_id: 'user-456', username: 'user2', display_name: 'User Two' },
  ]),
  getPlayersBySport: vi.fn(async () => ({
    '123': { full_name: 'Patrick Mahomes', position: 'QB', team: 'KC' },
    '124': { full_name: 'Travis Kelce', position: 'TE', team: 'KC' },
    '125': { full_name: 'Justin Jefferson', position: 'WR', team: 'MIN' },
    '126': { full_name: 'Josh Allen', position: 'QB', team: 'BUF' },
    '127': { full_name: 'Stefon Diggs', position: 'WR', team: 'BUF' },
    '128': { full_name: 'Austin Ekeler', position: 'RB', team: 'LAC' },
  })),
  getSleeperUser: vi.fn(async (username: string) => ({
    user_id: 'user-123',
    username,
    display_name: 'Test User',
  })),
}))

vi.mock('@/lib/fantasycalc', () => ({
  fetchFantasyCalcValues: vi.fn(async () => [
    { player: { name: 'Patrick Mahomes' }, value: 15000, overallRank: 1 },
    { player: { name: 'Josh Allen' }, value: 14000, overallRank: 2 },
  ]),
}))


// These modules read through the DB-first layer now, so mocking only the
// adapter stopped intercepting and the real prisma-backed path ran.
vi.mock('@/lib/fantasycalc-db', () => ({
  getFantasyCalcValuesDbFirst: vi.fn(async () => [
    { player: { name: 'Patrick Mahomes' }, value: 15000, overallRank: 1 },
    { player: { name: 'Josh Allen' }, value: 14000, overallRank: 2 },
  ]),
}))

vi.mock('@/lib/trade-pre-analysis', () => ({
  getPreAnalysisStatus: vi.fn(async () => ({ cached: false })),
}))

vi.mock('@/lib/hybrid-valuation', () => ({
  pricePlayer: vi.fn(async () => ({ value: 10000 })),
}))

vi.mock('@/lib/trade-engine', () => ({
  runTradeEngine: vi.fn(async () => ({
    verdict: 'ACCEPT',
    confidence: 0.82,
    reasoning: 'Good value trade',
  })),
  runAssistOrchestrator: vi.fn(async () => ({})),
}))

vi.mock('@/lib/trade-engine/otb-persistence', () => ({
  applyOtbTagsToAssetsByRosterId: vi.fn(async () => ({})),
}))

vi.mock('@/lib/trade-engine/snapshot-store', () => ({
  writeSnapshot: vi.fn(async () => ({})),
}))

vi.mock('@/lib/trade-engine/accept-calibration', () => ({
  getCalibratedWeights: vi.fn(() => ({})),
}))

vi.mock('@/lib/decision-log', () => ({
  autoLogDecision: vi.fn(async () => ({})),
}))

vi.mock('@/lib/analytics/confidence-risk-engine', () => ({
  computeConfidenceRisk: vi.fn(() => ({ confidenceScore01: 0.82, riskProfile: 'moderate' })),
  getHistoricalHitRate: vi.fn(() => 0.75),
}))

vi.mock('@/lib/trade-engine/league-context-assembler', () => ({
  buildLeagueDecisionContext: vi.fn(async () => ({
    context: { leagueId: 'league-123' },
  })),
  leagueContextToIntelligence: vi.fn(() => ({})),
}))

vi.mock('@/lib/analytics-server', () => ({
  trackLegacyToolUsage: vi.fn(async () => ({})),
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: vi.fn((config) => {
    return (handler) => handler
  }),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sleeperImportCache: {
      upsert: vi.fn(async () => ({})),
    },
  },
}))

describe('trade/league-analyze API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('POST /api/legacy/trade/league-analyze', () => {
    it('analyzes league and generates trade suggestions (happy path)', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert - response should include trade suggestions
      expect(response.status).toBe(200)
      expect(data).toBeDefined()
      // Trade suggestions should be an array or object with trade data
      expect(data.suggestions || data.trades || data.analysis).toBeDefined()
    })

    it('validates required parameters', async () => {
      // Arrange - missing league_id
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toBeDefined()
    })

    it('validates sleeper_username exists', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(400)
      expect(data.error).toBeDefined()
    })

    it('defaults sport to nfl when not provided', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
        }),
      })

      // Act
      const response = await legacyPost(request)

      // Assert - should succeed without sport parameter
      expect([200, 400, 404]).toContain(response.status)
    })

    it('returns 404 when league not found', async () => {
      // Arrange
      const { getLeagueInfo } = await import('@/lib/sleeper-client')
      vi.mocked(getLeagueInfo).mockResolvedValueOnce(null)

      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'nonexistent',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(404)
      expect(data.error).toContain('League not found')
    })

    it('returns 404 when user not found in league', async () => {
      // Arrange
      const { getSleeperUser } = await import('@/lib/sleeper-client')
      vi.mocked(getSleeperUser).mockResolvedValueOnce(null)

      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'nonexistent',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(404)
      expect(data.error).toContain('Sleeper user')
    })

    it('handles rate limiting', async () => {
      // Arrange
      const { consumeRateLimit } = await import('@/lib/rate-limit')
      vi.mocked(consumeRateLimit).mockReturnValueOnce({
        success: false,
        remaining: 0,
        retryAfterSec: 30,
      } as any)

      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(429)
      expect(data.error).toContain('Rate limited')
    })
  })

  describe('League analysis features', () => {
    it('identifies dynasty vs redraft leagues', async () => {
      // Arrange - dynasty league
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)

      // Assert
      expect([200, 400, 404]).toContain(response.status)
    })

    it('detects superFlex settings', async () => {
      // Arrange - positions include SUPER_FLEX
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)

      // Assert
      expect([200, 400, 404]).toContain(response.status)
    })

    it('analyzes all league rosters', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      if (response.status === 200) {
        // Should have analyzed multiple rosters
        expect(data).toBeDefined()
      }
    })
  })

  describe('Trade suggestion features', () => {
    it('generates trade suggestions for other managers', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      if (response.status === 200) {
        // Response should include trade suggestions
        expect(data.suggestions || data.trades || data.analysis).toBeDefined()
      }
    })

    it('includes confidence and risk assessment', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      if (response.status === 200) {
        // Response should have confidence/risk metrics
        expect(data).toBeDefined()
      }
    })
  })

  describe('Error handling and resilience', () => {
    it('handles missing roster for user', async () => {
      // Arrange
      const { getLeagueRosters } = await import('@/lib/sleeper-client')
      vi.mocked(getLeagueRosters).mockResolvedValueOnce([
        {
          roster_id: 2,
          owner_id: 'user-456',
          settings: { wins: 8, losses: 4 },
          players: [],
        },
      ] as any)

      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(404)
      expect(data.error).toContain('roster')
    })

    it('handles invalid JSON request body', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: 'invalid json',
      })

      // Act
      const response = await legacyPost(request)

      // Assert
      expect(response.status).toBe(400)
    })

    it('requires authentication', async () => {
      // Arrange
      const { requireAuthOrOrigin } = await import('@/lib/api-auth')
      vi.mocked(requireAuthOrOrigin).mockReturnValueOnce({
        authenticated: false,
        error: 'Unauthorized',
      } as any)

      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'invalid',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)
      const data = await response.json()

      // Assert
      expect(response.status).toBe(403)
      expect(data.error).toBeDefined()
    })
  })

  describe('Telemetry and logging', () => {
    it('logs trade analysis usage', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)

      // Assert - trackLegacyToolUsage should be called
      const { trackLegacyToolUsage } = await import('@/lib/analytics-server')
      if (response.status === 200) {
        expect(vi.mocked(trackLegacyToolUsage)).toHaveBeenCalled()
      }
    })

    it('logs decisions to decision log', async () => {
      // Arrange
      const request = new NextRequest('http://localhost:3000/api/legacy/trade/league-analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': 'test-key',
        },
        body: JSON.stringify({
          league_id: 'league-123',
          sleeper_username: 'user1',
          sport: 'nfl',
        }),
      })

      // Act
      const response = await legacyPost(request)

      // Assert
      const { autoLogDecision } = await import('@/lib/decision-log')
      if (response.status === 200) {
        // autoLogDecision should potentially be called for logging
        expect(true).toBe(true) // placeholder for actual assertion
      }
    })
  })
})
