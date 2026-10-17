import { describe, expect, it } from 'vitest'
import {
  CHIMMY_IDENTITY,
  CHIMMY_PROMPT_STYLE_CONFIG,
  buildChimmyPromptStyleBlock,
  getChimmyPromptStyleBlock,
} from '@/lib/chimmy-interface/ChimmyPromptStyleResolver'

describe('ChimmyPromptStyleResolver', () => {
  /* Owner's call 2026-09-24: smart, fun and informational — the AllFantasy brand voice. */
  it('sounds smart, fun and informational — and names what it must never do', () => {
    const block = getChimmyPromptStyleBlock()

    expect(block).toContain('VOICE & TONE (strict)')
    expect(block).toContain('Take it apart: say WHY, not just what.')
    expect(block).toContain('Fun, lightly: one quick line of personality when it fits')
    expect(block).toContain('Show your work: name the data behind each call')
    expect(block).toContain('Jokes about injuries, losses, or anyone\'s bad week.')
    expect(block).toContain('Hype, shouting, or sports-radio drama')
    expect(block).toContain('Open with the call in one sentence.')
    /* The user's own preferences outrank the house style. */
    expect(block).toContain("If the user's saved preferences or their message ask for shorter, more serious or more detailed answers, that wins over this style.")
    expect(block).not.toMatch(/calm, natural, and steady/)
    expect(CHIMMY_IDENTITY).toMatch(/^You are Chimmy, AllFantasy's fantasy sports sidekick/)
  })

  /* Owner's ask 2026-10-10: every recommendation explained on fact and logic. */
  it('makes every recommendation cite its facts, state a confidence, and never fill a gap with a guess', () => {
    const block = getChimmyPromptStyleBlock()
    expect(block).toContain('each evidence bullet names a specific number or fact from a tool result or the context above')
    expect(block).toContain('Never state a number, injury status, score or setting you were not given.')
    expect(block).toContain('Confidence: high | medium | low')
    expect(block).toContain('never fill the gap with an assumption stated as fact')
    // The old wording asked for a guess with no warning attached.
    expect(block).not.toContain('give your best read anyway and name the fact')
  })

  it('builds style block from custom config', () => {
    const block = buildChimmyPromptStyleBlock({
      voiceTraits: ['Calm and concise'],
      avoidTraits: ['Shouting'],
      responseRules: ['Lead with recommendation'],
    })

    expect(block).toContain('Calm and concise')
    expect(block).toContain('Shouting')
    expect(block).toContain('Lead with recommendation')
    expect(CHIMMY_PROMPT_STYLE_CONFIG.responseRules.length).toBeGreaterThan(0)
  })
})
