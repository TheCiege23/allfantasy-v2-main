import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * `DRAFT_INTEL_AI_ENABLED` (2026-09-28). Draft intel is the one automatic Anthropic spender: every
 * pick asks a model for copy for each manager among the next six picks, about 1,000 calls in a
 * 12-team, 15-round draft. It had no switch of its own. Off must mean NO model call, with the
 * deterministic state returned unchanged.
 */

const h = vi.hoisted(() => ({ available: vi.fn(() => true), agent: vi.fn() }))
vi.mock('@/lib/agents/anthropic-pipeline', () => ({
  isAnthropicPipelineAvailable: h.available,
  runDraftLookaheadAgent: h.agent,
}))

import { applyAiLookaheadCopy } from '@/lib/draft-intelligence/DraftLookaheadService'
import { isDraftIntelAiEnabled } from '@/lib/draft-intelligence/draftIntelAiFlag'
import type { DraftIntelState } from '@/lib/draft-intelligence/types'

const STATE = {
  leagueId: 'L1', userId: 'u1', rosterId: 'r1', leagueName: 'Test', sport: 'NFL', sessionId: 's1',
  status: 'active', trigger: 'pick_made', currentOverall: 10, userNextOverall: 14, picksUntilUser: 4,
  generatedAt: '2026-09-28T00:00:00Z', updatedAt: '2026-09-28T00:00:00Z', headline: 'Deterministic headline',
  queue: [{ rank: 1, playerName: 'Puka Nacua', position: 'WR', team: 'LAR', reason: 'Best WR left' }],
  predictions: [], messages: {}, recap: null, archived: false,
} as unknown as DraftIntelState
const CTX = { leagueId: 'L1', leagueName: 'Test', sport: 'NFL', isDynasty: false, rosterSlots: ['QB', 'WR'], isSuperflex: false } as never

beforeEach(() => {
  vi.clearAllMocks()
  h.agent.mockResolvedValue({ text: 'not json', tokensUsed: 10, model: 'claude-sonnet-4-6' })
})
afterEach(() => vi.unstubAllEnvs())

describe('isDraftIntelAiEnabled', () => {
  it('defaults ON: unset changes nothing', () => {
    expect(isDraftIntelAiEnabled({})).toBe(true)
    expect(isDraftIntelAiEnabled({ DRAFT_INTEL_AI_ENABLED: '' })).toBe(true)
  })
  it.each(['false', '0', 'off', 'no', ' FALSE '])('treats %j as off', (v) => {
    expect(isDraftIntelAiEnabled({ DRAFT_INTEL_AI_ENABLED: v })).toBe(false)
  })
  it.each(['true', '1', 'on', 'yes'])('treats %j as on', (v) => {
    expect(isDraftIntelAiEnabled({ DRAFT_INTEL_AI_ENABLED: v })).toBe(true)
  })
})

describe('the draft-intel AI copy honours the switch', () => {
  it('🛑 off: no model call at all, and the deterministic state comes back unchanged', async () => {
    vi.stubEnv('DRAFT_INTEL_AI_ENABLED', 'false')
    const out = await applyAiLookaheadCopy({ state: STATE, ctx: CTX })
    expect(h.agent).not.toHaveBeenCalled()
    expect(out).toBe(STATE)
  })

  it('[control] on: the model is asked, as before the switch existed', async () => {
    vi.stubEnv('DRAFT_INTEL_AI_ENABLED', '')
    await applyAiLookaheadCopy({ state: STATE, ctx: CTX })
    expect(h.agent).toHaveBeenCalledTimes(1)
  })
})
