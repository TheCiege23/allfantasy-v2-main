import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Spend metering (2026-09-28). Every provider ran out of credit on the same day and nothing in the
 * app could say what had spent it, because the router, Chimmy's tool loop and the Opus adapter
 * recorded no tokens. `recordLlmCall` is the one writer; these tests pin what it writes, and that the
 * router meters every provider ATTEMPT under the caller's feature name.
 */

const h = vi.hoisted(() => ({ logUsageEvent: vi.fn(), openaiChatText: vi.fn(), xaiChatJson: vi.fn() }))

vi.mock('@/lib/telemetry/usage', () => ({ logUsageEvent: h.logUsageEvent }))
vi.mock('@/lib/openai-client', () => ({ openaiChatText: h.openaiChatText, openaiChatTextStream: vi.fn() }))
vi.mock('@/lib/xai-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/xai-client')>('@/lib/xai-client')
  return { ...actual, xaiChatJson: h.xaiChatJson }
})
vi.mock('@/lib/deepseek-client', () => ({ deepseekChat: vi.fn() }))
vi.mock('@/lib/workers/rate-limit-manager', () => ({
  rateLimitManager: { canCall: vi.fn(async () => true), recordCall: vi.fn(async () => undefined) },
}))

import { anthropicTokenUsage, recordLlmCall } from '@/lib/telemetry/llm-usage'
import { routeTextCall } from '@/lib/ai/providerRouter'
import { assertAiSpendAllowed } from '@/lib/ai/aiSpendGuard'

/** `recordLlmCall` is fire-and-forget; let its promise settle. */
const settle = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  vi.clearAllMocks()
  h.logUsageEvent.mockResolvedValue(undefined)
})
afterEach(() => vi.unstubAllEnvs())

describe('recordLlmCall', () => {
  it('writes one llm_call row, grouped by feature and by provider/model', async () => {
    recordLlmCall({
      feature: 'draft_lookahead', provider: 'anthropic', model: 'claude-sonnet-4-6', userId: 'u1', leagueId: 'L1',
      usage: { inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 0 }, maxTokens: 900, ok: true, durationMs: 42,
    })
    await settle()
    expect(h.logUsageEvent).toHaveBeenCalledTimes(1)
    expect(h.logUsageEvent.mock.calls[0][0]).toMatchObject({
      scope: 'api', tool: 'draft_lookahead', endpoint: 'llm/anthropic/claude-sonnet-4-6', ok: true, userId: 'u1', leagueId: 'L1', durationMs: 42,
      meta: {
        kind: 'llm_call', provider: 'anthropic', model: 'claude-sonnet-4-6',
        inputTokens: 1200, outputTokens: 300, cacheReadTokens: 900, cacheWriteTokens: 0,
        // The keys the older recorder writes, so one query reads both kinds of row.
        promptTokens: 1200, completionTokens: 300, totalTokens: 1500, maxTokens: 900, tokensExact: true,
      },
    })
  })

  it('still records a call whose tokens are unknown, marked inexact', async () => {
    recordLlmCall({ feature: 'provider-router', provider: 'openai', model: 'gpt-4o', ok: true })
    await settle()
    expect(h.logUsageEvent.mock.calls[0][0].meta).toMatchObject({ inputTokens: null, totalTokens: null, tokensExact: false })
  })

  it('never throws and never blocks, even when the write fails', async () => {
    h.logUsageEvent.mockRejectedValue(new Error('db down'))
    expect(() => recordLlmCall({ feature: 'x', provider: 'anthropic', model: 'm', ok: true })).not.toThrow()
    await settle()
  })

  it('maps Anthropic usage, cache tokens included', () => {
    expect(anthropicTokenUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 }))
      .toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 3 })
    expect(anthropicTokenUsage(null)).toBeNull()
  })
})

describe('the provider router meters every attempt', () => {
  beforeEach(() => {
    vi.stubEnv('AI_PROVIDER_ORDER', 'openai,xai')
    vi.stubEnv('AI_FEATURES_ENABLED', 'true')
  })

  it('records the failed provider AND the fallback that answered, under the caller\'s feature', async () => {
    // OpenAI's billing lapsed: this is how spend moved to the next provider unseen.
    h.openaiChatText.mockResolvedValue({ ok: false, status: 402, details: 'billing_not_active' })
    h.xaiChatJson.mockResolvedValue({ ok: true, json: { model: 'grok-4', choices: [{ message: { content: 'hi' } }] } })

    const result = await routeTextCall({ messages: [{ role: 'user', content: 'q' }], feature: 'draft_lookahead', userId: 'u1', maxTokens: 900 })
    await settle()

    expect(result.ok).toBe(true)
    const rows = h.logUsageEvent.mock.calls.map((c) => c[0])
    expect(rows.map((r) => [r.tool, r.meta.provider, r.ok])).toEqual([
      ['draft_lookahead', 'openai', false],
      ['draft_lookahead', 'xai', true],
    ])
    expect(rows[1]).toMatchObject({ endpoint: 'llm/xai/grok-4', userId: 'u1', meta: { maxTokens: 900 } })
  })

  it('labels an unnamed caller as provider-router rather than dropping it', async () => {
    h.openaiChatText.mockResolvedValue({ ok: true, text: 'hi', model: 'gpt-4o' })
    await routeTextCall({ messages: [{ role: 'user', content: 'q' }] })
    await settle()
    expect(h.logUsageEvent.mock.calls[0][0]).toMatchObject({ tool: 'provider-router', endpoint: 'llm/openai/gpt-4o', ok: true })
  })

  it('records nothing when the spend switch is off: no request left the process', async () => {
    h.openaiChatText.mockImplementation(async () => assertAiSpendAllowed('test'))
    vi.stubEnv('AI_FEATURES_ENABLED', '')
    const result = await routeTextCall({ messages: [{ role: 'user', content: 'q' }], feature: 'draft_lookahead' })
    await settle()
    expect(result.ok).toBe(false)
    expect(h.logUsageEvent).not.toHaveBeenCalled()
  })
})
