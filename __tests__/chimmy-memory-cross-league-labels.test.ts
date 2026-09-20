// @vitest-environment node
/**
 * The RECENT CHAT block, now that one transcript spans every league.
 *
 * 🛑 THIS IS A FACT-CONTAMINATION GUARD, NOT A FORMATTING ONE. Chimmy's transcript stopped being
 * per-league on 2026-09-20 (user's decision: one conversation thread). The twelve turns fed into
 * the prompt can therefore be about a DIFFERENT league than the question — and unlabelled, that
 * invites a confident, specific, wrong answer built from the wrong roster. The same shape of
 * failure this repo already paid for in `deterministic.ts`, where an incidental keyword hijacked
 * a cross-league question.
 *
 * So the assertions below are about what the MODEL is told, not about what the DB returned.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ recentChat: vi.fn() }))

vi.mock('@/lib/ai-memory/chat-history-store', () => ({ getRecentChatHistory: mocks.recentChat }))
vi.mock('@/lib/ai-memory', () => ({
  getFullAIContext: vi.fn(async () => ({
    recentEvents: [], teamSnapshots: [], patterns: [],
  })),
  buildMemoryPromptSection: vi.fn(() => ''),
}))
vi.mock('@/lib/ai-memory/ai-memory-store', () => ({ listAiMemoryByUser: vi.fn(async () => []) }))
vi.mock('@/lib/ai-memory/unified-memory-system', () => ({
  buildUnifiedMemoryPromptSection: vi.fn(async () => ''),
}))

import { getChimmyMemoryContext } from '@/lib/ai-memory/chimmy-memory-context'

const turn = (content: string, leagueId: string | null) => ({
  role: 'user', content, createdAt: new Date('2026-09-20T12:00:00Z'), meta: null, leagueId,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.recentChat.mockResolvedValue([])
})

describe('RECENT CHAT — cross-league labelling', () => {
  it('🛑 marks turns from another league, and warns the model not to treat them as facts', async () => {
    mocks.recentChat.mockResolvedValue([
      turn('who should I start in KBFL?', 'kbfl'),
      turn('is my Cream Bowl roster any good?', 'cream-bowl'),
    ])

    const { promptSection } = await getChimmyMemoryContext({ userId: 'u1', leagueId: 'kbfl' })

    expect(promptSection).toContain('[this league]: who should I start in KBFL?')
    expect(promptSection).toContain('[another league]: is my Cream Bowl roster any good?')
    // The instruction is the part that actually changes behaviour.
    expect(promptSection).toContain('never as facts about the league being asked about')
  })

  it('stays silent about leagues when every turn is from the one being asked about', async () => {
    mocks.recentChat.mockResolvedValue([turn('a', 'kbfl'), turn('b', 'kbfl')])

    const { promptSection } = await getChimmyMemoryContext({ userId: 'u1', leagueId: 'kbfl' })

    expect(promptSection).toContain('[this league]')
    expect(promptSection).not.toContain('[another league]')
    // No warning when there is nothing to warn about — noise in every prompt is its own cost.
    expect(promptSection).not.toContain('spans more than one league')
  })

  it('labels a turn asked with no league in scope as such, never as the current one', async () => {
    mocks.recentChat.mockResolvedValue([turn('general question', null)])

    const { promptSection } = await getChimmyMemoryContext({ userId: 'u1', leagueId: 'kbfl' })

    expect(promptSection).toContain('[no league]: general question')
    expect(promptSection).not.toContain('[this league]')
  })

  /*
   * ⚠ WITH NO LEAGUE IN SCOPE, NOTHING IS "THIS LEAGUE". Defaulting to the current one would be
   * wrong in the direction that matters — it would promote another league's turn to authoritative.
   */
  it('treats every league-bearing turn as another league when the question has no league', async () => {
    mocks.recentChat.mockResolvedValue([turn('x', 'kbfl'), turn('y', 'cream-bowl')])

    const { promptSection } = await getChimmyMemoryContext({ userId: 'u1', leagueId: null })

    expect(promptSection).not.toContain('[this league]')
    expect(promptSection).toContain('[another league]: x')
    expect(promptSection).toContain('[another league]: y')
  })

  it('🛑 reads ONE thread for the user, not the league conversation', async () => {
    await getChimmyMemoryContext({ userId: 'u1', leagueId: 'kbfl' })
    expect(mocks.recentChat).toHaveBeenCalledWith({ userId: 'u1', limit: 12 })
    expect(mocks.recentChat.mock.calls[0][0]).not.toHaveProperty('conversationId')
  })

  it('omits the section entirely when there is no history', async () => {
    const { promptSection } = await getChimmyMemoryContext({ userId: 'u1', leagueId: 'kbfl' })
    expect(promptSection).not.toContain('RECENT CHAT')
  })
})
