import { describe, expect, it } from 'vitest'
import {
  getAIToolRegistry,
  getToolRegistration,
  isToolSupported,
  validateToolRequest,
} from '../registry'

describe('ai tool registry', () => {
  it('loads all prompt-124 required tools', () => {
    const keys = new Set(getAIToolRegistry().map((tool) => tool.toolKey))
    const required = [
      'trade_analyzer',
      'waiver_ai',
      'draft_helper',
      'matchup',
      'rankings',
      'story_creator',
      'ai_commissioner',
      'fantasy_coach',
      'content',
      'blog_generator',
      'social_clip_generator',
      'chimmy_chat',
    ]
    for (const key of required) {
      expect(keys.has(key)).toBe(true)
    }
  })

  it('resolves canonical aliases for prompt naming', () => {
    expect(getToolRegistration('Trade Analyzer')?.toolKey).toBe('trade_analyzer')
    expect(getToolRegistration('Waiver Wire AI')?.toolKey).toBe('waiver_ai')
    expect(getToolRegistration('Matchup Explainer')?.toolKey).toBe('matchup')
    expect(getToolRegistration('League Rankings Explainer')?.toolKey).toBe('rankings')
    expect(getToolRegistration('AI Commissioner')?.toolKey).toBe('ai_commissioner')
    expect(getToolRegistration('Fantasy Coach Mode')?.toolKey).toBe('fantasy_coach')
    expect(getToolRegistration('Content Generator')?.toolKey).toBe('content')
    expect(getToolRegistration('Blog Generator')?.toolKey).toBe('blog_generator')
    expect(getToolRegistration('Social Clip Generator')?.toolKey).toBe('social_clip_generator')
    expect(getToolRegistration('Chimmy Chat')?.toolKey).toBe('chimmy_chat')
  })

  it('returns unsupported tool errors cleanly', () => {
    expect(isToolSupported('nonexistent_tool')).toBe(false)
    const validation = validateToolRequest('nonexistent_tool', {})
    expect(validation.valid).toBe(false)
    expect(validation.error).toMatch(/Unsupported tool/)
  })

  it('accepts required leagueSettings from request-level field', () => {
    const validation = validateToolRequest(
      'waiver_ai',
      {
        candidates: [{ playerId: 'p1' }],
      },
      {
        leagueSettings: { scoring: { ppr: 1 } },
        sport: 'NFL',
      }
    )
    expect(validation.valid).toBe(true)
  })
})

