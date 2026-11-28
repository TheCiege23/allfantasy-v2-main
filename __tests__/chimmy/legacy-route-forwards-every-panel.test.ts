import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

/**
 * Owner decision 2026-11-28: every Chimmy panel that POSTs `/api/chimmy` (dashboard left panel,
 * /legacy, /chimmy/chat via `ChimmyChatService`) gets the full `/api/chat/chimmy` treatment —
 * grounding packet, tool loop, `decisionAnswerCheck` — whatever `feature_chimmy_anthropic` says.
 *
 * Money: `/api/chat/chimmy` owns the allowance, the token gate and the refunds. This route must
 * therefore neither charge (that would double-charge) nor skip the forward (that would skip them).
 */

const h = vi.hoisted(() => ({
  postChatChimmy: vi.fn(),
  runAgentPipeline: vi.fn(),
  streamAgentPipeline: vi.fn(),
  flag: vi.fn(),
  readPlan: vi.fn(),
  takePlan: vi.fn(),
  releasePlan: vi.fn(),
  requireFeatureEntitlement: vi.fn(),
  checkDailyCap: vi.fn(),
  incrementDailyCap: vi.fn(),
  runAiProtection: vi.fn(),
  commissioner: vi.fn(),
}))

vi.mock('@/app/api/chat/chimmy/route', () => ({ POST: h.postChatChimmy }))
vi.mock('@/lib/agents/anthropic-pipeline', () => ({
  runAgentPipeline: h.runAgentPipeline,
  streamAgentPipeline: h.streamAgentPipeline,
  isAnthropicPipelineAvailable: () => true,
}))
vi.mock('@/lib/feature-toggle', () => ({ isAnthropicChimmyEnabled: h.flag }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'session-user', email: 'pro@example.com' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection', () => ({ runAiProtection: h.runAiProtection }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: h.requireFeatureEntitlement }))
vi.mock('@/lib/subscription/FeatureGateService', () => ({ FeatureGateService: class {
  async evaluateUserFeatureAccess() { return { allowed: true, entitlement: { plans: ['pro'] } } }
} }))
vi.mock('@/lib/chimmy/planAllowance', () => ({
  readChimmyAnswerAllowance: h.readPlan,
  takeChimmyPlanAllowance: h.takePlan,
  releaseChimmyPlanAllowance: h.releasePlan,
}))
vi.mock('@/lib/ai/dailyCaps', () => ({ checkDailyCap: h.checkDailyCap, incrementDailyCap: h.incrementDailyCap }))
vi.mock('@/lib/ai/deterministic', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/deterministic')>('@/lib/ai/deterministic')
  return { ...actual, tryDeterministicAnswer: async () => null }
})
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({ resolveChimmyCommissionerGrounding: h.commissioner }))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({ resolveLeagueIntelligenceGrounding: async () => null }))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({ resolvePortfolioGrounding: async () => ({ status: 'empty' }) }))

const ask = async (extra: Record<string, unknown> = {}) => {
  const { POST } = await import('@/app/api/chimmy/route')
  return POST(
    createMockNextRequest('http://localhost/api/chimmy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'next-auth.session-token=test; af_lang=es' },
      body: JSON.stringify({
        message: 'Should I accept this trade?',
        userContext: { sport: 'NFL', leagueId: 'league-1', source: 'chimmy_chat', privateMode: true, targetUsername: 'rival' },
        ...extra,
      }),
    }) as never,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  h.postChatChimmy.mockResolvedValue(NextResponse.json({ response: 'Grounded answer.' }, { status: 200 }))
  h.runAgentPipeline.mockResolvedValue({ result: 'Ungrounded answer.', intent: 'trade_evaluation', model: 'claude', tokensUsed: 10 })
  h.runAiProtection.mockResolvedValue(null)
  h.commissioner.mockResolvedValue('COMMISH-GROUNDING')
  h.readPlan.mockResolvedValue({ planName: 'AF Pro', limit: 100, used: 1, remaining: 99, resetsAt: '2026-11-29T00:00:00.000Z' })
  h.takePlan.mockResolvedValue({ planName: 'AF Pro', limit: 100, used: 2, remaining: 98, resetsAt: '2026-11-29T00:00:00.000Z' })
  h.checkDailyCap.mockResolvedValue({ allowed: true })
})

beforeAll(async () => { await import('@/app/api/chimmy/route') }, 300_000)

describe('/api/chimmy forwards every panel to /api/chat/chimmy', () => {
  for (const flag of [true, false]) {
    it(`forwards with the Anthropic flag ${flag ? 'ON' : 'OFF'} and never runs the ungrounded pipeline`, async () => {
      h.flag.mockResolvedValue(flag)
      const res = await ask()
      expect(res.status).toBe(200)
      expect((await res.json()).response).toBe('Grounded answer.')
      expect(h.postChatChimmy).toHaveBeenCalledTimes(1)
      expect(h.runAgentPipeline).not.toHaveBeenCalled()
      expect(h.streamAgentPipeline).not.toHaveBeenCalled()
    })

    it(`charges nothing itself with the flag ${flag ? 'ON' : 'OFF'} — the forwarded route owns the allowance`, async () => {
      h.flag.mockResolvedValue(flag)
      await ask()
      expect(h.readPlan).not.toHaveBeenCalled()
      expect(h.takePlan).not.toHaveBeenCalled()
      expect(h.requireFeatureEntitlement).not.toHaveBeenCalled()
      expect(h.checkDailyCap).not.toHaveBeenCalled()
      expect(h.incrementDailyCap).not.toHaveBeenCalled()
      expect(h.postChatChimmy).toHaveBeenCalledTimes(1)
    })
  }

  it('forwards a streaming request too, rather than streaming the ungrounded pipeline', async () => {
    h.flag.mockResolvedValue(true)
    const res = await ask({ stream: true })
    expect(h.streamAgentPipeline).not.toHaveBeenCalled()
    expect(h.postChatChimmy).toHaveBeenCalledTimes(1)
    expect((await res.json()).response).toBe('Grounded answer.')
  })

  it('carries the private-reply fields, the language cookie and commissioner grounding through the forward', async () => {
    h.flag.mockResolvedValue(true)
    await ask()
    const forwarded = h.postChatChimmy.mock.calls[0][0] as Request
    const form = await forwarded.formData()
    expect(form.get('privateMode')).toBe('true')
    expect(form.get('targetUsername')).toBe('rival')
    expect(form.get('leagueId')).toBe('league-1')
    expect(form.get('commissionerGrounding')).toBe('COMMISH-GROUNDING')
    expect(forwarded.headers.get('cookie')).toContain('af_lang=es')
  })
})
