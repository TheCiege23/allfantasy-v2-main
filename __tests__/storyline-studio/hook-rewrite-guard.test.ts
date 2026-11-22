import { describe, expect, it } from 'vitest'
import { validateHookRewrite } from '@/lib/league-story-creator/StoryFactGuard'
import { hasProfanity } from '@/lib/chat-core/censorProfanity'

const facts = [
  { key: 'leaderTeam', value: 'Hawks' },
  { key: 'trailerTeam', value: 'Gridiron 99' },
  { key: 'leaderWins', value: 5 },
  { key: 'trailerWins', value: 2 },
  { key: 'lastWinnerScore', value: 120.5 },
]

describe('validateHookRewrite', () => {
  it('passes a rewrite that keeps the names and only the facts’ numbers', () => {
    expect(validateHookRewrite('Hawks own Gridiron 99, 5-2 all-time — and that 120.5 still stings!', facts, { hasProfanity }).passed).toBe(true)
  })

  it('refuses a new number, a dropped team, a personal attack, profanity, and a guarantee', () => {
    expect(validateHookRewrite('Hawks lead Gridiron 99 6-2.', facts).passed).toBe(false)
    expect(validateHookRewrite('Hawks lead 5-2.', facts).passed).toBe(false)
    expect(validateHookRewrite('Hawks lead Gridiron 99 5-2, and you are an idiot.', facts).passed).toBe(false)
    expect(validateHookRewrite('Hawks lead Gridiron 99 5-2, his wife agrees.', facts).passed).toBe(false)
    expect(validateHookRewrite('Hawks lead Gridiron 99 5-2, holy shit.', facts, { hasProfanity }).passed).toBe(false)
    expect(validateHookRewrite('Hawks lead Gridiron 99 5-2: a guaranteed win.', facts).passed).toBe(false)
  })
})
