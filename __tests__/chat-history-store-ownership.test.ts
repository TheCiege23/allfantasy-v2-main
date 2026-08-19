// @vitest-environment node
/**
 * lib/ai-memory/chat-history-store.ts — ownership fix. `conversationId` is caller-suppliable
 * from three live routes (app/api/chat/chimmy, app/api/ai/chimmy, app/api/chimmy alias), so
 * without a userId check a guessed/known conversationId let one user read another user's real
 * chat history and write into their conversation record. Uses a real, filtering in-memory fake
 * for `$queryRaw`/`$executeRaw`/`chatConversation` (not just call-argument assertions) so the
 * actual scoping logic is genuinely exercised.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

type ChatHistoryRow = {
  id: string
  conversationId: string
  userId: string | null
  leagueId: string | null
  role: string
  content: string
  createdAt: Date
}
type ChatConversationRow = { id: string; userId: string; messageCount: number; lastMessageAt: Date }

const { store, prismaMock } = vi.hoisted(() => {
  const store = {
    chatHistory: [] as ChatHistoryRow[],
    chatConversations: new Map<string, ChatConversationRow>(),
  }

  const prismaMock = {
    $executeRaw: vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
      const [id, conversationId, userId, leagueId, role, content] = values as [
        string,
        string,
        string | null,
        string | null,
        string,
        string,
        unknown,
      ]
      store.chatHistory.push({
        id,
        conversationId,
        userId,
        leagueId,
        role,
        content,
        createdAt: new Date(Date.now() + store.chatHistory.length), // stable increasing order
      })
    }),
    // Deliberately SQL-text-sensitive, not just argument-sensitive: if the real query stops
    // filtering by "userId" (a regression reintroducing the vulnerability), this mock stops
    // applying that filter too, so a seeded regression is actually caught by these tests rather
    // than being masked by a mock that always assumes the fixed behavior.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?')
      // Genuinely SQL-text-sensitive: only apply the userId match if the real query's WHERE
      // clause actually compares "userId" to a value — a regression that stops doing that (even
      // while still interpolating userId somewhere, e.g. a stray non-equality reference) is
      // caught, not masked by a mock that always assumes the fixed behavior. conversationId and
      // limit stay in their fixed interpolation positions regardless.
      const filtersUserId = /"userId"\s*=\s*\?/.test(sql)
      const [conversationId, userId, limit] = values as [string, string, number]
      return store.chatHistory
        .filter((r) => r.conversationId === conversationId && (!filtersUserId || r.userId === userId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit)
    }),
    chatConversation: {
      findUnique: vi.fn(async ({ where, select }: any) => {
        const conv = store.chatConversations.get(where.id)
        if (!conv) return null
        if (select) {
          const result: Record<string, unknown> = {}
          for (const key of Object.keys(select)) result[key] = (conv as any)[key]
          return result
        }
        return conv
      }),
      create: vi.fn(async ({ data }: any) => {
        const row: ChatConversationRow = { id: data.id, userId: data.userId, messageCount: data.messageCount, lastMessageAt: data.lastMessageAt }
        store.chatConversations.set(data.id, row)
        return row
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = store.chatConversations.get(where.id)!
        const updated = { ...existing, ...data }
        store.chatConversations.set(where.id, updated)
        return updated
      }),
    },
  }

  return { store, prismaMock }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { appendChatHistory, getRecentChatHistory } from '@/lib/ai-memory/chat-history-store'

beforeEach(() => {
  vi.clearAllMocks()
  store.chatHistory.length = 0
  store.chatConversations.clear()
})

describe('appendChatHistory — ownership on write', () => {
  it("stamps chat_history rows with the caller's own userId and creates a fresh chat_conversations row", async () => {
    await appendChatHistory({ conversationId: 'conv-1', role: 'user', content: 'hello', userId: 'user-a', leagueId: null })

    expect(store.chatHistory).toHaveLength(1)
    expect(store.chatHistory[0].userId).toBe('user-a')
    expect(store.chatConversations.get('conv-1')).toMatchObject({ userId: 'user-a', messageCount: 1 })
  })

  it('lets the true owner keep appending to their own conversation, incrementing messageCount', async () => {
    await appendChatHistory({ conversationId: 'conv-1', role: 'user', content: 'first', userId: 'user-a', leagueId: null })
    await appendChatHistory({ conversationId: 'conv-1', role: 'assistant', content: 'reply', userId: 'user-a', leagueId: null })

    expect(store.chatHistory).toHaveLength(2)
    expect(store.chatConversations.get('conv-1')?.messageCount).toBe(2)
  })

  it("refuses to append into a conversation ID owned by a different user — the vulnerability this test guards against", async () => {
    // Victim's conversation already exists.
    await appendChatHistory({ conversationId: 'victim-conv', role: 'user', content: 'victim message', userId: 'victim-user', leagueId: null })
    expect(store.chatHistory).toHaveLength(1)

    // Attacker guesses/reuses the victim's conversationId.
    await appendChatHistory({ conversationId: 'victim-conv', role: 'user', content: 'attacker injected message', userId: 'attacker-user', leagueId: null })

    // No new row was written, and the victim's conversation record is untouched.
    expect(store.chatHistory).toHaveLength(1)
    expect(store.chatHistory[0].content).toBe('victim message')
    expect(store.chatConversations.get('victim-conv')).toMatchObject({ userId: 'victim-user', messageCount: 1 })
  })
})

describe('getRecentChatHistory — ownership on read', () => {
  it("returns the caller's own conversation history when they are the actual owner", async () => {
    await appendChatHistory({ conversationId: 'conv-1', role: 'user', content: 'my message', userId: 'user-a', leagueId: null })
    await appendChatHistory({ conversationId: 'conv-1', role: 'assistant', content: 'my reply', userId: 'user-a', leagueId: null })

    const history = await getRecentChatHistory('conv-1', 12, 'user-a')
    expect(history.map((m) => m.content)).toEqual(['my message', 'my reply'])
  })

  it("returns empty for a conversationId that belongs to a different user — the vulnerability this test guards against", async () => {
    await appendChatHistory({ conversationId: 'victim-conv', role: 'user', content: 'victim private message', userId: 'victim-user', leagueId: null })
    await appendChatHistory({ conversationId: 'victim-conv', role: 'assistant', content: 'victim private reply', userId: 'victim-user', leagueId: null })

    // Attacker knows or guesses the victim's conversationId and requests it as themselves.
    const history = await getRecentChatHistory('victim-conv', 12, 'attacker-user')
    expect(history).toEqual([])
  })

  it('returns empty when no userId is provided at all (fail closed, not open)', async () => {
    await appendChatHistory({ conversationId: 'conv-1', role: 'user', content: 'my message', userId: 'user-a', leagueId: null })

    // @ts-expect-error — deliberately calling without userId to confirm the fail-closed guard
    const history = await getRecentChatHistory('conv-1', 12)
    expect(history).toEqual([])
  })

  it('returns empty for an unknown conversationId rather than erroring', async () => {
    const history = await getRecentChatHistory('nobody-has-this-conversation', 12, 'user-a')
    expect(history).toEqual([])
  })
})
