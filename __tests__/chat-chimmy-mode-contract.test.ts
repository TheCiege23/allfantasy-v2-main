import { describe, expect, it } from 'vitest'

import {
  buildChimmyResponseForAssistantMode,
  normalizeChimmyAssistantMode,
} from '@/lib/chimmy-chat/assistant-mode'

describe('Chimmy assistant mode contract', () => {
  // The default is the FULL answer (user decision 2026-09-23); Fast Take must be asked for.
  it('normalizes missing mode to deep_analysis', () => {
    expect(normalizeChimmyAssistantMode(undefined)).toBe('deep_analysis')
    expect(normalizeChimmyAssistantMode(null)).toBe('deep_analysis')
    expect(normalizeChimmyAssistantMode('')).toBe('deep_analysis')
  })

  it('normalizes invalid mode to deep_analysis', () => {
    expect(normalizeChimmyAssistantMode('invalid_mode')).toBe('deep_analysis')
  })

  it('accepts canonical modes unchanged', () => {
    expect(normalizeChimmyAssistantMode('fast_take')).toBe('fast_take')
    expect(normalizeChimmyAssistantMode('deep_analysis')).toBe('deep_analysis')
    expect(normalizeChimmyAssistantMode('commissioner_view')).toBe('commissioner_view')
    expect(normalizeChimmyAssistantMode('dynasty_lens')).toBe('dynasty_lens')
    expect(normalizeChimmyAssistantMode('dfs_upside')).toBe('dfs_upside')
  })

  it('maps legacy mode words to canonical assistant modes', () => {
    expect(normalizeChimmyAssistantMode('fast strategy')).toBe('fast_take')
    expect(normalizeChimmyAssistantMode('deep dive')).toBe('deep_analysis')
    expect(normalizeChimmyAssistantMode('commish tools')).toBe('commissioner_view')
    expect(normalizeChimmyAssistantMode('dynasty')).toBe('dynasty_lens')
    expect(normalizeChimmyAssistantMode('dfs optimizer')).toBe('dfs_upside')
  })

  it('fast_take response is shorter than deep_analysis for same content', () => {
    const fullResponse = [
      'Start Player A this week based on projected target share and red-zone usage.',
      'Data: 28% target share over the last 3 games, opponent allows 17.2 fantasy points to WRs, and your alternate option has a tougher cornerback matchup.',
      'Action: lock Player A in WR2 and monitor Sunday inactives 90 minutes before kickoff.',
    ].join('\n\n')

    const fastTake = buildChimmyResponseForAssistantMode({
      mode: 'fast_take',
      fullResponse,
      shortAnswer: 'Start Player A this week.',
    })
    const deepAnalysis = buildChimmyResponseForAssistantMode({
      mode: 'deep_analysis',
      fullResponse,
      shortAnswer: 'Start Player A this week.',
    })

    expect(fastTake.length).toBeLessThan(deepAnalysis.length)
    expect(fastTake).toBe('Start Player A this week.')
    expect(deepAnalysis).toBe(fullResponse)
  })
})
