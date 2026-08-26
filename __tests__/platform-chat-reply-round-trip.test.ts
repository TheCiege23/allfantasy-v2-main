import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  memberFindFirst: vi.fn(),
  msgCreate: vi.fn(),
  msgFindMany: vi.fn(),
  threadUpdate: vi.fn(),
  memberUpdateMany: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformChatThreadMember: { findFirst: h.memberFindFirst, updateMany: h.memberUpdateMany },
    platformChatMessage: { create: h.msgCreate, findMany: h.msgFindMany },
    platformChatThread: { update: h.threadUpdate },
    $transaction: h.transaction,
  },
}))

import {
  createPlatformThreadMessage,
  getPlatformThreadMessages,
} from '@/lib/platform/chat-service'

/** The `data` the service handed Prisma on create. */
function created() {
  return h.msgCreate.mock.calls[0][0].data as Record<string, unknown>
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'm1',
    threadId: 't1',
    senderUserId: 'u1',
    messageType: 'text',
    body: 'hello',
    metadata: null,
    createdAt: new Date('2026-08-26T12:00:00Z'),
    isPrivate: false,
    visibleToUserId: null,
    messageSubtype: null,
    parentMessageId: null,
    sender: { id: 'u1', displayName: 'Casey', username: 'casey', email: null, avatarUrl: null, profile: null },
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.memberFindFirst.mockResolvedValue({ id: 'mem1', thread: { id: 't1' } })
  h.msgCreate.mockImplementation(async (args: any) => row(args.data))
  h.threadUpdate.mockResolvedValue({})
  h.memberUpdateMany.mockResolvedValue({})
  h.transaction.mockImplementation(async (fn: any) =>
    fn({
      platformChatMessage: { create: h.msgCreate },
      platformChatThread: { update: h.threadUpdate },
      platformChatThreadMember: { updateMany: h.memberUpdateMany },
    }),
  )
})

describe('replies in DMs and huddles', () => {
  /*
   * `PlatformChatMessage` had no parent column until the 20260826120000
   * migration, which is why quoted replies shipped for league chat only.
   */
  it('stores the parent when one is given', async () => {
    await createPlatformThreadMessage('u1', 't1', 'I disagree', 'text', null, undefined, 'm0')

    expect(created().parentMessageId).toBe('m0')
  })

  it('stores nothing extra for an ordinary message', async () => {
    await createPlatformThreadMessage('u1', 't1', 'hello', 'text', null)

    expect(created().parentMessageId).toBeUndefined()
  })

  it('treats an empty parent as no parent', async () => {
    await createPlatformThreadMessage('u1', 't1', 'hello', 'text', null, undefined, '')

    expect(created().parentMessageId).toBeUndefined()
  })

  /*
   * League chat shipped with the write half working and the read mapper
   * dropping the link, so every reply came back looking ordinary. This is the
   * regression test for not repeating that.
   */
  it('returns the reply link it stored', async () => {
    h.msgFindMany.mockResolvedValue([row({ parentMessageId: 'm0' })])

    const out = await getPlatformThreadMessages('u1', 't1', 50)

    expect(out[0].parentMessageId).toBe('m0')
  })

  it('reports null for a message that answers nothing', async () => {
    h.msgFindMany.mockResolvedValue([row({ parentMessageId: null })])

    const out = await getPlatformThreadMessages('u1', 't1', 50)

    expect(out[0].parentMessageId).toBeNull()
  })

  /* Replies must obey the same privacy rule as everything else in the thread. */
  it('still filters on the private-message rule', async () => {
    h.msgFindMany.mockResolvedValue([])

    await getPlatformThreadMessages('u1', 't1', 50)

    const where = h.msgFindMany.mock.calls[0][0].where
    expect(where.OR).toEqual([{ isPrivate: false }, { isPrivate: true, visibleToUserId: 'u1' }])
  })

  it('keeps a private reply private', async () => {
    await createPlatformThreadMessage(
      'u1', 't1', 'psst', 'text', null,
      { visibleToUserId: 'u1', messageSubtype: 'chimmy_private' },
      'm0',
    )

    expect(created()).toMatchObject({
      parentMessageId: 'm0',
      isPrivate: true,
      visibleToUserId: 'u1',
    })
  })

  it('refuses to write for somebody who is not in the thread', async () => {
    h.memberFindFirst.mockResolvedValue(null)

    expect(await createPlatformThreadMessage('u1', 't1', 'hi', 'text', null, undefined, 'm0')).toBeNull()
    expect(h.msgCreate).not.toHaveBeenCalled()
  })
})
