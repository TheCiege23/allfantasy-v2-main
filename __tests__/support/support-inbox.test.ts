// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The support inbox (2026-11-15): a member writes from /help, the owner and admins are alerted, a staff reply
 * reaches the member in the app and by email, and nobody can read anyone else's conversation. A support
 * conversation is a chat thread with no members, so no chat inbox can ever list it.
 */

const m = vi.hoisted(() => {
  type Thread = { id: string; threadType: string; productType: string; title: string | null; createdByUserId: string | null; createdAt: Date; lastMessageAt: Date; members: string[] }
  type Msg = { id: string; threadId: string; senderUserId: string | null; messageType: string; body: string; metadata: unknown; createdAt: Date }
  const state = { threads: [] as Thread[], messages: [] as Msg[], n: 0, clock: 0 }
  const tick = () => new Date(Date.UTC(2026, 10, 15, 12, 0, state.clock++))
  const pick = <T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) =>
    select ? (Object.fromEntries(Object.keys(select).map((k) => [k, row[k]])) as T) : row
  const matches = (t: Thread, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => (t as unknown as Record<string, unknown>)[k] === v)
  const db = {
    platformChatThread: {
      create: vi.fn(async ({ data, select }: { data: Partial<Thread>; select?: Record<string, boolean> }) => {
        const t: Thread = { id: `thread-${++state.n}-xxxxxxxx`, threadType: data.threadType!, productType: data.productType ?? 'shared', title: data.title ?? null, createdByUserId: data.createdByUserId ?? null, createdAt: tick(), lastMessageAt: data.lastMessageAt ?? tick(), members: [] }
        state.threads.push(t)
        return pick(t as never, select)
      }),
      findFirst: vi.fn(async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const t = state.threads.find((x) => matches(x, where))
        return t ? pick(t as never, select) : null
      }),
      findMany: vi.fn(async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) =>
        state.threads.filter((x) => matches(x, where)).sort((a, b) => +b.lastMessageAt - +a.lastMessageAt).map((t) => pick(t as never, select))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Thread> }) => {
        const t = state.threads.find((x) => x.id === where.id)!
        Object.assign(t, data)
        return t
      }),
    },
    platformChatMessage: {
      create: vi.fn(async ({ data, select }: { data: Omit<Msg, 'id' | 'createdAt'>; select?: Record<string, boolean> }) => {
        const msg: Msg = { ...data, id: `msg-${++state.n}`, createdAt: tick() } as Msg
        state.messages.push(msg)
        return pick(msg as never, select)
      }),
      findMany: vi.fn(async ({ where }: { where: { threadId: string } }) => state.messages.filter((x) => x.threadId === where.threadId)),
    },
    appUser: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        ({ 'u-ann': { id: 'u-ann', email: 'ann@example.test', displayName: 'Ann', username: 'ann' }, 'u-ben': { id: 'u-ben', email: null, displayName: null, username: 'ben' } } as Record<string, unknown>)[where.id] ?? null),
      findMany: vi.fn(async () => [{ id: 'u-admin' }]),
    },
  }
  return {
    state,
    db,
    limitOk: { value: true },
    email: vi.fn(async (_input: Record<string, unknown>) => ({ ok: true })),
    dispatch: vi.fn(async (_input: Record<string, unknown>) => ({ delivered: 1, failed: 0 })),
    session: { userId: null as string | null },
    admin: { status: 'admin' as string },
  }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/rate-limit-daily', () => ({ consumeDailyLimit: async () => ({ success: m.limitOk.value, retryAfterSec: 0 }) }))
vi.mock('@/lib/resend-client', () => ({ sendNotificationEmail: m.email }))
vi.mock('@/lib/notifications/notifyOwnerOfNewSignup', () => ({ OWNER_EMAIL: 'owner@example.test' }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: m.dispatch }))
vi.mock('next-auth', () => ({ getServerSession: async () => (m.session.userId ? { user: { id: m.session.userId } } : null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/adminAuth', () => ({
  requireAdmin: async () =>
    m.admin.status === 'admin'
      ? { ok: true, user: { id: 'u-admin' } }
      : { ok: false, res: new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }) },
}))

