import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExplainDeterministicOutput } = vi.hoisted(() => ({ mockExplainDeterministicOutput: vi.fn() }))

vi.mock('@/lib/ai-explanation-layer', () => ({ explainDeterministicOutput: mockExplainDeterministicOutput }))

import { buildCommissionerNarrative } from '@/lib/shared-services/commissioner/CommissionerNarrativeAdapter'
import type { CommissionerBrief } from '@/lib/shared-services/commissioner/types'

function makeBrief(): CommissionerBrief {
  return {
    leagueId: 'league-1',
    week: 5,
    generatedAt: '2026-01-01T00:00:00.000Z',
    sections: [
      { key: 'league_overview', title: 'League Overview', facts: ['Overall status: healthy.', '3 trade(s) recorded.'], evidence: ['Great trades'] },
      { key: 'commissioner_actions', title: 'Commissioner Actions', facts: ['No commissioner actions currently recommended.'], evidence: [] },
    ],
    isHealthy: true,
    confidence: 90,
  }
}

describe('buildCommissionerNarrative', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns deterministic text with aiGenerated:false when useAi is not requested', async () => {
    const result = await buildCommissionerNarrative({ brief: makeBrief(), format: 'full_brief', tone: 'neutral_professional' })
    expect(result.aiGenerated).toBe(false)
    expect(result.text).toContain('League Overview')
    expect(mockExplainDeterministicOutput).not.toHaveBeenCalled()
  })

  it('never fabricates facts — deterministic text is built only from the brief\'s own already-selected facts', async () => {
    const result = await buildCommissionerNarrative({ brief: makeBrief(), format: 'full_brief', tone: 'neutral_professional' })
    expect(result.text).toContain('3 trade(s) recorded')
    expect(result.text).not.toMatch(/collusion|tanking/i)
  })

  it('truncates output to the documented character limit for concise_chat', async () => {
    const result = await buildCommissionerNarrative({ brief: makeBrief(), format: 'concise_chat', tone: 'neutral_professional' })
    expect(result.characterLimit).toBe(280)
    expect(result.characterCount).toBeLessThanOrEqual(280)
  })

  it('has no character limit for full_brief', async () => {
    const result = await buildCommissionerNarrative({ brief: makeBrief(), format: 'full_brief', tone: 'neutral_professional' })
    expect(result.characterLimit).toBeNull()
  })

  it('calls the real explainDeterministicOutput with strict numeric grounding when useAi is true, and reports aiGenerated:true on success', async () => {
    mockExplainDeterministicOutput.mockResolvedValue({ source: 'ai', text: 'Your league is healthy with 3 trades this week.', reason: 'ai_success' })
    const result = await buildCommissionerNarrative({ brief: makeBrief(), format: 'discord', tone: 'playful', useAi: true })

    expect(mockExplainDeterministicOutput).toHaveBeenCalledWith(expect.objectContaining({ strictNumericGrounding: true, feature: 'commissioner_brief_narrative' }))
    expect(result.aiGenerated).toBe(true)
    expect(result.text).toBe('Your league is healthy with 3 trades this week.')
  })

  it('falls back to deterministic text honestly (aiGenerated:false) when the AI call fails to ground', async () => {
    mockExplainDeterministicOutput.mockResolvedValue({ source: 'deterministic', text: 'League Overview:\n- Overall status: healthy.', reason: 'ai_not_grounded' })
    const result = await buildCommissionerNarrative({ brief: makeBrief(), format: 'discord', tone: 'neutral_professional', useAi: true })
    expect(result.aiGenerated).toBe(false)
  })

  it('never lets an AI failure break the deterministic brief entirely — falls back to deterministic text', async () => {
    mockExplainDeterministicOutput.mockRejectedValue(new Error('AI unavailable'))
    const result = await buildCommissionerNarrative({ brief: makeBrief(), format: 'discord', tone: 'neutral_professional', useAi: true })
    expect(result.aiGenerated).toBe(false)
    expect(result.text).toContain('League Overview')
  })
})
