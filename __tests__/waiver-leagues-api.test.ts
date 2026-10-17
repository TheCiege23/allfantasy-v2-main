import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as legacyGet } from '@/server/api-route-modules/legacy/waiver/leagues/route'

/*
 * ⚠ THE ROUTE GAINED AN IDENTITY GATE AND THIS FILE DID NOT FOLLOW (fc00bff3a4, 2026-10-06).
 * `?sleeper_username=<anyone>` used to return that person's whole league list; the route now
 * resolves the caller through requireLegacySleeperIdentity and only cross-checks the parameter.
 * Unmocked, the gate reached next-auth's getServerSession outside a request and every test here
 * failed with "`headers` was called outside a request scope" — red on main for five days.
 *
 * Mocked at the BOUNDARY (the session, the linked-account row, the guest cookie), not the gate
 * itself, so the gate's own rules — 401 signed out, 403 for someone else's username, lookup by
 * the server-resolved name — are what these tests exercise.
 */
const identity = vi.hoisted(() => ({ signedIn: true, linked: 'testuser' as string | null }))

vi.mock('@/lib/auth-guard', () => ({
  requireAuth: vi.fn(async () =>
    identity.signedIn
      ? { ok: true, userId: 'app-user-1', session: { user: { id: 'app-user-1' } } }
      : { ok: false, response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }) },
  ),
}))

vi.mock('@/lib/guest-mode/guestSessionToken', () => ({
  GUEST_SESSION_COOKIE_NAME: 'af_guest',
  verifyGuestSessionToken: vi.fn(async () => null),
}))

// Mock dependencies
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: {
      findUnique: vi.fn(async () => ({
        legacyUser: identity.linked ? { sleeperUsername: identity.linked } : null,
      })),
    },
    legacyUser: {
      findUnique: vi.fn(async (query) => {
        if (query.where.sleeperUsername === 'testuser') {
          return {
            id: 'user-1',
            sleeperUsername: 'testuser',
            sleeperUserId: 'sleeper-123',
            displayName: 'Test User',
            leagues: [
              {
                id: 'league-1',
                sleeperLeagueId: 'league-456',
                name: 'Main League',
                season: 2026,
                sport: 'nfl',
                scoringType: 'PPR',
                teamCount: 12,
                leagueType: 'dynasty',
                isSF: true,
                isTEP: false,
              },
              {
                id: 'league-2',
                sleeperLeagueId: 'league-789',
                name: 'Redraft',
                season: 2025,
                sport: 'nfl',
                scoringType: 'HALF_PPR',
                teamCount: 10,
                leagueType: 'redraft',
                isSF: false,
                isTEP: true,
              },
            ],
          }
        }
        return null
      }),
    },
  },
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: vi.fn((config) => {
    return (handler) => handler
  }),
}))

