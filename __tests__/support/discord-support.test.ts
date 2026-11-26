// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Discord as the support channel (owner's call, 2026-11-25): members post in the AllFantasy server's
 * support channel; each person's messages become one conversation in the support inbox, which emails the
 * owner and pushes to admins' phones; a staff reply goes back into the channel, mentioning the person.
 */

const m = vi.hoisted(() => {
  type Thread = { id: string; threadType: string; productType: string; title: string | null; createdByUserId: string | null; createdAt: Date; lastMessageAt: Date }
  type Msg = { id: string; threadId: string; senderUserId: string | null; messageType: string; body: string; metadata: unknown; createdAt: Date }
  const state = { threads: [] as Thread[], messages: [] as Msg[], n: 0, clock: 0, cache: new Map<string, unknown>() }
  const tick = () => new Date(Date.UTC(2026, 10, 25, 12, 0, state.clock++))
  const pick = <T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) =>
    select ? (Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) as T) : row
  const at = (obj: unknown, path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj)
  const db = {
    platformChatThread: {
      create: vi.fn(async ({ data, select }: { data: Partial<Thread>; select?: Record<string, boolean> }) => {
        const t: Thread = { id: `thread-${++state.n}`, threadType: data.threadType!, productType: 'shared', title: data.title ?? null, createdByUserId: data.createdByUserId ?? null, createdAt: tick(), lastMessageAt: data.lastMessageAt! }
        state.threads.push(t)
        return pick(t as never, select)
      }),
      findFirst: vi.fn(async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const t = state.threads.find((x) => Object.entries(where).every(([k, v]) => (x as unknown as Record<string, unknown>)[k] === v))
        return t ? pick(t as never, select) : null
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Thread> }) => Object.assign(state.threads.find((x) => x.id === where.id)!, data)),
    },
    platformChatMessage: {
      create: vi.fn(async ({ data, select }: { data: Omit<Msg, 'id' | 'createdAt'>; select?: Record<string, boolean> }) => {
        const msg = { ...data, id: `msg-${++state.n}`, createdAt: tick() } as Msg
        state.messages.push(msg)
        return pick(msg as never, select)
      }),
      findMany: vi.fn(async ({ where }: { where: { threadId: string } }) => state.messages.filter((x) => x.threadId === where.threadId)),
      // Only the JSON-path form this feature uses: metadata.path equals value; newest first when ordered.
      findFirst: vi.fn(async ({ where, orderBy }: { where: { metadata: { path: string[]; equals: string } }; orderBy?: unknown }) => {
        const hits = state.messages.filter((x) => at(x.metadata, where.metadata.path) === where.metadata.equals)
        const row = orderBy ? hits[hits.length - 1] : hits[0]
        return row ? { id: row.id, threadId: row.threadId } : null
      }),
    },
    appUser: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === 'u-ann' ? { id: 'u-ann', email: 'ann@example.test', displayName: 'Ann', username: 'ann' } : null),
      findMany: vi.fn(async () => [{ id: 'u-admin' }]),
    },
    authAccount: {
      findUnique: vi.fn(async ({ where }: { where: { provider_providerAccountId: { providerAccountId: string } } }) =>
        where.provider_providerAccountId.providerAccountId === '2002' ? { userId: 'u-ann' } : null),
    },
    sportsDataCache: {
      findUnique: vi.fn(async ({ where }: { where: { cacheKey: string } }) => (state.cache.has(where.cacheKey) ? { data: state.cache.get(where.cacheKey) } : null)),
      upsert: vi.fn(async ({ where, update }: { where: { cacheKey: string }; update: { data: unknown } }) => {
        state.cache.set(where.cacheKey, update.data)
        return {}
      }),
    },
  }
  return {
    state,
    db,
    limitOk: { value: true },
    email: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true })),
    dispatch: vi.fn(async (_input: Record<string, unknown>) => ({ delivered: 1, failed: 0 })),
    channel: [] as Array<Record<string, unknown>>,
    reply: vi.fn(async (_channelId: string, _content: string, _opts: { replyToMessageId: string; mentionUserId: string }) => 'posted-1'),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: async () => ({ success: m.limitOk.value, retryAfterSec: 0 }) }))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: m.email }))
