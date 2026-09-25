import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * E2 (hands-on chat test, 2026-09-25): both chat readers answered a DATABASE ERROR with `[]`, which
 * every caller rendered as an empty conversation. The readers keep that default for their older
 * callers (Chimmy's prompt memory, the pin board) — a prompt is better with no memory than with no
 * answer — but the surfaces that SHOW a conversation now ask for the failure to be reported, via
 * `throwOnError`, and turn it into a 5xx.
 *
 * Genuinely empty stays `[]` in both modes: no rows, and not a member, are answers, not failures.
 */

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  memberFindFirst: vi.fn(),
  memberUpdateMany: vi.fn(),
  msgFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: h.queryRaw,
    platformChatThreadMember: { findFirst: h.memberFindFirst, updateMany: h.memberUpdateMany },
    platformChatMessage: { findMany: h.msgFindMany },
  },
}))

import { getRecentChatHistory } from '@/lib/ai-memory/chat-history-store'
import { getPlatformThreadMessages } from '@/lib/platform/chat-service'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  h.memberFindFirst.mockResolvedValue({ id: 'mem1' })
  h.memberUpdateMany.mockResolvedValue({})
  h.msgFindMany.mockResolvedValue([])
})

describe('getRecentChatHistory', () => {
  it('reports a failed read when asked to', async () => {
    h.queryRaw.mockRejectedValueOnce(new Error('connection refused'))
    await expect(getRecentChatHistory({ userId: 'u1', limit: 12, throwOnError: true })).rejects.toThrow()
  })

  it('keeps answering [] on failure for callers that did not ask (Chimmy prompt memory)', async () => {
    h.queryRaw.mockRejectedValueOnce(new Error('connection refused'))
    await expect(getRecentChatHistory({ userId: 'u1', limit: 12 })).resolves.toEqual([])
  })

  it('an empty table is [] in both modes', async () => {
    h.queryRaw.mockResolvedValue([])
    await expect(getRecentChatHistory({ userId: 'u1', limit: 12, throwOnError: true })).resolves.toEqual([])
  })
})

describe('getPlatformThreadMessages', () => {
  it('reports a failed message read when asked to', async () => {
    h.msgFindMany.mockRejectedValueOnce(new Error('connection refused'))
    await expect(getPlatformThreadMessages('u1', 't1', 50, { throwOnError: true })).rejects.toThrow()
  })

  it('reports a failed membership read when asked to', async () => {
    h.memberFindFirst.mockRejectedValueOnce(new Error('connection refused'))
    await expect(getPlatformThreadMessages('u1', 't1', 50, { throwOnError: true })).rejects.toThrow()
  })

  it('keeps answering [] on failure for callers that did not ask (the pin board)', async () => {
    h.msgFindMany.mockRejectedValueOnce(new Error('connection refused'))
    await expect(getPlatformThreadMessages('u1', 't1', 50)).resolves.toEqual([])
  })

  it('a thread with no messages, and a thread you are not in, are [] — not errors', async () => {
    await expect(getPlatformThreadMessages('u1', 't1', 50, { throwOnError: true })).resolves.toEqual([])
    h.memberFindFirst.mockResolvedValueOnce(null)
    await expect(getPlatformThreadMessages('u1', 't1', 50, { throwOnError: true })).resolves.toEqual([])
  })

  it('a failed "mark as read" write does not hide the messages that were read', async () => {
    h.msgFindMany.mockResolvedValueOnce([
      { id: 'm1', senderUserId: 'u2', body: 'you up?', messageType: 'text', metadata: null, createdAt: new Date(), sender: null },
    ])
    h.memberUpdateMany.mockRejectedValueOnce(new Error('write timeout'))
    const out = await getPlatformThreadMessages('u1', 't1', 50, { throwOnError: true })
    expect(out.map((m) => m.body)).toEqual(['you up?'])
  })
})