import {
  cleanPagePath,
  cleanSupportMessage,
  supportStatus,
  supportThreadTitle,
} from '@/lib/support/supportInboxCore'
import {
  getMemberThread,
  listMemberThreads,
  listStaffThreads,
  memberReply,
  openSupportThread,
  setSupportStatus,
  staffReply,
} from '@/lib/support/supportInbox'

beforeEach(() => {
  m.state.threads.length = 0
  m.state.messages.length = 0
  m.limitOk.value = true
  m.email.mockClear()
  m.dispatch.mockClear()
  m.session.userId = null
  m.admin.status = 'admin'
})

describe('the rules', () => {
  it('a message must say something and fit; only a same-site path is kept', () => {
    expect(cleanSupportMessage('  hi \r\nthere ')).toEqual({ ok: true, text: 'hi \nthere' })
    expect(cleanSupportMessage('   ')).toEqual({ ok: false, error: 'empty' })
    expect(cleanSupportMessage('x'.repeat(4001))).toEqual({ ok: false, error: 'too_long' })
    expect(cleanPagePath('/league/lg-1?view=trades')).toBe('/league/lg-1?view=trades')
    expect(cleanPagePath('https://evil.example/x')).toBeUndefined()
    expect(cleanPagePath('//evil.example/x')).toBeUndefined()
  })

  it('status is read from the conversation, and anyone writing reopens a closed one', () => {
    const msg = (from: 'member' | 'staff', event?: string) => ({ metadata: { support: { from, ...(event ? { event } : {}) } } })
    expect(supportStatus([msg('member', 'opened')])).toBe('needs_reply')
    expect(supportStatus([msg('member', 'opened'), msg('staff')])).toBe('answered')
    expect(supportStatus([msg('member', 'opened'), msg('staff'), msg('staff', 'closed')])).toBe('closed')
    expect(supportStatus([msg('member', 'opened'), msg('staff', 'closed'), msg('member')])).toBe('needs_reply')
    expect(supportStatus([msg('member', 'opened'), msg('staff', 'closed'), msg('staff', 'reopened')])).toBe('needs_reply')
  })

  it('the title says what it is about in a line', () => {
    expect(supportThreadTitle('league', 'My Sleeper import is stuck\nmore detail')).toBe('A league or import: My Sleeper import is stuck')
  })
})

