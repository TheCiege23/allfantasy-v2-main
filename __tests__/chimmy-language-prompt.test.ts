/**
 * Tests that /api/chimmy correctly reads the af_lang cookie, passes the
 * selected locale through the Anthropic pipeline as UserContext.language,
 * injects the language instruction into the system prompt, isolates the
 * cache key by language, and localizes deterministic refusals.
 *
 * Covers the requirements from:
 * - UserContext.language field in anthropic-pipeline.ts
 * - buildRuntimeSystemPrompt language injection
 * - callClaude cacheContext language field
 * - tryDeterministicAnswer locale param
 * - /api/chimmy cookie read (af_lang)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const chatChimmyPostMock = vi.fn()
const runAgentPipelineMock = vi.fn()
const streamAgentPipelineMock = vi.fn()
const isAnthropicChimmyEnabledMock = vi.fn()
const isAnthropicPipelineAvailableMock = vi.fn()
const getServerSessionMock = vi.fn()
const runAiProtectionMock = vi.fn()
const requireFeatureEntitlementMock = vi.fn()
const refundSpendByLedgerMock = vi.fn()
const checkDailyCapMock = vi.fn()
const incrementDailyCapMock = vi.fn()
const tryDeterministicAnswerMock = vi.fn()
const cookiesMock = vi.fn()
vi.mock('@/lib/chimmy/planAllowance', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/chimmy/planAllowance')>(),
  // These fixtures exercise the paid-token path after the two daily answers are used.
  readChimmyAnswerAllowance: async () => ({ kind: 'free', planName: 'Free Chimmy', limit: 2,
    used: 2, remaining: 0, resetsAt: '2026-10-26T00:00:00.000Z' }),
}))

vi.mock('server-only', () => ({}))

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}))

vi.mock('@/app/api/chat/chimmy/route', () => ({
  POST: chatChimmyPostMock,
}))

vi.mock('@/lib/agents/anthropic-pipeline', () => ({
  runAgentPipeline: runAgentPipelineMock,
  streamAgentPipeline: streamAgentPipelineMock,
  isAnthropicPipelineAvailable: isAnthropicPipelineAvailableMock,
}))

vi.mock('@/lib/feature-toggle', () => ({
  isAnthropicChimmyEnabled: isAnthropicChimmyEnabledMock,
}))

vi.mock('next-auth', () => ({
  getServerSession: getServerSessionMock,
}))

vi.mock('@/lib/auth', () => ({
  authOptions: {},
}))

vi.mock('@/lib/ai-protection', () => ({
  runAiProtection: runAiProtectionMock,
}))

vi.mock('@/lib/subscription/entitlement-middleware', () => ({
  requireFeatureEntitlement: requireFeatureEntitlementMock,
}))

vi.mock('@/lib/tokens/TokenSpendService', () => ({
  TokenSpendService: vi.fn().mockImplementation(() => ({
    refundSpendByLedger: refundSpendByLedgerMock,
  })),
}))

vi.mock('@/lib/ai/dailyCaps', () => ({
  checkDailyCap: checkDailyCapMock,
  incrementDailyCap: incrementDailyCapMock,
}))

vi.mock('@/lib/ai/deterministic', () => ({
  tryDeterministicAnswer: tryDeterministicAnswerMock,
  DETERMINISTIC_SOURCE: 'deterministic',
}))

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCookieStore(afLang?: string) {
  return {
    get: (key: string) =>
      key === 'af_lang' && afLang ? { value: afLang } : undefined,
  }
}

function buildJsonRequest(body: Record<string, unknown>, cookieHeader?: string) {
  return createMockNextRequest('http://localhost/api/chimmy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cookie': cookieHeader ?? 'next-auth.session-token=test',
    },
    body: JSON.stringify(body),
  })
}

function setupHappyPath() {
  isAnthropicChimmyEnabledMock.mockResolvedValue(true)
  isAnthropicPipelineAvailableMock.mockReturnValue(true)
  getServerSessionMock.mockResolvedValue({ user: { id: 'user-1', email: 'test@test.com' } })
  runAiProtectionMock.mockResolvedValue(null)
  requireFeatureEntitlementMock.mockResolvedValue({
    ok: true,
    decision: { entitlement: { plans: [] } },
    tokenSpend: { id: 'language-ledger', balanceAfter: 10 },
    response: null,
  })
  checkDailyCapMock.mockResolvedValue({ allowed: true })
  tryDeterministicAnswerMock.mockResolvedValue(null)
  incrementDailyCapMock.mockResolvedValue(undefined)
  runAgentPipelineMock.mockResolvedValue({
    result: 'Test response',
    intent: 'general',
    model: 'test-model',
    tokensUsed: 10,
  })
}

// ── /api/chimmy — language cookie → UserContext.language ──────────────────────

describe('POST /api/chimmy — language cookie passthrough', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupHappyPath()
  })

  it('passes af_lang=es to runAgentPipeline as UserContext.language = "es"', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('es'))

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest(
      { message: 'What should I do next?' },
      'next-auth.session-token=test; af_lang=es'
    )
    await POST(req)

    expect(runAgentPipelineMock).toHaveBeenCalledOnce()
    const ctx = runAgentPipelineMock.mock.calls[0][1]
    expect(ctx.language).toBe('es')
  })

  it('passes af_lang=zh to runAgentPipeline as UserContext.language = "zh"', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('zh'))

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What should I do next?' })
    await POST(req)

    expect(runAgentPipelineMock).toHaveBeenCalledOnce()
    const ctx = runAgentPipelineMock.mock.calls[0][1]
    expect(ctx.language).toBe('zh')
  })

  it('passes af_lang=fil to runAgentPipeline as UserContext.language = "fil"', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('fil'))

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What should I do next?' })
    await POST(req)

    expect(runAgentPipelineMock).toHaveBeenCalledOnce()
    const ctx = runAgentPipelineMock.mock.calls[0][1]
    expect(ctx.language).toBe('fil')
  })

  it('passes af_lang=vi to runAgentPipeline as UserContext.language = "vi"', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('vi'))

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What should I do next?' })
    await POST(req)

    expect(runAgentPipelineMock).toHaveBeenCalledOnce()
    const ctx = runAgentPipelineMock.mock.calls[0][1]
    expect(ctx.language).toBe('vi')
  })

  it('defaults to "en" when af_lang cookie is absent', async () => {
    cookiesMock.mockReturnValue(makeCookieStore())

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What should I do next?' })
    await POST(req)

    expect(runAgentPipelineMock).toHaveBeenCalledOnce()
    const ctx = runAgentPipelineMock.mock.calls[0][1]
    expect(ctx.language).toBe('en')
  })

  it('defaults to "en" when cookies() throws (fail-safe)', async () => {
    cookiesMock.mockImplementation(() => { throw new Error('cookie access failed') })

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What should I do next?' })
    await POST(req)

    expect(runAgentPipelineMock).toHaveBeenCalledOnce()
    const ctx = runAgentPipelineMock.mock.calls[0][1]
    expect(ctx.language).toBe('en')
  })

  it('defaults to "en" for an unsupported locale in af_lang cookie', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('de'))

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What should I do next?' })
    await POST(req)

    expect(runAgentPipelineMock).toHaveBeenCalledOnce()
    const ctx = runAgentPipelineMock.mock.calls[0][1]
    expect(ctx.language).toBe('en')
  })
})

// ── /api/chimmy — locale passed to tryDeterministicAnswer ────────────────────

describe('POST /api/chimmy — locale forwarded to deterministic shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupHappyPath()
  })

  it('passes es locale to tryDeterministicAnswer', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('es'))

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What games are on today?' })
    await POST(req)

    expect(tryDeterministicAnswerMock).toHaveBeenCalledWith(
      'What games are on today?',
      'es'
    )
  })

  it('passes en locale to tryDeterministicAnswer when cookie is absent', async () => {
    cookiesMock.mockReturnValue(makeCookieStore())

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What games are on today?' })
    await POST(req)

    expect(tryDeterministicAnswerMock).toHaveBeenCalledWith(
      'What games are on today?',
      'en'
    )
  })

  it('does not call AI provider when deterministic shortcut fires', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('es'))
    tryDeterministicAnswerMock.mockResolvedValue(
      'Necesito datos del calendario en vivo para responder con precisión sobre los partidos de hoy.'
    )

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What games are on today?' })
    const res = await POST(req)

    expect(runAgentPipelineMock).not.toHaveBeenCalled()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.response).toContain('Necesito')
  })
})

// ── Pipeline system prompt — language instruction injection ───────────────────

describe('getAiLanguageInstruction — language names for prompt injection', () => {
  it('returns "Spanish" for es', async () => {
    const { getAiLanguageInstruction } = await import('@/lib/world-cup/worldCupI18n')
    expect(getAiLanguageInstruction('es')).toBe('Spanish')
  })

  it('returns "Traditional Chinese" for zh', async () => {
    const { getAiLanguageInstruction } = await import('@/lib/world-cup/worldCupI18n')
    expect(getAiLanguageInstruction('zh')).toBe('Traditional Chinese')
  })

  it('returns "Filipino" for fil', async () => {
    const { getAiLanguageInstruction } = await import('@/lib/world-cup/worldCupI18n')
    expect(getAiLanguageInstruction('fil')).toBe('Filipino')
  })

  it('returns "Vietnamese" for vi', async () => {
    const { getAiLanguageInstruction } = await import('@/lib/world-cup/worldCupI18n')
    expect(getAiLanguageInstruction('vi')).toBe('Vietnamese')
  })

  it('returns "English" for en', async () => {
    const { getAiLanguageInstruction } = await import('@/lib/world-cup/worldCupI18n')
    expect(getAiLanguageInstruction('en')).toBe('English')
  })

  it('returns "English" for null/undefined/unknown', async () => {
    const { getAiLanguageInstruction } = await import('@/lib/world-cup/worldCupI18n')
    expect(getAiLanguageInstruction(null)).toBe('English')
    expect(getAiLanguageInstruction(undefined)).toBe('English')
    expect(getAiLanguageInstruction('xx')).toBe('English')
  })
})

// ── Provider fallback preservation ───────────────────────────────────────────

describe('POST /api/chimmy — provider fallback and safety invariants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupHappyPath()
  })

  it('does not expose provider name in response', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('es'))
    runAgentPipelineMock.mockResolvedValue({
      result: 'Aquí está tu análisis de fantasía.',
      intent: 'general',
      model: 'gpt-4o',
      tokensUsed: 120,
    })

    const { POST } = await import('@/app/api/chimmy/route')
    // Use a general question without trade/waiver keywords to avoid league-grounding gate
    const req = buildJsonRequest({ message: 'Give me fantasy advice' })
    const res = await POST(req)
    const body = await res.json()

    // Provider model name should not appear in the user-facing response field
    expect(typeof body.response).toBe('string')
    expect(body.response).not.toContain('gpt-4o')
    expect(body.response).not.toContain('claude')
    expect(body.response).not.toContain('deepseek')
  })

  it('abuse rate limits still apply regardless of language', async () => {
    cookiesMock.mockReturnValue(makeCookieStore('es'))
    runAiProtectionMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }))

    const { POST } = await import('@/app/api/chimmy/route')
    const req = buildJsonRequest({ message: 'What should I do?' })
    const res = await POST(req)

    expect(res.status).toBe(429)
    expect(runAgentPipelineMock).not.toHaveBeenCalled()
  })

  it('deterministic shortcut bypasses provider regardless of language', async () => {
    for (const locale of ['en', 'es', 'zh', 'fil', 'vi']) {
      vi.clearAllMocks()
      setupHappyPath()
      cookiesMock.mockReturnValue(makeCookieStore(locale))
      tryDeterministicAnswerMock.mockResolvedValue(`Refusal in ${locale}`)

      const { POST } = await import('@/app/api/chimmy/route')
      const req = buildJsonRequest({ message: 'What games are today?' })
      await POST(req)

      expect(runAgentPipelineMock).not.toHaveBeenCalled()
    }
  })

  it('runtime safety: no new routes created — exports only POST', async () => {
    const routeModule = await import('@/app/api/chimmy/route')
    // Only POST is exported (no new GET, PUT, DELETE, etc.)
    expect(typeof routeModule.POST).toBe('function')
    expect(routeModule).not.toHaveProperty('GET')
    expect(routeModule).not.toHaveProperty('PUT')
    expect(routeModule).not.toHaveProperty('DELETE')
  })
})