vi.mock('@/lib/notifications/notifyOwnerOfNewSignup', () => ({ OWNER_EMAIL: 'owner@example.test' }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))
vi.mock('@/lib/discord/bot', () => ({
  isBotConfigured: () => true,
  getBotUserId: async () => '9999',
  postReplyMentioning: m.reply,
  // Discord returns newest first; `after` filters by snowflake.
  fetchChannelMessages: async (_channelId: string, q: { after?: string; limit?: number }) =>
    [...m.channel]
      .filter((x) => !q.after || BigInt(x.id as string) > BigInt(q.after))
      .sort((a, b) => (BigInt(a.id as string) < BigInt(b.id as string) ? -1 : 1))
      .slice(0, q.limit ?? 10)
      .reverse(),
}))

import {
  discordSupportChannelId,
  discordSupportText,
  isMemberSupportMessage,
  supportReplyText,
} from '@/lib/support/discordSupportCore'
import { getStaffThread, recordDiscordSupportMessage, setSupportStatus, staffReply } from '@/lib/support/supportInbox'
import { runDiscordSupportPass, DISCORD_SUPPORT_CURSOR_KEY } from '@/lib/support/discordSupport'

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
}
const ref = (messageId: string, userId = '1001', username = 'hoopsfan') => ({ userId, username, messageId, channelId: '5555555555555555' })

beforeEach(() => {
  m.state.threads = []
  m.state.messages = []
  m.state.cache = new Map()
  m.channel = []
  m.limitOk.value = true
  m.email.mockClear()
  m.dispatch.mockClear()
  m.reply.mockClear()
})

describe('the rules', () => {
  it('reads the channel id only when it looks like a Discord id', () => {
    expect(discordSupportChannelId({ DISCORD_SUPPORT_CHANNEL_ID: ' 1234567890123456789 ' })).toBe('1234567890123456789')
    expect(discordSupportChannelId({ DISCORD_SUPPORT_CHANNEL_ID: 'support' })).toBeNull()
    expect(discordSupportChannelId({})).toBeNull()
  })

  it('takes people, not bots, us or system messages, and nothing empty', () => {
    const person = { id: '1', content: 'help', author: { id: '1001', username: 'a' }, type: 0 }
    expect(isMemberSupportMessage(person, '9999')).toBe(true)
    expect(isMemberSupportMessage({ ...person, type: 19 }, '9999')).toBe(true) // a reply
    expect(isMemberSupportMessage({ ...person, author: { id: '9999' } }, '9999')).toBe(false) // our own
    expect(isMemberSupportMessage({ ...person, author: { id: '77', bot: true } }, '9999')).toBe(false)
    expect(isMemberSupportMessage({ ...person, type: 7 }, '9999')).toBe(false) // someone joined
    expect(isMemberSupportMessage({ ...person, content: '   ' }, '9999')).toBe(false)
  })

  it('keeps a screenshot a member attached', () => {
    expect(discordSupportText({ id: '1', content: 'see this', attachments: [{ url: 'https://cdn.discordapp.com/x.png' }, { url: 'javascript:bad' }] }))
      .toBe('see this\nAttachment: https://cdn.discordapp.com/x.png')
    expect(discordSupportText({ id: '1', content: '', attachments: [{ url: 'https://cdn.discordapp.com/x.png' }] })).toBe('Attachment: https://cdn.discordapp.com/x.png')
  })

  it("fits a long reply in one Discord message (2,000 characters) with the mention", () => {
    const text = supportReplyText('1001', 'x'.repeat(5000))
    expect(text.startsWith('<@1001> ')).toBe(true)
    expect(text.length).toBe(2000)
  })
})

