/**
 * Chimmy's tool loop falls through Claude → Grok → DeepSeek when a provider cannot start.
 *
 * Measured in production 2026-10-31: Anthropic `401 invalid x-api-key`, Grok `permission-denied`,
 * DeepSeek working — and the loop, having picked Claude because its key was PRESENT, returned null,
 * so every answer went out without tools.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  anthropicCreate: vi.fn(),
  openaiCreate: vi.fn(),
  openaiOpts: [] as Array<{ baseURL?: string }>,
  execute: vi.fn(),
}))

vi.mock('@/lib/ai-orchestration/providerOutageAlert', () => ({ reportProviderFailure: vi.fn() }))
vi.mock('@/lib/telemetry/usage', () => ({ logUsageEvent: vi.fn(async () => undefined) }))

vi.mock('@anthropic-ai/sdk', () => {
  class BadRequestError extends Error {
    status = 400
  }
  class Anthropic {
    static BadRequestError = BadRequestError
    messages = { create: h.anthropicCreate }
    constructor(public opts: unknown) {}
  }
  return { default: Anthropic }
})

vi.mock('openai', () => ({
  default: class {
    // Which base URL each call went to, so a test can say Grok vs DeepSeek.
    chat = {
      completions: {
        create: (...a: unknown[]) => h.openaiCreate(this.opts.baseURL, ...a),
      },
    }
    constructor(public opts: { baseURL?: string }) {
      h.openaiOpts.push(opts)
    }
  },
}))

vi.mock('@/lib/chimmy/tools/chimmyTools', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chimmy/tools/chimmyTools')>('@/lib/chimmy/tools/chimmyTools')
  return { ...actual, executeChimmyTool: h.execute }
})

import {
  chimmyToolLoopProviders,
  isProviderUnavailable,
  runChimmyToolLoop,
} from '@/lib/chimmy/tools/chimmyToolLoop'

const base = {
  question: 'find me an open NBA league',
  systemPrompt: 'You are Chimmy.',
  context: { leagueId: null, userId: 'u1' },
  enabled: true,
}

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status })
const isDeepSeek = (url: unknown) => String(url).includes('deepseek')

function openAiAnswer(text: string) {
  return { model: 'm', choices: [{ message: { role: 'assistant', content: text } }], usage: {} }
}
function openAiWantsTool(name: string) {
  return {
    model: 'm',
    choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name, arguments: '{}' } }] } }],
    usage: {},
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.openaiOpts.length = 0
  vi.stubEnv('ANTHROPIC_API_KEY', 'dead-anthropic-key')
  vi.stubEnv('XAI_API_KEY', 'dead-xai-key')
  vi.stubEnv('DEEPSEEK_API_KEY', 'live-deepseek-key')
  vi.stubEnv('DEEPSEEK_BASE_URL', '')
  vi.stubEnv('CHIMMY_TOOL_LOOP_PROVIDER', '')
  h.execute.mockResolvedValue('NBA guilly — 2 open seats')
})

afterEach(() => vi.unstubAllEnvs())

describe('provider order', () => {
  it('tries every configured provider, Claude first and DeepSeek last', () => {
    expect(chimmyToolLoopProviders()).toEqual(['claude', 'grok', 'deepseek'])
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('XAI_API_KEY', '')
    expect(chimmyToolLoopProviders()).toEqual(['deepseek'])
  })

  it('CHIMMY_TOOL_LOOP_PROVIDER=deepseek skips the dead providers entirely', () => {
    vi.stubEnv('CHIMMY_TOOL_LOOP_PROVIDER', 'deepseek')
    expect(chimmyToolLoopProviders()).toEqual(['deepseek'])
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    expect(chimmyToolLoopProviders()).toEqual([])
  })
})

describe('isProviderUnavailable', () => {
  it('is a dead key, no credit, a rate limit or an outage — before any tool ran', () => {
    for (const status of [401, 402, 403, 429, 500, 503]) expect(isProviderUnavailable(status, 0)).toBe(true)
  })
  it('is not a bad request, a timeout (no status), or anything after a tool ran', () => {
    expect(isProviderUnavailable(400, 0)).toBe(false)
    expect(isProviderUnavailable(undefined, 0)).toBe(false)
    expect(isProviderUnavailable(401, 1)).toBe(false)
  })
})

describe('the fallback, end to end', () => {
  it('answers with tools on DeepSeek when Claude and Grok keys are dead — as in production', async () => {
    h.anthropicCreate.mockRejectedValue(httpError(401))
    h.openaiCreate.mockImplementation(async (url: unknown) => {
      if (!isDeepSeek(url)) throw httpError(403)
      return h.openaiCreate.mock.calls.filter(([u]) => isDeepSeek(u)).length === 1
        ? openAiWantsTool('find_open_leagues')
        : openAiAnswer('NBA guilly has 2 open seats.')
    })

    const result = await runChimmyToolLoop(base)

    expect(result).toMatchObject({
      text: 'NBA guilly has 2 open seats.',
      provider: 'deepseek',
      toolsUsed: ['find_open_leagues'],
      failedOver: ['claude', 'grok'],
    })
    expect(h.execute).toHaveBeenCalledTimes(1)
    const deepseekCall = h.openaiCreate.mock.calls.find(([u]) => isDeepSeek(u))!
    expect(deepseekCall[1].model).toMatch(/^deepseek-/)
    expect(deepseekCall[1].tools.length).toBeGreaterThan(0)
  })

  it('does not fall through on a timeout — the push path answers, as before', async () => {
    h.anthropicCreate.mockRejectedValue(new Error('Request timed out.'))
    expect(await runChimmyToolLoop(base)).toBeNull()
    expect(h.openaiCreate).not.toHaveBeenCalled()
  })

  it('does not fall through once a tool has run, so confirm cards are never built twice', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    let grokCalls = 0
    h.openaiCreate.mockImplementation(async (url: unknown) => {
      if (isDeepSeek(url)) return openAiAnswer('should not be reached')
      grokCalls += 1
      if (grokCalls === 1) return openAiWantsTool('find_open_leagues')
      throw httpError(503)
    })
    expect(await runChimmyToolLoop(base)).toBeNull()
    expect(h.openaiCreate.mock.calls.some(([u]) => isDeepSeek(u))).toBe(false)
  })

  it('a working Claude still answers first; nothing else is called', async () => {
    h.anthropicCreate.mockResolvedValue({ model: 'claude', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hi' }] })
    const result = await runChimmyToolLoop(base)
    expect(result).toMatchObject({ provider: 'claude', text: 'Hi' })
    expect(result?.failedOver).toBeUndefined()
    expect(h.openaiCreate).not.toHaveBeenCalled()
  })
})
