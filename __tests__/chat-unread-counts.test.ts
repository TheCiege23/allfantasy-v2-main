import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  memberFindMany: vi.fn(),
  msgCount: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    platformChatThreadMember: { findMany: h.memberFindMany },
    platformChatMessage: { count: h.msgCount },
  },
}))

import { getChatUnread } from '@/lib/chat-core/unreadCounts'

const READ_AT = new Date('2026-08-26T10:00:00.000Z')

function membership(over: Record<string, unknown> = {}) {
  return { threadId: 't1', lastReadAt: READ_AT, isMuted: false, ...over }
}

/** The `where` of the Nth count() call. */
function whereOf(n: number) {
  return h.msgCount.mock.calls[n][0].where as Record<string, any>
}

beforeEach(() => {
  vi.clearAllMocks()
  h.memberFindMany.mockResolvedValue([membership()])
  h.msgCount.mockResolvedValue(0)
})

describe('getChatUnread', () => {
  it('is zero for a signed-out visitor without querying', async () => {
    expect(await getChatUnread(null)).toEqual({ total: 0, mentions: 0, mutedUnread: 0 })
    expect(h.memberFindMany).not.toHaveBeenCalled()
  })

  it('is zero for somebody in no threads', async () => {
    h.memberFindMany.mockResolvedValue([])
    expect(await getChatUnread('u1')).toEqual({ total: 0, mentions: 0, mutedUnread: 0 })
  })

  it('counts messages newer than the read watermark', async () => {
    h.msgCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0)

    const out = await getChatUnread('u1')

    expect(out.total).toBe(3)
    expect(whereOf(0).createdAt).toEqual({ gt: READ_AT })
  })

  /* The naive query counts the message you just sent. */
  it('never counts your own messages', async () => {
    h.msgCount.mockResolvedValue(1)
    await getChatUnread('u1')
    expect(whereOf(0).senderUserId).toEqual({ not: 'u1' })
  })

  it('never counts a private message addressed to somebody else', async () => {
    h.msgCount.mockResolvedValue(1)
    await getChatUnread('u1')
    expect(whereOf(0).OR).toEqual([{ isPrivate: false }, { isPrivate: true, visibleToUserId: 'u1' }])
  })

  it('treats a thread never opened as entirely unread', async () => {
    h.memberFindMany.mockResolvedValue([membership({ lastReadAt: null })])
    h.msgCount.mockResolvedValue(2)

    await getChatUnread('u1')

    expect(whereOf(0).createdAt.gt.getTime()).toBe(0)
  })

  /*
   * A mention needs a reply in a way an ordinary message does not; collapsing
   * the two is how a badge becomes noise people clear without reading.
   */
  it('counts mentions separately, as a subset', async () => {
    h.msgCount.mockResolvedValueOnce(5).mockResolvedValueOnce(2)

    const out = await getChatUnread('u1')

    expect(out).toMatchObject({ total: 5, mentions: 2 })
    expect(whereOf(1).mentionedUserIds).toEqual({ has: 'u1' })
  })

  /*
   * A muted thread with unread messages is a real state — not "read" — but it
   * must not light up the launcher.
   */
  it('keeps muted unread out of the badge but still reports it', async () => {
    h.memberFindMany.mockResolvedValue([membership({ isMuted: true })])
    h.msgCount.mockResolvedValue(4)

    const out = await getChatUnread('u1')

    expect(out).toMatchObject({ total: 0, mutedUnread: 4 })
  })

  it('does not even look for mentions in a muted thread', async () => {
    h.memberFindMany.mockResolvedValue([membership({ isMuted: true })])
    h.msgCount.mockResolvedValue(4)

    await getChatUnread('u1')

    expect(h.msgCount).toHaveBeenCalledTimes(1)
  })

  it('adds up across threads', async () => {
    h.memberFindMany.mockResolvedValue([membership(), membership({ threadId: 't2' })])
    h.msgCount
      .mockResolvedValueOnce(2).mockResolvedValueOnce(1)
      .mockResolvedValueOnce(3).mockResolvedValueOnce(0)

    expect(await getChatUnread('u1')).toMatchObject({ total: 5, mentions: 1 })
  })

  it('skips the mention query when a thread has nothing unread', async () => {
    h.msgCount.mockResolvedValue(0)
    await getChatUnread('u1')
    expect(h.msgCount).toHaveBeenCalledTimes(1)
  })

  it('excludes threads you are blocked from', async () => {
    await getChatUnread('u1')
    expect(h.memberFindMany.mock.calls[0][0].where).toMatchObject({ userId: 'u1', isBlocked: false })
  })

  /* A page that failed to render because a badge could not be counted is worse. */
  it('degrades to zero rather than throwing', async () => {
    h.memberFindMany.mockRejectedValue(new Error('db down'))
    expect(await getChatUnread('u1')).toEqual({ total: 0, mentions: 0, mutedUnread: 0 })
  })
})
