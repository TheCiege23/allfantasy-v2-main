import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))
// These tests exercise the route for a user who HAS the plan; the gate itself is covered in
// __tests__/monetization/gate-free-paid-features.test.ts.
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: vi.fn(async () => ({ ok: true, decision: {}, tokenSpend: null, tokenPreview: null })),
}))

vi.mock('@/lib/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

describe('POST /api/lineup/optimize contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/lineup/optimize/route')

    const req = createMockNextRequest('http://localhost/api/lineup/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players: [{ name: 'QB One', position: 'QB', projectedPoints: 20 }],
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when user is not a league member', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))
    const { POST } = await import('@/app/api/lineup/optimize/route')

    const req = createMockNextRequest('http://localhost/api/lineup/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueId: 'league-denied',
        players: [{ name: 'QB One', position: 'QB', projectedPoints: 20 }],
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('optimizes lineup deterministically and returns explanation', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockResolvedValueOnce(undefined)
    const { POST } = await import('@/app/api/lineup/optimize/route')

    const req = createMockNextRequest('http://localhost/api/lineup/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueId: 'league-1',
        sport: 'NFL',
        useAIExplanation: false,
        premiumDecisionEngine: false,
        rosterSlots: ['QB', 'RB', 'WR', 'FLEX'],
        players: [
          { name: 'QB Elite', position: 'QB', projectedPoints: 24.2 },
          { name: 'RB One', position: 'RB', projectedPoints: 17.4 },
          { name: 'WR One', position: 'WR', projectedPoints: 16.6 },
          { name: 'TE One', position: 'TE', projectedPoints: 12.1 },
          { name: 'RB Bench', position: 'RB', projectedPoints: 10.5 },
        ],
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.ok).toBe(true)
    expect(body.deterministic).toBe(true)
    expect(body.result?.sport).toBe('NFL')
    expect(body.result?.starters?.length).toBe(4)
    expect(body.result?.totalProjectedPoints).toBeCloseTo(70.3, 1)
    expect(body.result?.starters?.map((starter: { playerName: string }) => starter.playerName)).toEqual(
      expect.arrayContaining(['QB Elite', 'RB One', 'WR One', 'TE One'])
    )
    expect(body.explanation?.source).toBe('deterministic')
    expect(Array.isArray(body.explanation?.bullets)).toBe(true)
  })
})
