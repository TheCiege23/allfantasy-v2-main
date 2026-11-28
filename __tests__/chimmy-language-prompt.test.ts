/**
 * Language handling for the `/api/chimmy` alias.
 *
 * Until 2026-11-28 this alias read `af_lang` itself and handed it to `runAgentPipeline` as
 * `UserContext.language` when `feature_chimmy_anthropic` was on. That branch is gone (owner
 * decision: every panel gets the full `/api/chat/chimmy` treatment), so the alias no longer reads
 * the cookie at all. `/api/chat/chimmy` reads it (`resolveLanguage(req.cookies.get('af_lang'))`),
 * and its deterministic shortcut and AI-protection limiter run there. What this suite now proves is
 * that the cookie reaches it intact, for every supported locale, with the old flag ON.
 *
 * Still covered here: `getAiLanguageInstruction`, which the prompt builders use.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const chatChimmyPostMock = vi.fn()
const runAgentPipelineMock = vi.fn()
const isAnthropicChimmyEnabledMock = vi.fn()

vi.mock('server-only', () => ({}))

vi.mock('@/app/api/chat/chimmy/route', () => ({
  POST: chatChimmyPostMock,
}))

vi.mock('@/lib/agents/anthropic-pipeline', () => ({
  runAgentPipeline: runAgentPipelineMock,
  streamAgentPipeline: vi.fn(),
  isAnthropicPipelineAvailable: () => true,
}))

vi.mock('@/lib/feature-toggle', () => ({
  isAnthropicChimmyEnabled: isAnthropicChimmyEnabledMock,
}))

vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'user-1' } }) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/ai-protection', () => ({ runAiProtection: async () => null }))
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({ resolveChimmyCommissionerGrounding: async () => null }))

import { createMockNextRequest } from '@/__tests__/helpers/createMockNextRequest'

function buildJsonRequest(body: Record<string, unknown>, cookieHeader?: string) {
  return createMockNextRequest('http://localhost/api/chimmy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: cookieHeader ?? 'next-auth.session-token=test',
    },
    body: JSON.stringify(body),
  })
}

// Warm the route's module graph once, before any test (see the other Chimmy suites for why).
beforeAll(async () => { await import('@/app/api/chimmy/route') }, 300_000)

describe('POST /api/chimmy — af_lang reaches /api/chat/chimmy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isAnthropicChimmyEnabledMock.mockResolvedValue(true)
    chatChimmyPostMock.mockResolvedValue(new Response(JSON.stringify({ response: 'ok' }), { status: 200 }))
  })

  for (const locale of ['en', 'es', 'zh', 'fil', 'vi']) {
    it(`forwards af_lang=${locale} on the request the dedicated handler reads`, async () => {
      const { POST } = await import('@/app/api/chimmy/route')
      await POST(buildJsonRequest({ message: 'What should I do next?' }, `next-auth.session-token=test; af_lang=${locale}`) as never)
      expect(chatChimmyPostMock).toHaveBeenCalledOnce()
      const forwarded = chatChimmyPostMock.mock.calls[0][0] as Request
      expect(forwarded.headers.get('cookie')).toContain(`af_lang=${locale}`)
      expect(runAgentPipelineMock).not.toHaveBeenCalled()
    })
  }

  it('does not expose a provider name: the alias returns the dedicated handler\'s text', async () => {
    chatChimmyPostMock.mockResolvedValueOnce(new Response(JSON.stringify({ response: 'Aquí está tu análisis.' }), { status: 200 }))
    const { POST } = await import('@/app/api/chimmy/route')
    const res = await POST(buildJsonRequest({ message: 'Give me fantasy advice' }, 'af_lang=es') as never)
    const body = await res.json()
    expect(body.response).toBe('Aquí está tu análisis.')
    expect(body.response).not.toMatch(/gpt-4o|claude|deepseek/)
  })

  it('passes a 429 from the dedicated handler through unchanged', async () => {
    chatChimmyPostMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }))
    const { POST } = await import('@/app/api/chimmy/route')
    const res = await POST(buildJsonRequest({ message: 'What should I do?' }, 'af_lang=es') as never)
    expect(res.status).toBe(429)
    expect(runAgentPipelineMock).not.toHaveBeenCalled()
  })

  it('runtime safety: no new routes created — exports only POST', async () => {
    const routeModule = await import('@/app/api/chimmy/route')
    expect(typeof routeModule.POST).toBe('function')
    expect(routeModule).not.toHaveProperty('GET')
    expect(routeModule).not.toHaveProperty('PUT')
    expect(routeModule).not.toHaveProperty('DELETE')
  })
})

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
