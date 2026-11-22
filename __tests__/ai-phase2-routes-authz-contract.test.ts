import { beforeEach, describe, expect, it, vi } from 'vitest'

// A plan holder: these tests are about what the paid route does once the plan gate lets the caller in.
vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: async () => ({ ok: true, decision: {}, tokenSpend: null, tokenPreview: null }),
}))

const getServerSessionMock = vi.fn()
const assertLeagueMemberMock = vi.fn()
const runDraftAIAssistMock = vi.fn()
const getCoachAdviceMock = vi.fn()
const logAiOutputMock = vi.fn()

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/league-access', () => ({
  assertLeagueMember: assertLeagueMemberMock,
}))

vi.mock('@/lib/draft-ai-engine', () => ({
  runDraftAIAssist: runDraftAIAssistMock,
}))

vi.mock('@/lib/ai/SportAwareRecommendationService', () => ({
  buildDraftRecommendationContext: vi.fn(() => 'ctx'),
}))

vi.mock('@/lib/ai/AISportContextResolver', () => ({
  resolveSportForAI: vi.fn(() => 'NFL'),
}))

vi.mock('@/lib/league-defaults-orchestrator/SportVariantContextResolver', () => ({
  resolveSportVariantContext: vi.fn(() => ({ sport: 'NFL', isFootballIdp: false, isNflIdp: false, formatType: 'redraft' })),
}))

vi.mock('@/lib/fantasy-coach', () => ({
  getCoachAdvice: getCoachAdviceMock,
}))

vi.mock('@/lib/ai/output-logger', () => ({
  logAiOutput: logAiOutputMock,
}))

describe('AI phase-2 route authz contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 for draft helper when unauthenticated', async () => {
    const { POST } = await import('@/app/api/draft-ai/route')
    getServerSessionMock.mockResolvedValueOnce(null)

    const req = new Request('http://localhost/api/draft-ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ available: [] }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(401)
  })

  it('returns 403 for draft helper when league access is denied', async () => {
    const { POST } = await import('@/app/api/draft-ai/route')
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))

    const req = new Request('http://localhost/api/draft-ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ available: [], leagueId: 'league-1' }),
    })

    const res = await POST(req as any)
    expect(res.status).toBe(403)
    expect(runDraftAIAssistMock).not.toHaveBeenCalled()
  })

  it('returns 401 for coach advice when unauthenticated', async () => {
    const { POST } = await import('@/app/api/coach/advice/route')
    getServerSessionMock.mockResolvedValueOnce(null)

    const req = new Request('http://localhost/api/coach/advice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'lineup' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 for coach advice when league access is denied', async () => {
    const { POST } = await import('@/app/api/coach/advice/route')
    getServerSessionMock.mockResolvedValueOnce({ user: { id: 'user-1' } })
    assertLeagueMemberMock.mockRejectedValueOnce(new Error('Forbidden'))

    const req = new Request('http://localhost/api/coach/advice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'lineup', leagueId: 'league-1' }),
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
    expect(getCoachAdviceMock).not.toHaveBeenCalled()
  })
})
