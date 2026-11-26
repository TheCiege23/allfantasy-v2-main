// @vitest-environment node
/**
 * The live-draft look-ahead must use the QUICK model. On the specialist model it took ~11 s against the
 * router's 12 s per-provider limit, so most calls timed out while a manager was on the clock.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ route: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/ai/providerRouter', () => ({ routeTextCall: m.route, routeStreamCall: vi.fn() }))

import { runDraftLookaheadAgent } from '@/lib/agents/anthropic-pipeline'

beforeEach(() => {
  vi.clearAllMocks()
  m.route.mockResolvedValue({ ok: true, provider: 'anthropic', model: 'x', text: '{}', tokensUsed: 1 })
})

describe('runDraftLookaheadAgent', () => {
  it('asks for the quick model, under its own spend label', async () => {
    await runDraftLookaheadAgent({ mode: 'on_clock', queue: [] }, { userId: 'u1', tier: 'pro', sport: 'NFL', leagueFormat: 'redraft', leagueId: 'L1' } as never)
    expect(m.route).toHaveBeenCalledTimes(1)
    const args = m.route.mock.calls[0]![0] as { preferredAnthropicModel: string; feature: string; maxTokens: number }
    expect(args.feature).toBe('draft_lookahead')
    expect(args.preferredAnthropicModel).toMatch(/haiku/)
    expect(args.preferredAnthropicModel).not.toMatch(/sonnet|opus/)
    expect(args.maxTokens).toBe(900)
  })
})