describe('recordDiscordSupportMessage', () => {
  it('opens a conversation, alerts the owner by email and admins in the app, named as Discord names them', async () => {
    // Admin accounts are the verified ADMIN_EMAILS addresses; the bell and phone push go to them.
    process.env.ADMIN_EMAILS = 'admin@example.test'
    const r = await recordDiscordSupportMessage({ discord: ref('100'), displayName: 'Hoops Fan', linkedUserId: null, text: 'My draft froze' })
    await flush()
    expect(r).toMatchObject({ ok: true, opened: true })
    expect(m.state.threads[0]).toMatchObject({ threadType: 'support', createdByUserId: null })
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.test', subject: 'Support: Something else from Hoops Fan (Discord)' }))
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['u-admin'], type: 'support_message' }))
    const view = await getStaffThread(m.state.threads[0]!.id)
    expect(view).toMatchObject({ via: 'discord', status: 'needs_reply', member: { name: 'hoopsfan (Discord)', email: null } })
  })

  it("puts a person's next message in the same conversation, and ignores the same message twice", async () => {
    const first = await recordDiscordSupportMessage({ discord: ref('100'), displayName: 'Hoops Fan', linkedUserId: null, text: 'one' })
    const second = await recordDiscordSupportMessage({ discord: ref('101'), displayName: 'Hoops Fan', linkedUserId: null, text: 'two' })
    const again = await recordDiscordSupportMessage({ discord: ref('101'), displayName: 'Hoops Fan', linkedUserId: null, text: 'two' })
    expect(second).toMatchObject({ ok: true, opened: false, threadId: (first as { threadId: string }).threadId })
    expect(again).toEqual({ ok: false, error: 'duplicate' })
    expect(m.state.threads).toHaveLength(1)
    expect(m.state.messages).toHaveLength(2)
  })

  it('starts a new conversation after the last one was closed', async () => {
    const first = (await recordDiscordSupportMessage({ discord: ref('100'), displayName: 'H', linkedUserId: null, text: 'one' })) as { threadId: string }
    await setSupportStatus({ adminUserId: 'u-admin', threadId: first.threadId, to: 'closed' })
    const next = await recordDiscordSupportMessage({ discord: ref('102'), displayName: 'H', linkedUserId: null, text: 'new problem' })
    expect(next).toMatchObject({ ok: true, opened: true })
    expect(m.state.threads).toHaveLength(2)
  })

  it('gives the conversation to a linked AllFantasy account, so it shows in their Help too', async () => {
    await recordDiscordSupportMessage({ discord: ref('100', '2002', 'ann_d'), displayName: 'Ann', linkedUserId: 'u-ann', text: 'billing?' })
    expect(m.state.threads[0]!.createdByUserId).toBe('u-ann')
    expect((await getStaffThread(m.state.threads[0]!.id))?.member).toMatchObject({ userId: 'u-ann', name: 'Ann' })
  })

  it('stops a flood from one person', async () => {
    m.limitOk.value = false
    expect(await recordDiscordSupportMessage({ discord: ref('100'), displayName: 'H', linkedUserId: null, text: 'spam' })).toEqual({ ok: false, error: 'rate_limited' })
    expect(m.state.threads).toHaveLength(0)
  })
})

describe('a staff reply', () => {
  it("goes back to Discord as a reply to the person's latest message, mentioning only them", async () => {
    const r = (await recordDiscordSupportMessage({ discord: ref('100'), displayName: 'H', linkedUserId: null, text: 'one' })) as { threadId: string }
    await recordDiscordSupportMessage({ discord: ref('101'), displayName: 'H', linkedUserId: null, text: 'two' })
    await staffReply({ adminUserId: 'u-admin', threadId: r.threadId, text: 'Fixed, try again.' })
    await flush()
    expect(m.reply).toHaveBeenCalledWith('5555555555555555', '<@1001> Fixed, try again.', { replyToMessageId: '101', mentionUserId: '1001' })
  })

  it('posts nothing to Discord for a conversation started in the app', async () => {
    const thread = await m.db.platformChatThread.create({ data: { threadType: 'support', title: 'x', createdByUserId: 'u-ann', lastMessageAt: new Date() } })
    await m.db.platformChatMessage.create({ data: { threadId: (thread as { id: string }).id, senderUserId: 'u-ann', messageType: 'text', body: 'hi', metadata: { support: { from: 'member', event: 'opened', topic: 'other' } } } })
    await staffReply({ adminUserId: 'u-admin', threadId: (thread as { id: string }).id, text: 'hello' })
    await flush()
    expect(m.reply).not.toHaveBeenCalled()
  })
})