describe('waiver/leagues API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    identity.signedIn = true
    identity.linked = 'testuser'
  })

  describe('GET /api/legacy/waiver/leagues', () => {
    it('retrieves user leagues (happy path)', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')

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
      expect(data.leagues).toBeDefined()
      expect(Array.isArray(data.leagues)).toBe(true)
      expect(data.count).toBe(2)
      expect(data.count).toBe(data.leagues.length)
    })

    it('includes correct league metadata', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')

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
      const league = data.leagues[0]
      expect(league.league_id).toBe('league-456')
      expect(league.name).toBe('Main League')
      expect(league.season).toBe(2026)
      expect(league.sport).toBe('nfl')
      expect(league.scoring).toBe('PPR')
      expect(league.team_count).toBe(12)
      expect(league.league_type).toBe('dynasty')
      expect(league.is_sf).toBe(true)
      expect(league.is_tep).toBe(false)
    })

    it('filters leagues by season (>= 2024)', async () => {
      // Arrange - test data has leagues from 2025 and 2026
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert - all returned leagues should have season >= 2024
      for (const league of data.leagues) {
        expect(league.season).toBeGreaterThanOrEqual(2024)
      }
    })

    it('orders leagues by season descending', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert - leagues should be ordered newest to oldest
      const seasons = data.leagues.map((l: any) => l.season)
      for (let i = 0; i < seasons.length - 1; i++) {
        expect(seasons[i]).toBeGreaterThanOrEqual(seasons[i + 1])
      }
    })

    it('returns 404 when user not found', async () => {
      // Arrange - the signed-in account is linked to a Sleeper user we hold no row for
      identity.linked = 'nonexistentuser'
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'nonexistentuser')

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
      expect(response.status).toBe(404)
      expect(data.error).toContain('User not found')
    })

    it("without sleeper_username, serves the signed-in account's own linked leagues", async () => {
      // The parameter is only a cross-check now; identity comes from the session.
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      const response = await legacyGet(new NextRequest(url, { method: 'GET' }))
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.count).toBe(2)
    })

    it("🛑 someone else's sleeper_username is refused, not served (the leak the gate closed)", async () => {
      const { prisma } = await import('@/lib/prisma')
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'someoneelse')
      const response = await legacyGet(new NextRequest(url, { method: 'GET' }))
      const data = await response.json()

      expect(response.status).toBe(403)
      expect(data.code).toBe('SLEEPER_USERNAME_MISMATCH')
      expect(prisma.legacyUser.findUnique).not.toHaveBeenCalled()
    })

    it('signed out with no guest import: 401, and no lookup', async () => {
      identity.signedIn = false
      const { prisma } = await import('@/lib/prisma')
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')
      const response = await legacyGet(new NextRequest(url, { method: 'GET' }))

      expect(response.status).toBe(401)
      expect(prisma.legacyUser.findUnique).not.toHaveBeenCalled()
    })

    it('normalizes username to lowercase', async () => {
      // Arrange - use uppercase username
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'TESTUSER')

      const request = new NextRequest(url, {
        method: 'GET',
        headers: {
          'X-API-Key': 'test-key',
        },
      })

      // Act
      const response = await legacyGet(request)
      const data = await response.json()

      // Assert - should find user with lowercase conversion
      expect(response.status).toBe(200)
      expect(data.ok).toBe(true)
      expect(data.leagues).toBeDefined()
    })

    it('handles empty league list gracefully', async () => {
      // Arrange - mock user with no leagues
      identity.linked = 'newuser'
      const { prisma } = await import('@/lib/prisma')
      vi.mocked(prisma.legacyUser.findUnique).mockResolvedValueOnce({
        id: 'user-2',
        sleeperUsername: 'newuser',
        sleeperUserId: 'sleeper-999',
        displayName: 'New User',
        leagues: [],
      } as any)

      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'newuser')

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
      expect(data.leagues).toEqual([])
      expect(data.count).toBe(0)
    })
  })

  describe('Response format validation', () => {
    it('response includes required fields', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')

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
      expect(data).toHaveProperty('ok')
      expect(data).toHaveProperty('leagues')
      expect(data).toHaveProperty('count')
    })

    it('league object includes all required fields', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')

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
      const league = data.leagues[0]
      expect(league).toHaveProperty('league_id')
      expect(league).toHaveProperty('name')
      expect(league).toHaveProperty('season')
      expect(league).toHaveProperty('sport')
      expect(league).toHaveProperty('scoring')
      expect(league).toHaveProperty('team_count')
      expect(league).toHaveProperty('league_type')
      expect(league).toHaveProperty('is_sf')
      expect(league).toHaveProperty('is_tep')
    })

    it('league sport defaults to nfl when missing', async () => {
      // Arrange
      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')

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
      for (const league of data.leagues) {
        expect(['nfl', 'nba']).toContain(league.sport)
      }
    })
  })

  describe('Telemetry and error handling', () => {
    it('handles database errors gracefully', async () => {
      // Arrange - mock database error
      const { prisma } = await import('@/lib/prisma')
      vi.mocked(prisma.legacyUser.findUnique).mockRejectedValueOnce(new Error('Database connection failed'))

      const url = new URL('http://localhost:3000/api/legacy/waiver/leagues')
      url.searchParams.set('sleeper_username', 'testuser')

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
      expect(response.status).toBe(500)
      expect(data.error).toBeDefined()
    })
  })
})