describe('the conversation', () => {
  it('a member opens one: it has NO chat members, the owner is emailed and admins get the bell', async () => {
    vi.stubEnv('ADMIN_EMAILS', 'owner@example.test')
    const r = await openSupportThread({ userId: 'u-ann', topic: 'billing', text: 'I was charged twice', pagePath: '/core/settings' })
    expect(r.ok).toBe(true)
    const thread = m.state.threads[0]!
    expect(thread).toMatchObject({ threadType: 'support', createdByUserId: 'u-ann', title: 'Billing and AF Pro: I was charged twice' })
    expect(thread.members).toEqual([])
    await vi.waitFor(() => expect(m.email).toHaveBeenCalled())
    await vi.waitFor(() => expect(m.dispatch).toHaveBeenCalled())
    expect(m.email).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.test', subject: 'Support: Billing and AF Pro from Ann', actionHref: expect.stringContaining('/admin/support?thread=') }))
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({ userIds: ['u-admin'], type: 'support_message', skipChannels: { email: true, sms: true } }))
    vi.unstubAllEnvs()
  })

  it('a staff reply reaches the member, signed as AllFantasy Support, in the app and by email', async () => {
    const r = await openSupportThread({ userId: 'u-ann', topic: 'bug', text: 'The lineup page is blank' })
    if (!r.ok) throw new Error('open failed')
    m.dispatch.mockClear()
    expect(await staffReply({ adminUserId: 'u-admin', threadId: r.threadId, text: 'Fixed — refresh and it is back.' })).toEqual({ ok: true })
    await vi.waitFor(() => expect(m.dispatch).toHaveBeenCalled())
    expect(m.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      userIds: ['u-ann'],
      category: 'system_account',
      type: 'support_reply',
      title: 'AllFantasy Support replied',
      actionHref: `/help?thread=${r.threadId}`,
      skipChannels: { sms: true },
    }))
    const t = await getMemberThread('u-ann', r.threadId)
    expect(t?.status).toBe('answered')
    // The member's own screen says "You"; every staff message is signed the same, never with an admin's name.
    expect(t?.messages?.map((x) => [x.from, x.authorName])).toEqual([['member', 'You'], ['staff', 'AllFantasy Support']])
  })

  it('🛑 nobody reads, or writes into, someone else\'s conversation — it is simply not there', async () => {
    const r = await openSupportThread({ userId: 'u-ann', topic: 'account', text: 'Change my email' })
    if (!r.ok) throw new Error('open failed')
    expect(await getMemberThread('u-ben', r.threadId)).toBeNull()
    expect(await memberReply({ userId: 'u-ben', threadId: r.threadId, text: 'hi' })).toEqual({ ok: false, error: 'not_found' })
    expect(await listMemberThreads('u-ben')).toEqual([])
    expect((await listMemberThreads('u-ann')).map((t) => t.id)).toEqual([r.threadId])
  })

  it('closing and the staff filter', async () => {
    const a = await openSupportThread({ userId: 'u-ann', topic: 'idea', text: 'Dark mode please' })
    const b = await openSupportThread({ userId: 'u-ben', topic: 'other', text: 'Hello' })
    if (!a.ok || !b.ok) throw new Error('open failed')
    await setSupportStatus({ adminUserId: 'u-admin', threadId: a.threadId, to: 'closed' })
    expect((await listStaffThreads({ status: 'closed' })).map((t) => t.id)).toEqual([a.threadId])
    expect((await listStaffThreads({ status: 'needs_reply' })).map((t) => t.id)).toEqual([b.threadId])
    const staffView = (await listStaffThreads({ status: 'all' })).find((t) => t.id === a.threadId)!
    expect(staffView.member).toMatchObject({ name: 'Ann', email: 'ann@example.test' })
    // The member writes again: it reopens.
    await memberReply({ userId: 'u-ann', threadId: a.threadId, text: 'Any update?' })
    expect((await getMemberThread('u-ann', a.threadId))?.status).toBe('needs_reply')
  })

  it('over the daily allowance, a new conversation is refused politely', async () => {
    m.limitOk.value = false
    expect(await openSupportThread({ userId: 'u-ann', topic: 'bug', text: 'x' })).toEqual({ ok: false, error: 'rate_limited' })
    expect(m.state.threads).toEqual([])
  })
})

describe('the routes', () => {
  it('signed out gets 401; a missing topic or message gets 400; a good one 201', async () => {
    const { POST } = await import('@/app/api/support/threads/route')
    const post = (body: unknown) => POST(new Request('https://allfantasy.ai/api/support/threads', { method: 'POST', body: JSON.stringify(body) }))
    expect((await post({ topic: 'bug', message: 'x' })).status).toBe(401)
    m.session.userId = 'u-ann'
    expect((await post({ topic: 'nope', message: 'x' })).status).toBe(400)
    expect((await post({ topic: 'bug', message: '   ' })).status).toBe(400)
    const ok = await post({ topic: 'bug', message: 'Broken', pagePath: 'https://evil.example' })
    expect(ok.status).toBe(201)
    expect(JSON.stringify(m.state.messages[0]!.metadata)).not.toContain('evil')
  })

  it('🛑 the admin inbox refuses anyone who is not an admin', async () => {
    m.admin.status = 'forbidden'
    const { GET } = await import('@/app/api/admin/support/route')
    expect((await GET(new Request('https://allfantasy.ai/api/admin/support'))).status).toBe(403)
    const one = await import('@/app/api/admin/support/[threadId]/route')
    const ctx = { params: Promise.resolve({ threadId: 'thread-1' }) }
    expect((await one.POST(new Request('https://x', { method: 'POST', body: JSON.stringify({ message: 'hi' }) }), ctx)).status).toBe(403)
  })
})


