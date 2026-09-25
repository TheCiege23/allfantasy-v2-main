// @vitest-environment node
/**
 * "Is a notification sent out through email or phone to tell the person they got a message?"
 * (owner, 2026-09-25). Before this, NO: a DM or huddle message fired nothing on any channel.
 *
 * BEHAVIOURAL. The throttle state lives in an in-memory SportsDataCache that honours the same
 * create-unique / updateMany-where-expiresAt contract Postgres does, so the claim logic is the
 * real one, and the dispatcher is a spy — its own channel gating is tested elsewhere (and the
 * SMS path end-to-end in sms-twilio-readiness.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  cache: new Map<string, { data: unknown; expiresAt: Date }>(),
  thread: null as null | Record<string, unknown>,
  blocks: [] as Array<{ blockerUserId: string; blockedUserId: string }>,
  unsubscribed: new Set<string>(),
  dispatch: vi.fn(),
  cacheBroken: false,
  leagueMembers: [] as string[],
  profiles: [] as Array<{ userId: string; notificationPreferences: unknown }>,
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
vi.mock('@/lib/get-base-url', () => ({ getBaseUrl: () => 'https://af.test' }))
vi.mock('@/lib/email/marketing-email', () => ({ createEmailUnsubscribeToken: (e: string) => `tok-${e.length}` }))
vi.mock('@/lib/league-chat/leagueMemberIds', () => ({ getLeagueMemberUserIds: async () => h.leagueMembers }))
vi.mock('@/lib/prisma', () => {
  const p2002 = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' })
  return {
    prisma: {
      platformChatThread: { findUnique: async () => h.thread },
      appUser: {
        findUnique: async ({ where }: { where: { id: string } }) =>
          where.id === 'sender'
            ? { displayName: 'dana@example.org', username: 'DanaDynasty' }
            : null,
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, email: `${id}@example.org` })),
      },
      platformBlockedUser: {
        findMany: async ({ where }: { where: { blockedUserId: string; blockerUserId: { in: string[] } } }) =>
          h.blocks.filter((b) => b.blockedUserId === where.blockedUserId && where.blockerUserId.in.includes(b.blockerUserId)),
      },
      emailPreference: {
        findFirst: async ({ where }: { where: { email: { equals: string } } }) =>
          h.unsubscribed.has(where.email.equals) ? { unsubscribedAt: new Date() } : null,
      },
      userProfile: { findMany: async () => h.profiles },
      league: { findUnique: async () => ({ name: 'Pirate League' }) },
      sportsDataCache: {
        findUnique: async ({ where }: { where: { cacheKey: string } }) => {
          if (h.cacheBroken) throw new Error('db down')
          const row = h.cache.get(where.cacheKey)
          return row ? { data: row.data, expiresAt: row.expiresAt } : null
        },
        create: async ({ data }: { data: { cacheKey: string; data: unknown; expiresAt: Date } }) => {
          if (h.cache.has(data.cacheKey)) throw p2002()
          h.cache.set(data.cacheKey, { data: data.data, expiresAt: data.expiresAt })
          return {}
        },
        updateMany: async ({ where, data }: { where: { cacheKey: string; expiresAt: Date }; data: { data: unknown; expiresAt: Date } }) => {
          const row = h.cache.get(where.cacheKey)
          if (!row || row.expiresAt.getTime() !== where.expiresAt.getTime()) return { count: 0 }
          h.cache.set(where.cacheKey, { data: data.data, expiresAt: data.expiresAt })
          return { count: 1 }
        },
      },
    },
  }
})

import {
  notifyDirectMessageRecipients,
  notifyLeagueChatRecipients,
  queueDirectMessageNotifications,
} from '@/lib/chat-notifications/chatMessageNotifier'

const NOW = new Date('2026-09-25T18:00:00Z')
const LONG_AGO = new Date('2026-09-25T12:00:00Z')

function member(userId: string, extra: Record<string, unknown> = {}) {
  return { userId, isMuted: false, isBlocked: false, lastReadAt: LONG_AGO, user: { email: `${userId}@example.org` }, ...extra }
}

function dm(members = [member('sender'), member('bob')]) {
  h.thread = { id: 'thread-1', threadType: 'dm', title: null, members }
}

const send = (over: Partial<Parameters<typeof notifyDirectMessageRecipients>[0]> = {}) =>
  notifyDirectMessageRecipients({
    threadId: 'thread-1',
    messageId: 'msg-1',
    senderUserId: 'sender',
    messageType: 'text',
    body: 'you up for a Kelce trade?',
    createdAt: NOW,
    now: NOW,
    ...over,
  })

beforeEach(() => {
  h.cache.clear()
  h.blocks = []
  h.unsubscribed.clear()
  h.cacheBroken = false
  h.dispatch.mockReset()
  h.dispatch.mockResolvedValue(undefined)
  h.leagueMembers = []
  h.profiles = []
  dm()
})

describe('a DM alerts the other person — bell, push, email, SMS through the dispatcher', () => {
  it('dispatches ONE direct_messages alert to the recipient, never the sender', async () => {
    const r = await send()
    expect(r.recipients).toEqual([{ userId: 'bob', outcome: 'alerted', email: true }])
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    const call = h.dispatch.mock.calls[0][0]
    expect(call).toMatchObject({
      userIds: ['bob'],
      category: 'direct_messages',
      type: 'direct_message',
      body: 'you up for a Kelce trade?',
      actionHref: '/messages?thread=thread-1&message=msg-1',
      severity: 'low',
      meta: expect.objectContaining({ pushTag: 'dm-thread-1', threadId: 'thread-1' }),
    })
    expect(call.userIds).not.toContain('sender')
  })

  it('🛑 the title is the sender — and never their email address', async () => {
    await send()
    const call = h.dispatch.mock.calls[0][0]
    // The sender's display name IS an address in this fixture; the username is used instead.
    expect(call.title).toBe('DanaDynasty')
    expect(JSON.stringify(call)).not.toContain('dana@example.org')
  })

  it('the email is the designed DM template, with the preview and a way to the conversation', async () => {
    await send()
    const call = h.dispatch.mock.calls[0][0]
    expect(call.skipChannels).toBeUndefined()
    expect(call.emailOverride.subject).toBe('DanaDynasty sent you a message')
    expect(call.emailOverride.html).toContain('you up for a Kelce trade?')
    expect(call.emailOverride.html).toContain('https://af.test/messages?thread=thread-1&amp;message=msg-1')
  })

  it('a muted conversation is skipped', async () => {
    dm([member('sender'), member('bob', { isMuted: true })])
    expect((await send()).recipients).toEqual([{ userId: 'bob', outcome: 'muted' }])
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a recipient who blocked the sender is skipped', async () => {
    h.blocks = [{ blockerUserId: 'bob', blockedUserId: 'sender' }]
    expect((await send()).recipients).toEqual([{ userId: 'bob', outcome: 'blocked' }])
    expect(h.dispatch).not.toHaveBeenCalled()
  })

  it('a member blocked inside the thread is skipped', async () => {
    dm([member('sender'), member('bob', { isBlocked: true })])
    expect((await send()).recipients[0].outcome).toBe('blocked')
  })

  it('an AI (Chimmy) thread is not a conversation with anyone else', async () => {
    h.thread = { id: 'thread-1', threadType: 'ai', title: null, members: [member('sender')] }
    expect(await send()).toEqual({ skipped: 'not_a_conversation', recipients: [] })
  })

  it('someone reading the conversation right now is not buzzed', async () => {
    dm([member('sender'), member('bob', { lastReadAt: new Date(NOW.getTime() - 5_000) })])
    expect((await send({ createdAt: new Date(NOW.getTime() - 10_000) })).recipients[0].outcome).toBe('already_read')
    dm([member('sender'), member('bob', { lastReadAt: new Date(NOW.getTime() - 5_000) })])
    expect((await send()).recipients[0].outcome).toBe('viewing')
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})

describe('🛑 a burst is ONE alert, and email is rarer still', () => {
  it('second message 3 minutes later, unread: throttled on every channel', async () => {
    await send()
    const later = new Date(NOW.getTime() + 3 * 60_000)
    const r = await send({ messageId: 'msg-2', createdAt: later, now: later })
    expect(r.recipients[0].outcome).toBe('throttled')
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('after Bob reads it, the next message alerts again — but without a second email inside the hour', async () => {
    await send()
    const readAt = new Date(NOW.getTime() + 2 * 60_000)
    dm([member('sender'), member('bob', { lastReadAt: readAt })])
    const later = new Date(NOW.getTime() + 4 * 60_000)
    const r = await send({ messageId: 'msg-2', createdAt: later, now: later })
    expect(r.recipients[0]).toEqual({ userId: 'bob', outcome: 'alerted', email: false })
    const second = h.dispatch.mock.calls[1][0]
    expect(second.skipChannels).toEqual({ email: true })
    expect(second.emailOverride).toBeUndefined()
  })

  it('two sends racing for one recipient: exactly one alert', async () => {
    const [a, b] = await Promise.all([send(), send({ messageId: 'msg-2' })])
    const outcomes = [a.recipients[0].outcome, b.recipients[0].outcome].sort()
    expect(outcomes).toEqual(['alerted', 'lost_race'])
    expect(h.dispatch).toHaveBeenCalledTimes(1)
  })

  it('an unsubscribed address gets no email, but the bell and push still go', async () => {
    h.unsubscribed.add('bob@example.org')
    await send()
    expect(h.dispatch.mock.calls[0][0].skipChannels).toEqual({ email: true })
  })

  it('a throttle store that is down fails OPEN for the alert and CLOSED for email', async () => {
    h.cacheBroken = true
    const r = await send()
    expect(r.recipients[0]).toEqual({ userId: 'bob', outcome: 'alerted', email: false })
    expect(h.dispatch.mock.calls[0][0].skipChannels).toEqual({ email: true })
  })
})

describe('huddles and media', () => {
  it('a huddle alerts every other member, titled with the huddle', async () => {
    h.thread = {
      id: 'thread-1',
      threadType: 'group',
      title: 'Sunday Crew',
      members: [member('sender'), member('bob'), member('cara')],
    }
    const r = await send({ messageType: 'gif', body: 'https://media.giphy.com/x.gif' })
    expect(r.recipients.map((x) => x.userId).sort()).toEqual(['bob', 'cara'])
    const call = h.dispatch.mock.calls[0][0]
    expect(call.title).toBe('DanaDynasty · Sunday Crew')
    expect(call.body).toBe('sent a GIF')
    expect(call.type).toBe('huddle_message')
  })
})

describe('🛑 the send never pays for a notification', () => {
  it('queueDirectMessageNotifications returns synchronously and swallows a dispatcher that throws', async () => {
    h.dispatch.mockRejectedValue(new Error('provider down'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(queueDirectMessageNotifications({ threadId: 'thread-1', messageId: 'm', senderUserId: 'sender', body: 'x' })).toBeUndefined()
    await new Promise((r) => setTimeout(r, 20))
    expect(h.dispatch).toHaveBeenCalled()
    errors.mockRestore()
  })

  it('a thread lookup that throws never escapes the queue', async () => {
    h.thread = null
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(() => queueDirectMessageNotifications({ threadId: 'nope', messageId: 'm', senderUserId: 'sender' })).not.toThrow()
    await new Promise((r) => setTimeout(r, 10))
    errors.mockRestore()
  })
})

describe('league chat is opt-in', () => {
  it('nobody opted in: no dispatch at all, and no settings profile read per member', async () => {
    h.leagueMembers = ['sender', 'bob', 'cara']
    h.profiles = [
      { userId: 'bob', notificationPreferences: null },
      { userId: 'cara', notificationPreferences: { categories: { chat_mentions: { enabled: true, inApp: true, email: true, sms: false } } } },
    ]
    const r = await notifyLeagueChatRecipients({ leagueId: 'L1', messageId: 'lm1', senderUserId: 'sender', body: 'gm', now: NOW })
    expect(h.dispatch).not.toHaveBeenCalled()
    expect(r.recipients.every((x) => x.outcome === 'not_opted_in')).toBe(true)
  })

  it('a member who switched it on is alerted, scoped to the league', async () => {
    h.leagueMembers = ['sender', 'bob']
    h.profiles = [
      { userId: 'bob', notificationPreferences: { categories: { league_chat: { enabled: true, inApp: true, email: false, sms: false, push: true } } } },
    ]
    await notifyLeagueChatRecipients({ leagueId: 'L1', messageId: 'lm1', senderUserId: 'sender', body: 'gm', now: NOW })
    expect(h.dispatch).toHaveBeenCalledTimes(1)
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({
      userIds: ['bob'],
      category: 'league_chat',
      leagueId: 'L1',
      title: 'DanaDynasty · Pirate League',
      actionHref: '/league/L1',
    })
  })

  it('a tribe or private room is never announced league-wide', async () => {
    h.leagueMembers = ['sender', 'bob']
    const r = await notifyLeagueChatRecipients({ leagueId: 'L1', messageId: 'lm1', senderUserId: 'sender', source: 'tribe:abc', now: NOW })
    expect(r.skipped).toBe('not_main_room')
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
