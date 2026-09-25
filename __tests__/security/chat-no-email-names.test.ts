import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * No chat surface may show a member's email address as their name. DMs, huddles, DM titles and the
 * bracket-pool chat all fell back to the account's email when it had no display name or username,
 * so the other people in the conversation could read it. League chat has its own suite
 * (league-chat-no-email-names.test.ts).
 */

const EMAIL = 'someone.private@example.test'

const h = vi.hoisted(() => ({
  memberFindFirst: vi.fn(),
  memberUpdateMany: vi.fn(),
  messageFindMany: vi.fn(),
  count: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformChatThreadMember: { findFirst: h.memberFindFirst, updateMany: h.memberUpdateMany },
    platformChatMessage: { findMany: h.messageFindMany, count: h.count },
  },
}))

import { getPlatformThreadById, getPlatformThreadMessages } from '@/lib/platform/chat-service'
import { bracketMessagesToPlatform } from '@/lib/chat-core/league-message-proxy'
import { bracketMessageToPlatformShape } from '@/lib/chat-core/ChatCoreService'

function msg(over: Record<string, unknown>) {
  return {
    id: 'm1', threadId: 't1', body: 'hi', messageType: 'text', metadata: null, isPrivate: false,
    visibleToUserId: null, parentMessageId: null, createdAt: new Date('2026-09-25T12:00:00Z'),
    senderUserId: 'u2', sender: null, ...over,
  }
}

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset()
  h.count.mockResolvedValue(0)
  h.memberUpdateMany.mockResolvedValue({ count: 1 })
})

describe('DMs and huddles', () => {
  it('🛑 a sender with no name is "Manager" — never their email — and the email is never selected', async () => {
    h.memberFindFirst.mockResolvedValue({ id: 'mem' })
    h.messageFindMany.mockResolvedValue([
      msg({ id: 'a', sender: { id: 'u2', displayName: null, username: null, email: EMAIL } }),
      msg({ id: 'b', sender: { id: 'u3', displayName: null, username: 'dana', email: EMAIL }, senderUserId: 'u3' }),
      msg({ id: 'c', senderUserId: null, sender: null }),
    ])
    const out = await getPlatformThreadMessages('me', 't1')
    const byId = Object.fromEntries(out.map((m) => [m.id, m.senderName]))
    expect(byId).toEqual({ a: 'Manager', b: 'dana', c: 'System' })
    expect(JSON.stringify(out)).not.toContain(EMAIL)
    expect(h.messageFindMany.mock.calls[0][0].include.sender.select).not.toHaveProperty('email')
  })

  it('🛑 a DM with someone who has no name is titled "Direct message", not their email', async () => {
    h.memberFindFirst.mockResolvedValue({
      id: 'mem',
      userId: 'me',
      lastReadAt: null,
      isMuted: false,
      thread: {
        id: 't1', threadType: 'dm', title: null, createdAt: new Date(), lastMessageAt: new Date(),
        _count: { members: 2 },
        members: [
          { userId: 'me', user: { id: 'me', username: 'me', displayName: 'Me' } },
          { userId: 'u2', user: { id: 'u2', username: null, displayName: null, email: EMAIL } },
        ],
        messages: [],
      },
    })
    const thread = await getPlatformThreadById('me', 't1')
    expect(thread?.title).toBe('Direct message')
    expect(JSON.stringify(thread)).not.toContain(EMAIL)
  })
})

describe('bracket-pool chat and the chat-core shape', () => {
  it('fall back to username, then "Manager"', () => {
    const rows = [
      { id: 'x', message: 'hi', type: 'text', createdAt: '2026-09-25T12:00:00Z', user: { id: 'u2', displayName: null, username: null, email: EMAIL } },
      { id: 'y', message: 'yo', type: 'text', createdAt: '2026-09-25T12:00:00Z', user: { id: 'u3', displayName: null, username: 'kai', email: EMAIL } },
    ]
    const out = bracketMessagesToPlatform(rows as never, 'league:l1')
    expect(out.map((m) => m.senderName)).toEqual(['Manager', 'kai'])
    expect(JSON.stringify(out)).not.toContain(EMAIL)

    const one = bracketMessageToPlatformShape(rows[0] as never, 'league:l1')
    expect(one.senderName).toBe('Manager')
    expect(JSON.stringify(one)).not.toContain(EMAIL)
  })
})
