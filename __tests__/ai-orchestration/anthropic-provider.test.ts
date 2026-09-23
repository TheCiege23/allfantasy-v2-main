import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ create: vi.fn(), spend: true }))

vi.mock('@/lib/ai/aiSpendGuard', () => ({ isAiSpendEnabled: () => h.spend }))

vi.mock('@anthropic-ai/sdk', () => {
  class BadRequestError extends Error {
    status = 400
  }
  class APIConnectionTimeoutError extends Error {}
  class Anthropic {
    static BadRequestError = BadRequestError
    static APIConnectionTimeoutError = APIConnectionTimeoutError
    messages = { create: h.create }
    constructor(public opts: unknown) {}
  }
  return { default: Anthropic }
})

import Anthropic from '@anthropic-ai/sdk'
import { createAnthropicProvider, toClaudeRequest } from '@/lib/ai-orchestration/providers/anthropic-provider'

const MESSAGES = [
  { role: 'system' as const, content: 'You are Chimmy.' },
  { role: 'system' as const, content: 'Sport context: NFL.' },
  { role: 'user' as const, content: 'Data context: {...}\n\nUser: start Chase?' },
]

const reply = (text: string, extra: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5',
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text }],
  usage: { input_tokens: 900, output_tokens: 120 },
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  h.spend = true
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key')
  vi.stubEnv('CHIMMY_CLAUDE_MODEL', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('createAnthropicProvider', () => {
  it('is available only with a key', () => {
    expect(createAnthropicProvider().isAvailable()).toBe(true)
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(createAnthropicProvider().isAvailable()).toBe(false)
  })

  it('splits system from user and sends Chimmy\'s Claude settings', async () => {
    h.create.mockResolvedValue(reply('Start him.'))

    const out = await createAnthropicProvider().chat({ messages: MESSAGES, maxTokens: 1000, timeoutMs: 45_000 })

    expect(out).toMatchObject({ status: 'ok', provider: 'anthropic', text: 'Start him.', model: 'claude-opus-5', tokensPrompt: 900 })
    const [params, opts] = h.create.mock.calls[0]
    expect(params.model).toBe('claude-opus-5')
    expect(params.system).toBe('You are Chimmy.\n\nSport context: NFL.')
    expect(params.messages).toEqual([{ role: 'user', content: 'Data context: {...}\n\nUser: start Chase?' }])
    expect(params.thinking).toEqual({ type: 'adaptive' })
    // The orchestrator's 1000 would be eaten by thinking — the floor is Chimmy's 8000.
    expect(params.max_tokens).toBe(8000)
    expect(params.fallbacks).toBe('default')
    expect(opts.timeout).toBe(45_000)
    expect(opts.headers).toEqual({ 'anthropic-beta': 'server-side-fallback-2026-07-01' })
  })

  it('uses CHIMMY_CLAUDE_MODEL, the same override as the tool loop', async () => {
    vi.stubEnv('CHIMMY_CLAUDE_MODEL', 'claude-sonnet-5')
    h.create.mockResolvedValue(reply('ok', { model: 'claude-sonnet-5' }))
    await createAnthropicProvider().chat({ messages: MESSAGES })
    expect(h.create.mock.calls[0][0].model).toBe('claude-sonnet-5')
  })

  it('retries without the fallback beta on a 400', async () => {
    h.create.mockRejectedValueOnce(new (Anthropic as any).BadRequestError('bad field')).mockResolvedValueOnce(reply('ok'))
    const out = await createAnthropicProvider().chat({ messages: MESSAGES })
    expect(out.status).toBe('ok')
    expect(h.create.mock.calls[1][0].fallbacks).toBeUndefined()
    expect(h.create.mock.calls[1][1].headers).toBeUndefined()
  })

  it('reports a refusal or truncation as a failure so the next provider tries', async () => {
    h.create.mockResolvedValueOnce(reply('x', { stop_reason: 'refusal' }))
    expect((await createAnthropicProvider().chat({ messages: MESSAGES })).status).toBe('failed')
    h.create.mockResolvedValueOnce(reply('x', { stop_reason: 'max_tokens' }))
    expect((await createAnthropicProvider().chat({ messages: MESSAGES })).status).toBe('failed')
  })

  it('returns a failure (never throws) on an API error, with its status', async () => {
    h.create.mockRejectedValue(Object.assign(new Error('credit balance is too low'), { status: 402 }))
    const out = await createAnthropicProvider().chat({ messages: MESSAGES })
    expect(out.status).toBe('failed')
    expect(out.error).toContain('credit balance')
  })

  it('never calls the API when AI spend is disabled', async () => {
    h.spend = false
    const out = await createAnthropicProvider().chat({ messages: MESSAGES })
    expect(out.status).toBe('failed')
    expect(h.create).not.toHaveBeenCalled()
  })
})

describe('toClaudeRequest', () => {
  it('keeps non-system turns in order', () => {
    expect(
      toClaudeRequest([
        { role: 'system', content: 'S' },
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]),
    ).toEqual({ system: 'S', user: 'a\n\nb' })
  })
})
