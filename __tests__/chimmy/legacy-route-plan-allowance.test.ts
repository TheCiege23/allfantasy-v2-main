import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

/**
 * `/api/chimmy` (dashboard chat panel, /legacy, /chimmy/chat) gated AF Pro free and then hard-stopped
 * it at 30 answers a day with a 429 telling a subscriber to "upgrade". It now uses the same allowance
 * as /api/chat/chimmy: 100 included, then tokens.
 */

const h = vi.hoisted(() => ({
  runAgentPipeline: vi.fn(),
  requireFeatureEntitlement: vi.fn(),
  refundSpendByLedger: vi.fn(),
  readPlan: vi.fn(),
  takePlan: vi.fn(),
  releasePlan: vi.fn(),
  checkDailyCap: vi.fn(),
  incrementDailyCap: vi.fn(),
  deterministic: vi.fn(),
}))

vi.mock('@/app/api/chat/chimmy/route', () => ({ POST: vi.fn() }))
vi.mock('@/lib/agents/anthropic-pipeline', () => ({
  runAgentPipeline: h.runAgentPipeline,
  streamAgentPipeline: vi.fn(),
  isAnthropicPipelineAvailable: () => true,
}))
vi.mock('@/lib/feature-toggle', () => ({ isAnthropicChimmyEnabled: async () => true }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'session-user', email: 'pro@example.com' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection', () => ({ runAiProtection: async () => null }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: h.requireFeatureEntitlement }))
vi.mock('@/lib/tokens/TokenSpendService', () => ({
  TokenSpendService: vi.fn().mockImplementation(() => ({ refundSpendByLedger: h.refundSpendByLedger })),
}))
vi.mock('@/lib/chimmy/planAllowance', () => ({
  readChimmyPlanAllowance: h.readPlan,
  takeChimmyPlanAllowance: h.takePlan,
  releaseChimmyPlanAllowance: h.releasePlan,
}))
vi.mock('@/lib/ai/dailyCaps', () => ({ checkDailyCap: h.checkDailyCap, incrementDailyCap: h.incrementDailyCap }))
vi.mock('@/lib/ai/deterministic', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/deterministic')>('@/lib/ai/deterministic')
  return { ...actual, tryDeterministicAnswer: h.deterministic }
})
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({ resolveChimmyCommissionerGrounding: async () => null }))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({ resolveLeagueIntelligenceGrounding: async () => null }))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({ resolvePortfolioGrounding: async () => ({ status: 'empty' }) }))

const LEFT = { planName: 'AF Pro', limit: 100, used: 37, remaining: 63, resetsAt: '2026-09-25T00:00:00.000Z' }
const NONE_LEFT = { ...LEFT, used: 100, remaining: 0 }

const ask = async () => {
  const { POST } = await import('@/app/api/chimmy/route')
  return POST(
    createMockNextRequest('http://localhost/api/chimmy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'next-auth.session-token=test' },
      body: JSON.stringify({
        message: 'Who should I start at flex this week?',
        userContext: { sport: 'NFL', leagueId: 'league-1', source: 'chimmy_chat' },
      }),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.deterministic.mockResolvedValue(null)
  h.runAgentPipeline.mockResolvedValue({ result: 'Start Reed.', intent: 'lineup', model: 'claude', tokensUsed: 10 })
  h.checkDailyCap.mockResolvedValue({ allowed: true, used: 0, limit: 3, resetsAt: new Date(), message: '', upgradePath: '/pricing' })
  h.incrementDailyCap.mockResolvedValue(undefined)
  h.takePlan.mockResolvedValue({ ...LEFT, used: 38, remaining: 62 })
  h.releasePlan.mockResolvedValue(undefined)
  h.refundSpendByLedger.mockResolvedValue(null)
  h.requireFeatureEntitlement.mockResolvedValue({
    ok: true,
    decision: { entitlement: { plans: ['pro'] } },
    tokenSpend: null,
    tokenPreview: null,
  })
})

describe('/api/chimmy and the AF Pro allowance', () => {
  it('includes the answer for a plan holder with answers left — no hard cap, no tokens', async () => {
    h.readPlan.mockResolvedValue(LEFT)
    const res = await ask()
    expect(res.status).toBe(200)
    expect(h.requireFeatureEntitlement).toHaveBeenCalledWith(expect.objectContaining({ forceTokenFallback: false }))
    expect(h.takePlan).toHaveBeenCalledWith({ userId: 'session-user', state: LEFT })
    expect(h.checkDailyCap).not.toHaveBeenCalled()
  })

  /* The 101st answer is not a 429 telling a subscriber to upgrade — it is the token path. */
  it('sends a plan holder with none left down the token path', async () => {
    h.readPlan.mockResolvedValue(NONE_LEFT)
    h.requireFeatureEntitlement.mockResolvedValue({
      ok: true,
      decision: { entitlement: { plans: ['pro'] } },
      tokenSpend: { id: 'ledger-1' },
      tokenPreview: null,
    })
    const res = await ask()
    expect(res.status).toBe(200)
    expect(h.requireFeatureEntitlement).toHaveBeenCalledWith(expect.objectContaining({ forceTokenFallback: true, allowTokenFallback: true }))
    expect(h.takePlan).not.toHaveBeenCalled()
    expect(h.checkDailyCap).not.toHaveBeenCalled()
  })

  it('keeps the hard cap for accounts without the plan', async () => {
    h.readPlan.mockResolvedValue(null)
    await ask()
    expect(h.checkDailyCap).toHaveBeenCalledWith('chimmy', 'session-user', 'pro')
    expect(h.takePlan).not.toHaveBeenCalled()
  })

  it('gives the included answer back when the pipeline fails', async () => {
    h.readPlan.mockResolvedValue(LEFT)
    h.runAgentPipeline.mockRejectedValue(new Error('provider down'))
    await ask()
    expect(h.releasePlan).toHaveBeenCalledWith({ userId: 'session-user' })
  })

  it('gives the included answer back when a stored-data answer makes the model call unnecessary', async () => {
    h.readPlan.mockResolvedValue(LEFT)
    h.deterministic.mockResolvedValueOnce(null).mockResolvedValueOnce('Reed is questionable.')
    const res = await ask()
    expect(res.status).toBe(200)
    expect(h.releasePlan).toHaveBeenCalledTimes(1)
    expect(h.runAgentPipeline).not.toHaveBeenCalled()
  })

  it('says so, and runs nothing, when another request took the last included answer', async () => {
    h.readPlan.mockResolvedValue({ ...LEFT, used: 99, remaining: 1 })
    h.takePlan.mockResolvedValue(null)
    const res = await ask()
    expect(res.status).toBe(429)
    expect(h.runAgentPipeline).not.toHaveBeenCalled()
  })
})
