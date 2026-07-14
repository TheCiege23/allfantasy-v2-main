import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from "@/__tests__/helpers/createMockNextRequest"
const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const runWaiverAIServiceMock = vi.fn()
const requireFeatureEntitlementMock = vi.fn()
const shouldRunSharedWaiverShadowCompareMock = vi.fn()
const runSharedWaiverShadowCompareMock = vi.fn()

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

vi.mock('@/lib/decision-os/waiver/sharedServiceShadowCompare', () => ({
  shouldRunSharedWaiverShadowCompare: shouldRunSharedWaiverShadowCompareMock,
  runSharedWaiverShadowCompare: runSharedWaiverShadowCompareMock,
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
    // Phase 12 default: shared-service shadow-compare disabled, matching the flag's real
    // safe-off-by-default behavior (SHARED_SERVICES_WAIVER_SHADOW_COMPARE unset in test env).
    shouldRunSharedWaiverShadowCompareMock.mockReturnValue(false)
    runSharedWaiverShadowCompareMock.mockResolvedValue({ ran: false, status: 'insufficient_context' })
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
  })

  describe('Phase 12 — shared Waiver Service shadow-compare', () => {
    function baseSuccessSetup() {
      getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
      runWaiverAIServiceMock.mockResolvedValueOnce({
        sport: 'NFL',
        deterministic: { basedOn: ['available_players'], suggestions: [] },
        explanation: { source: 'deterministic', text: 'x' },
      })
    }

    function makeRequest() {
      return createMockNextRequest('http://localhost/api/waiver-ai/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId: 'league-1',
          leagueSettings: {},
          availablePlayers: [{ playerId: 'p-1', playerName: 'Any', position: 'RB', value: 1200 }],
        }),
      })
    }

    it('does not call the shared service when the flag is disabled', async () => {
      baseSuccessSetup()
      shouldRunSharedWaiverShadowCompareMock.mockReturnValue(false)
      const { POST } = await import('@/app/api/waiver-ai/engine/route')

      const res = await POST(makeRequest() as any)
      expect(res.status).toBe(200)
      expect(runSharedWaiverShadowCompareMock).not.toHaveBeenCalled()
    })

    it('does not call the shared service when no leagueId is present, even if the flag is enabled', async () => {
      getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
      runWaiverAIServiceMock.mockResolvedValueOnce({ sport: 'NFL', deterministic: { basedOn: [], suggestions: [] }, explanation: { source: 'deterministic', text: 'x' } })
      shouldRunSharedWaiverShadowCompareMock.mockReturnValue(true)
      const { POST } = await import('@/app/api/waiver-ai/engine/route')

      const req = createMockNextRequest('http://localhost/api/waiver-ai/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueSettings: {}, availablePlayers: [{ playerId: 'p-1', playerName: 'Any', position: 'RB', value: 1200 }] }),
      })
      await POST(req as any)
      expect(runSharedWaiverShadowCompareMock).not.toHaveBeenCalled()
    })

    it('calls the shared service exactly once when the flag is enabled and a leagueId is present', async () => {
      baseSuccessSetup()
      shouldRunSharedWaiverShadowCompareMock.mockReturnValue(true)
      runSharedWaiverShadowCompareMock.mockResolvedValue({ ran: true, status: 'equivalent' })
      const { POST } = await import('@/app/api/waiver-ai/engine/route')

      await POST(makeRequest() as any)
      expect(runSharedWaiverShadowCompareMock).toHaveBeenCalledTimes(1)
      expect(runSharedWaiverShadowCompareMock).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', leagueId: 'league-1' })
      )
    })

    it('returns the exact same response body whether the shadow compare is enabled or disabled', async () => {
      const runOnce = async (flagEnabled: boolean) => {
        getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
        runWaiverAIServiceMock.mockResolvedValueOnce({
          sport: 'NFL',
          deterministic: { basedOn: ['available_players'], suggestions: [{ playerId: 'p-1', playerName: 'Waiver RB', position: 'RB', team: 'DET', age: 24, value: 3300, compositeScore: 78, dimensions: {}, drivers: [], topDrivers: [], recommendation: 'Must Add', faabBid: 22, priorityRank: 1, dropCandidate: null }] },
          explanation: { source: 'deterministic', text: 'x' },
        })
        shouldRunSharedWaiverShadowCompareMock.mockReturnValue(flagEnabled)
        runSharedWaiverShadowCompareMock.mockResolvedValue({ ran: flagEnabled, status: 'equivalent' })
        const { POST } = await import('@/app/api/waiver-ai/engine/route')
        const res = await POST(makeRequest() as any)
        return { status: res.status, body: await res.json() }
      }

      const disabled = await runOnce(false)
      vi.resetModules()
      const enabled = await runOnce(true)

      expect(disabled.status).toBe(enabled.status)
      expect(disabled.body).toEqual(enabled.body)
    })

    it('does not alter the response or status when the shared service throws', async () => {
      baseSuccessSetup()
      shouldRunSharedWaiverShadowCompareMock.mockReturnValue(true)
      runSharedWaiverShadowCompareMock.mockRejectedValue(new Error('shared service exploded'))
      const { POST } = await import('@/app/api/waiver-ai/engine/route')

      const res = await POST(makeRequest() as any)
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      // No internal shadow error is ever exposed to the caller.
      expect(JSON.stringify(body)).not.toContain('shared service exploded')
    })

    it('preserves the existing 401/403 authorization checks regardless of the shadow-compare flag', async () => {
      getServerSessionMock.mockResolvedValueOnce(null)
      shouldRunSharedWaiverShadowCompareMock.mockReturnValue(true)
      const { POST } = await import('@/app/api/waiver-ai/engine/route')

      const res = await POST(makeRequest() as any)
      expect(res.status).toBe(401)
      expect(runSharedWaiverShadowCompareMock).not.toHaveBeenCalled()
    })

    it('never runs shadow compare for a request rejected by league membership', async () => {
      getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
      assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))
      shouldRunSharedWaiverShadowCompareMock.mockReturnValue(true)
      const { POST } = await import('@/app/api/waiver-ai/engine/route')

      const res = await POST(makeRequest() as any)
      expect(res.status).toBe(403)
      expect(runSharedWaiverShadowCompareMock).not.toHaveBeenCalled()
    })

    it('never runs shadow compare when the entitlement gate rejects the request', async () => {
      getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
      requireFeatureEntitlementMock.mockResolvedValueOnce({ ok: false, response: new Response(JSON.stringify({ error: 'entitlement_required' }), { status: 402 }) })
      shouldRunSharedWaiverShadowCompareMock.mockReturnValue(true)
      const { POST } = await import('@/app/api/waiver-ai/engine/route')

      const res = await POST(makeRequest() as any)
      expect(res.status).toBe(402)
      expect(runSharedWaiverShadowCompareMock).not.toHaveBeenCalled()
      expect(runWaiverAIServiceMock).not.toHaveBeenCalled()
    })
  })
})
