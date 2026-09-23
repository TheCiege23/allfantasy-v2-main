import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ anthropicCreate: vi.fn(), openaiCreate: vi.fn(), execute: vi.fn() }))

const reportProviderFailure = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ai-orchestration/providerOutageAlert', () => ({ reportProviderFailure }))

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
    chat = { completions: { create: h.openaiCreate } }
    constructor(public opts: unknown) {}
  },
}))

vi.mock('@/lib/chimmy/tools/chimmyTools', async () => {
  const actual = await vi.importActual<typeof import('@/lib/chimmy/tools/chimmyTools')>(
    '@/lib/chimmy/tools/chimmyTools',
  )
  return { ...actual, executeChimmyTool: h.execute }
})

import Anthropic from '@anthropic-ai/sdk'
import {
  canRunChimmyToolLoop,
  chimmyToolsForClaude,
  resolveChimmyToolLoopProvider,
  runChimmyToolLoop,
} from '@/lib/chimmy/tools/chimmyToolLoop'
import { CHIMMY_TOOL_SPECS } from '@/lib/chimmy/tools/chimmyTools'

const CTX = { leagueId: 'l1', userId: 'u1' }

function answer(text: string) {
  return {
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text },
    ],
  }
}

function wantsTools(...uses: Array<{ id: string; name: string; input?: unknown }>) {
  return {
    model: 'claude-opus-5',
    stop_reason: 'tool_use',
    content: uses.map((u) => ({ type: 'tool_use', id: u.id, name: u.name, input: u.input ?? {} })),
  }
}

const base = {
  question: 'who leads in touchdowns?',
  systemPrompt: 'You are Chimmy.',
  clockLine: 'Today is Wednesday, 2026-09-23.',
  context: CTX,
  enabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-anthropic-key')
  vi.stubEnv('XAI_API_KEY', 'test-xai-key')
  vi.stubEnv('CHIMMY_TOOL_LOOP_PROVIDER', '')
  vi.stubEnv('CHIMMY_CLAUDE_MODEL', '')
  h.execute.mockResolvedValue('Leaders: 1. Josh Allen — 2')
})

afterEach(() => vi.unstubAllEnvs())

describe('which model runs the Chimmy tool loop', () => {
  it('is Claude whenever an Anthropic key is present — even with an xAI key too', () => {
    expect(resolveChimmyToolLoopProvider()).toBe('claude')
  })

  it('falls back to Grok only without an Anthropic key', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(resolveChimmyToolLoopProvider()).toBe('grok')
  })

  it('honours an explicit pin to Grok', () => {
    vi.stubEnv('CHIMMY_TOOL_LOOP_PROVIDER', 'grok')
    expect(resolveChimmyToolLoopProvider()).toBe('grok')
  })

  it('can run with ONLY an Anthropic key (the loop used to need xAI)', () => {
    vi.stubEnv('XAI_API_KEY', '')
    vi.stubEnv('GROK_API_KEY', '')
    expect(canRunChimmyToolLoop(true)).toBe(true)
    expect(canRunChimmyToolLoop(false)).toBe(false)
  })

  it('cannot run with no key at all', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('XAI_API_KEY', '')
    vi.stubEnv('GROK_API_KEY', '')
    expect(canRunChimmyToolLoop(true)).toBe(false)
  })
})

describe('chimmyToolsForClaude', () => {
  it('carries every tool across, schema intact', () => {
    const tools = chimmyToolsForClaude()
    expect(tools.map((t) => t.name)).toEqual(CHIMMY_TOOL_SPECS.map((s) => s.function.name))
    expect(tools[0].input_schema).toBe(CHIMMY_TOOL_SPECS[0].function.parameters)
  })
})

