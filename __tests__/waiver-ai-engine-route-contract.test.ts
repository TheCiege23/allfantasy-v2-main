import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const runWaiverAIServiceMock = vi.fn()
const requireFeatureEntitlementMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/lib/waiver-ai-engine', () => ({
  runWaiverAIService: runWaiverAIServiceMock,
}))

vi.mock('@/lib/telemetry/usage', () => ({
  withApiUsage: () => (handler: any) => handler,
}))

vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: requireFeatureEntitlementMock,
}))

describe('POST /api/waiver-ai/engine contract', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireFeatureEntitlementMock.mockResolvedValue({
      ok: true,
      decision: {},
      tokenSpend: null,
      tokenPreview: null,
    })
  })

  it('returns 401 when unauthenticated', async () => {
    getServerSessionMock.mockResolvedValueOnce(null)
    const { POST } = await import('@/app/api/waiver-ai/engine/route')

    const req = createMockNextRequest('http://localhost/api/waiver-ai/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueSettings: {},
        availablePlayers: [{ playerName: 'Any', position: 'RB', value: 1200 }],
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 403 when user is not a member of provided league', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))
    const { POST } = await import('@/app/api/waiver-ai/engine/route')

    const req = createMockNextRequest('http://localhost/api/waiver-ai/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leagueId: 'league-1',
        leagueSettings: {},
        availablePlayers: [{ playerName: 'Any', position: 'RB', value: 1200 }],
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns waiver analysis payload on success', async () => {
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    runWaiverAIServiceMock.mockResolvedValueOnce({
      sport: 'NFL',
      deterministic: {
        basedOn: ['available_players', 'team_needs'],
        suggestions: [
          {
            playerId: 'p-1',
            playerName: 'Waiver RB',
            position: 'RB',
            team: 'DET',
            age: 24,
            value: 3300,
            compositeScore: 78,
            dimensions: { startNow: 80, stash: 60, needFit: 85, leagueDemand: 72 },
            drivers: [],
            topDrivers: [],
            recommendation: 'Must Add',
            faabBid: 22,
            priorityRank: 1,
            dropCandidate: null,
          },
        ],
      },
      explanation: {
        source: 'deterministic',
        text: 'Top deterministic add is Waiver RB.',
      },
    })

    const { POST } = await import('@/app/api/waiver-ai/engine/route')
    const req = createMockNextRequest('http://localhost/api/waiver-ai/engine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        includeAIExplanation: false,
        leagueSettings: { numTeams: 12 },
        availablePlayers: [{ playerId: 'p-1', playerName: 'Waiver RB', position: 'RB', value: 3300 }],
      }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.analysis?.sport).toBe('NFL')
    expect(body.analysis?.deterministic?.suggestions?.[0]?.playerName).toBe('Waiver RB')
    expect(runWaiverAIServiceMock).toHaveBeenCalledTimes(1)
    expect(requireFeatureEntitlementMock).not.toHaveBeenCalled()
    expect(body.tokenSpend).toBeNull()
  })
})
