// @vitest-environment node
/**
 * "Your card's 51.9% does not match this — I can't reconcile the two" (HailShiva, production
 * 2026-10-06). The 51.9% was yesterday's brief, pasted earlier in the same thread; the card read
 * 65.1%. An earlier turn's figure is a snapshot, whoever wrote it. As in the image-turn and
 * cross-league guards, these assertions are about what the MODEL is told on every path.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ recentChat: vi.fn() }))
vi.mock('@/lib/ai-memory/chat-history-store', () => ({ getRecentChatHistory: mocks.recentChat }))
vi.mock('@/lib/ai-memory', () => ({ getFullAIContext: vi.fn(async () => ({ recentEvents: [], teamSnapshots: [], patterns: [] })), buildMemoryPromptSection: vi.fn(() => '') }))
vi.mock('@/lib/ai-memory/ai-memory-store', () => ({ listAiMemoryByUser: vi.fn(async () => []) }))
vi.mock('@/lib/ai-memory/unified-memory-system', () => ({ buildUnifiedMemoryPromptSection: vi.fn(async () => '') }))

import { CHIMMY_CURRENT_REQUEST_POLICY, EARLIER_FIGURES_RULE, currentRequestFocus } from '@/lib/chimmy/currentRequestFocus'
import { getChimmyMemoryContext } from '@/lib/ai-memory/chimmy-memory-context'

describe('figures in earlier turns are snapshots', () => {
  it('covers a brief or card the USER pasted, not only earlier assistant claims', () => {
    expect(EARLIER_FIGURES_RULE).toMatch(/brief or card the user pasted/)
    expect(EARLIER_FIGURES_RULE).toMatch(/Never present an earlier turn's figure as the user's current card/)
    expect(EARLIER_FIGURES_RULE).toMatch(/never call a difference .* a conflict to reconcile/)
  })

  it('reaches the tool loop (both providers) and the PECR prompt', () => {
    expect(CHIMMY_CURRENT_REQUEST_POLICY).toContain(EARLIER_FIGURES_RULE)
    expect(currentRequestFocus('b739a43d')).toContain(EARLIER_FIGURES_RULE)
    const loop = readFileSync('lib/chimmy/tools/chimmyToolLoop.ts', 'utf8')
    expect(loop.match(/currentRequestFocus\(args\.context\.leagueId\)/g)).toHaveLength(2)
    expect(readFileSync('app/api/chat/chimmy/route.ts', 'utf8')).toMatch(/parts\.push\(CHIMMY_CURRENT_REQUEST_POLICY\)/)
  })

  it('labels the stored RECENT CHAT block as earlier figures, not current ones', async () => {
    mocks.recentChat.mockResolvedValue([{ role: 'user', leagueId: 'b739a43d', meta: null, createdAt: new Date('2026-10-05T21:20:00Z'),
      content: 'Your plan for Tenzy SF (NFL). Period 4: facing Paid in HailShiva. Estimated playoff probability in HailShiva: 51.9%.' }])
    const { promptSection } = await getChimmyMemoryContext({ userId: 'u1', leagueId: 'b739a43d' })
    const block = promptSection.slice(promptSection.indexOf('## RECENT CHAT'))
    expect(block).toMatch(/is as of when it was sent, not current; never present it as the user's current card or odds/)
    // The note precedes the transcript it qualifies.
    expect(block.indexOf('not current')).toBeLessThan(block.indexOf('51.9%'))
  })
})