describe('runChimmyToolLoop on Claude', () => {
  it('answers on Claude, never touching Grok', async () => {
    h.anthropicCreate.mockResolvedValue(answer('You have three games left.'))

    const out = await runChimmyToolLoop(base)

    expect(out).toMatchObject({ text: 'You have three games left.', provider: 'claude', model: 'claude-opus-5', turns: 1 })
    expect(h.openaiCreate).not.toHaveBeenCalled()
  })

  it('sends Opus 5 with adaptive thinking, auto tool choice, cached instructions and the clock after them', async () => {
    h.anthropicCreate.mockResolvedValue(answer('ok'))

    await runChimmyToolLoop(base)

    const [params, opts] = h.anthropicCreate.mock.calls[0]
    expect(params.model).toBe('claude-opus-5')
    expect(params.thinking).toEqual({ type: 'adaptive' })
    expect(params.tool_choice).toEqual({ type: 'auto' })
    expect(params.system[0]).toMatchObject({ text: 'You are Chimmy.', cache_control: { type: 'ephemeral' } })
    expect(params.system[1]).toEqual({ type: 'text', text: 'Today is Wednesday, 2026-09-23.' })
    expect(params.tools.map((t: any) => t.name)).toContain('get_stat_leaders')
    expect(params.fallbacks).toBe('default')
    expect(opts.headers).toEqual({ 'anthropic-beta': 'server-side-fallback-2026-07-01' })
  })

  it('lets CHIMMY_CLAUDE_MODEL choose the model', async () => {
    vi.stubEnv('CHIMMY_CLAUDE_MODEL', 'claude-sonnet-5')
    h.anthropicCreate.mockResolvedValue({ ...answer('ok'), model: 'claude-sonnet-5' })

    const out = await runChimmyToolLoop(base)

    expect(h.anthropicCreate.mock.calls[0][0].model).toBe('claude-sonnet-5')
    expect(out?.model).toBe('claude-sonnet-5')
  })

  it('runs the tools, returns ALL results in one user message, and keeps thinking blocks', async () => {
    h.anthropicCreate
      .mockResolvedValueOnce(
        wantsTools(
          { id: 't1', name: 'find_league_by_name', input: { name: 'KBFL' } },
          { id: 't2', name: 'get_league_standings' },
        ),
      )
      .mockResolvedValueOnce(answer('You are 2nd in KBFL.'))

    const out = await runChimmyToolLoop(base)

    expect(out).toMatchObject({ text: 'You are 2nd in KBFL.', toolsUsed: ['find_league_by_name', 'get_league_standings'], turns: 2 })
    // In order: the league lookup rebinds the context the standings call reads.
    expect(h.execute.mock.calls.map((c) => c[0])).toEqual(['find_league_by_name', 'get_league_standings'])
    expect(h.execute).toHaveBeenCalledWith('find_league_by_name', { name: 'KBFL' }, CTX)

    const sent = h.anthropicCreate.mock.calls[1][0].messages
    const resultsTurn = sent.find((m: any) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result')
    expect(resultsTurn.role).toBe('user')
    expect(resultsTurn.content.map((b: any) => b.tool_use_id)).toEqual(['t1', 't2'])
    const assistantTurn = sent.find((m: any) => m.role === 'assistant')
    expect(assistantTurn.content.some((b: any) => b.type === 'tool_use')).toBe(true)
  })

  it('never exceeds the turn ceiling, and does not run tools it cannot answer from', async () => {
    h.anthropicCreate.mockResolvedValue(wantsTools({ id: 't', name: 'get_league_standings' }))

    expect(await runChimmyToolLoop(base)).toBeNull()
    expect(h.anthropicCreate).toHaveBeenCalledTimes(3)
    expect(h.execute).toHaveBeenCalledTimes(2)
  })

  it('treats a refusal or a truncated answer as no answer', async () => {
    h.anthropicCreate.mockResolvedValueOnce({ ...answer('partial'), stop_reason: 'refusal' })
    expect(await runChimmyToolLoop(base)).toBeNull()
    h.anthropicCreate.mockResolvedValueOnce({ ...answer('partial'), stop_reason: 'max_tokens' })
    expect(await runChimmyToolLoop(base)).toBeNull()
  })

  it('retries once WITHOUT the fallback beta when the API rejects the request', async () => {
    h.anthropicCreate
      .mockRejectedValueOnce(new (Anthropic as any).BadRequestError('unknown field fallbacks'))
      .mockResolvedValueOnce(answer('ok'))

    const out = await runChimmyToolLoop(base)

    expect(out?.text).toBe('ok')
    const [retryParams, retryOpts] = h.anthropicCreate.mock.calls[1]
    expect(retryParams.fallbacks).toBeUndefined()
    expect(retryOpts.headers).toBeUndefined()
  })

  it('reports an Anthropic billing failure and falls back instead of throwing', async () => {
    h.anthropicCreate.mockRejectedValue(Object.assign(new Error('credit balance is too low'), { status: 402 }))

    expect(await runChimmyToolLoop(base)).toBeNull()
    expect(reportProviderFailure).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', status: 402, surface: 'chimmy_tool_loop' }),
    )
  })

  it('opens the history on a user turn, as the Messages API requires', async () => {
    h.anthropicCreate.mockResolvedValue(answer('ok'))

    await runChimmyToolLoop({
      ...base,
      conversation: [
        { role: 'assistant', content: 'Hi, I am Chimmy!' },
        { role: 'user', content: 'start Chase?' },
        { role: 'assistant', content: 'Yes.' },
      ],
    })

    const msgs = h.anthropicCreate.mock.calls[0][0].messages
    // The loop mutates one array, so by now the answer has been appended — match, don't index the end.
    expect(msgs[0]).toEqual({ role: 'user', content: 'start Chase?' })
    expect(msgs[1]).toEqual({ role: 'assistant', content: 'Yes.' })
    expect(msgs[2]).toEqual({ role: 'user', content: 'who leads in touchdowns?' })
  })
})