describe('runDiscordSupportPass', () => {
  const env = process.env
  beforeEach(() => {
    process.env = { ...env, DISCORD_SUPPORT_CHANNEL_ID: '5555555555555555' }
  })

  it('does nothing until the channel is set', async () => {
    process.env = { ...env, DISCORD_SUPPORT_CHANNEL_ID: '' }
    expect(await runDiscordSupportPass({ budgetMs: 1000 })).toMatchObject({ configured: false, read: 0 })
  })

  it('on its first run only records where the channel is, so old messages are never imported', async () => {
    m.channel = [{ id: '10', content: 'old question', author: { id: '1001', username: 'h' }, type: 0 }]
    expect(await runDiscordSupportPass({ budgetMs: 1000 })).toMatchObject({ configured: true, read: 0, recorded: 0 })
    expect(m.state.cache.get(DISCORD_SUPPORT_CURSOR_KEY)).toEqual({ messageId: '10' })
    expect(m.state.threads).toHaveLength(0)
  })

  it('reads new messages oldest first, skips bots and system lines, acknowledges a new conversation once', async () => {
    m.state.cache.set(DISCORD_SUPPORT_CURSOR_KEY, { messageId: '10' })
    m.channel = [
      { id: '10', content: 'old', author: { id: '1001', username: 'h' }, type: 0 },
      { id: '11', content: 'my lineup will not save', author: { id: '1001', username: 'hoopsfan' }, type: 0 },
      { id: '12', content: 'Got it.', author: { id: '9999', username: 'AllFantasy' }, type: 0 },
      { id: '13', content: '', author: { id: '3003', username: 'newbie' }, type: 7 },
      { id: '14', content: 'it is the PG slot', author: { id: '1001', username: 'hoopsfan' }, type: 19 },
    ]
    const report = await runDiscordSupportPass({ budgetMs: 5000 })
    expect(report).toMatchObject({ configured: true, read: 4, recorded: 2, opened: 1, skipped: 2, errors: 0 })
    expect(m.state.threads).toHaveLength(1)
    expect(m.state.messages.map((x) => x.body)).toEqual(['my lineup will not save', 'it is the PG slot'])
    expect(m.reply).toHaveBeenCalledTimes(1)
    expect(m.reply.mock.calls[0]![2]).toEqual({ replyToMessageId: '11', mentionUserId: '1001' })
    expect(m.state.cache.get(DISCORD_SUPPORT_CURSOR_KEY)).toEqual({ messageId: '14' })

    // Next minute: nothing new, nothing read twice.
    expect(await runDiscordSupportPass({ budgetMs: 5000 })).toMatchObject({ read: 0, recorded: 0 })
  })

  it('reads more than one page when a busy channel has more than ten new messages', async () => {
    m.state.cache.set(DISCORD_SUPPORT_CURSOR_KEY, { messageId: '100' })
    m.channel = Array.from({ length: 23 }, (_, i) => ({ id: String(101 + i), content: `q${i}`, author: { id: String(5000 + i), username: `u${i}` }, type: 0 }))
    const report = await runDiscordSupportPass({ budgetMs: 5000 })
    expect(report).toMatchObject({ read: 23, recorded: 23, opened: 23 })
    expect(m.state.cache.get(DISCORD_SUPPORT_CURSOR_KEY)).toEqual({ messageId: '123' })
  })
})
