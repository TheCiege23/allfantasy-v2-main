// @vitest-environment node
/**
 * The admin moderation queue for reports from the two draft chats. Reporting them is new
 * (draft-and-mock-chat-report.test.ts); a report nobody can READ or ACT ON would make the Terms'
 * "reviewed within 24 hours" untrue. So the queue must show the message, and Remove must blank it.
 * Neither table has a metadata column: the text is the deletion mark.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  platformMessageReport: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  leagueChatMessage: { findFirst: vi.fn(), update: vi.fn() },
  bracketLeagueMessage: { findFirst: vi.fn(), update: vi.fn() },
  platformChatMessage: { findFirst: vi.fn(), update: vi.fn() },
  draftRoomChatMessage: { findFirst: vi.fn(), update: vi.fn() },
  mockDraftChat: { findFirst: vi.fn(), update: vi.fn() },
  appUser: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import { listReportsForReview, reviewReport } from '@/lib/moderation/AdminReportReview'

const T = new Date('2026-09-29T02:00:00.000Z')
const report = (threadId: string) => ({
  id: 'r-1', messageId: 'm-1', threadId, reporterUserId: 'u-rep', reason: 'harassment', status: 'pending', createdAt: T,
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.appUser.findMany.mockResolvedValue([{ id: 'u-rep', username: 'reporter' }, { id: 'u-sam', username: 'sam' }])
  prismaMock.platformMessageReport.updateMany.mockResolvedValue({ count: 1 })
  prismaMock.draftRoomChatMessage.findFirst.mockResolvedValue({ message: 'you drafted like a clown', userId: 'u-sam', createdAt: T })
  prismaMock.mockDraftChat.findFirst.mockResolvedValue({ content: 'worst mock ever, idiot', userId: 'u-sam', createdAt: T })
})

describe('the review queue shows draft-chat reports', () => {
  it('a draft shell chat report carries the real message and author', async () => {
    prismaMock.platformMessageReport.findMany.mockResolvedValue([report('draftroom:live:L1')])
    const [row] = await listReportsForReview()
    expect(prismaMock.draftRoomChatMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-1', sessionKey: 'live:L1' },
      select: { message: true, userId: true, createdAt: true },
    })
    expect(row.message).toMatchObject({ store: 'draft_room', text: 'you drafted like a clown', authorUsername: 'sam', deleted: false })
  })

  it('a mock draft chat report carries the real message and author', async () => {
    prismaMock.platformMessageReport.findMany.mockResolvedValue([report('mockdraft:D9')])
    const [row] = await listReportsForReview()
    expect(row.message).toMatchObject({ store: 'mock_draft', text: 'worst mock ever, idiot', authorUsername: 'sam', deleted: false })
  })

  it('an already-removed draft message reads as deleted — from its text, having no metadata', async () => {
    prismaMock.draftRoomChatMessage.findFirst.mockResolvedValue({ message: '[message deleted]', userId: 'u-sam', createdAt: T })
    prismaMock.platformMessageReport.findMany.mockResolvedValue([report('draftroom:live:L1')])
    const [row] = await listReportsForReview()
    expect(row.message?.deleted).toBe(true)
  })
})

describe('Remove blanks the message in its own table', () => {
  it('draft shell chat', async () => {
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report('draftroom:live:L1'))
    await expect(reviewReport('r-1', 'remove', 'admin')).resolves.toMatchObject({ ok: true })
    expect(prismaMock.draftRoomChatMessage.update).toHaveBeenCalledWith({ where: { id: 'm-1' }, data: { message: '[message deleted]' } })
    expect(prismaMock.platformMessageReport.updateMany).toHaveBeenCalledWith({
      where: { messageId: 'm-1', threadId: 'draftroom:live:L1', status: 'pending' },
      data: { status: 'resolved' },
    })
    expect(prismaMock.platformChatMessage.update).not.toHaveBeenCalled()
  })

  it('mock draft chat', async () => {
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report('mockdraft:D9'))
    await expect(reviewReport('r-1', 'remove', 'admin')).resolves.toMatchObject({ ok: true })
    expect(prismaMock.mockDraftChat.update).toHaveBeenCalledWith({ where: { id: 'm-1' }, data: { content: '[message deleted]' } })
    expect(prismaMock.platformChatMessage.update).not.toHaveBeenCalled()
  })

  it('an already-removed message is not written again, and its reports still close', async () => {
    prismaMock.mockDraftChat.findFirst.mockResolvedValue({ content: '[message deleted]', userId: 'u-sam', createdAt: T })
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report('mockdraft:D9'))
    await expect(reviewReport('r-1', 'remove', 'admin')).resolves.toMatchObject({ ok: true, reportsClosed: 1 })
    expect(prismaMock.mockDraftChat.update).not.toHaveBeenCalled()
  })
})
