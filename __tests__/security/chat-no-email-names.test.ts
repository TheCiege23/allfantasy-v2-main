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
  memberFindMany: vi.fn(),
  memberUpdateMany: vi.fn(),
  messageFindMany: vi.fn(),
  count: vi.fn(),
  leagueFindMany: vi.fn(),
  appUserFindMany: vi.fn(),
  blockFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformChatThreadMember: { findFirst: h.memberFindFirst, findMany: h.memberFindMany, updateMany: h.memberUpdateMany },
    platformChatMessage: { findMany: h.messageFindMany, count: h.count },
    league: { findMany: h.leagueFindMany },
    appUser: { findMany: h.appUserFindMany },
    platformBlockedUser: { findMany: h.blockFindMany },
  },
}))

import { getPlatformThreadById, getPlatformThreadMessages, getThreadMembers } from '@/lib/platform/chat-service'
import { bracketMessagesToPlatform } from '@/lib/chat-core/league-message-proxy'
import { bracketMessageToPlatformShape } from '@/lib/chat-core/ChatCoreService'
import { listLeagueMates } from '@/lib/chat-core/leagueMates'

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
    // The list row's avatar people (2026-09-25): named "Manager", selected without email.
    expect(thread?.context?.members).toEqual([{ id: 'u2', name: 'Manager', avatarUrl: null }])
    const userSelect = h.memberFindFirst.mock.calls[0][0].include.thread.include.members.select.user.select
    expect(userSelect).not.toHaveProperty('email')
    expect(userSelect).toHaveProperty('avatarUrl', true)
  })

  it('🛑 the huddle members sheet selects no email and returns none', async () => {
    h.memberFindFirst.mockResolvedValue({ id: 'mem' })
    h.memberFindMany.mockResolvedValue([
      { userId: 'u2', user: { id: 'u2', username: 'dana', displayName: null, avatarUrl: null, email: EMAIL } },
    ])
    const members = await getThreadMembers('me', 't1')
    expect(JSON.stringify(members)).not.toContain(EMAIL)
    expect(h.memberFindMany.mock.calls[0][0].include.user.select).not.toHaveProperty('email')
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

describe('the DM / huddle people picker (league-mates)', () => {
  it('🛑 selects no email and returns none — a nameless league-mate is shown by handle', async () => {
    h.leagueFindMany.mockResolvedValue([
      { name: 'Dynasty Degens', userId: 'me', redraftMembers: [], rosters: [], teams: [{ claimedByUserId: 'u2' }] },
    ])
    h.blockFindMany.mockResolvedValue([])
    // Even if a widened read handed an email back, it must not reach the answer.
    h.appUserFindMany.mockResolvedValue([{ id: 'u2', username: 'dana', displayName: null, avatarUrl: null, email: EMAIL }])
    const mates = await listLeagueMates('me', '')
    expect(mates).toEqual([{ id: 'u2', displayName: 'dana', username: 'dana', avatarUrl: null, sharedLeagues: ['Dynasty Degens'] }])
    expect(JSON.stringify(mates)).not.toContain(EMAIL)
    expect(h.appUserFindMany.mock.calls[0][0].select).not.toHaveProperty('email')
    expect(h.appUserFindMany.mock.calls[0][0].select).toEqual({ id: true, username: true, displayName: true, avatarUrl: true })
  })
})
