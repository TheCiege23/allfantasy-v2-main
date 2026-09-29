// @vitest-environment node
/**
 * Admin review of reported chat messages (App Store guideline 1.2: reports must
 * be acted on). Covers where each report's message is looked up, what "remove"
 * writes, that one decision closes every pending report on the same message,
 * and that the admin route refuses non-admins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  platformMessageReport: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  leagueChatMessage: { findFirst: vi.fn(), update: vi.fn() },
  bracketLeagueMessage: { findFirst: vi.fn(), update: vi.fn() },
  platformChatMessage: { findFirst: vi.fn(), update: vi.fn() },
  appUser: { findMany: vi.fn() },
}))
const requireAdminMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/adminAuth', () => ({ requireAdmin: requireAdminMock }))

import { listReportsForReview, reviewReport } from '@/lib/moderation/AdminReportReview'
import { POST } from '@/app/api/admin/moderation/reports/[reportId]/route'

const T = new Date('2026-09-28T20:00:00.000Z')
const report = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', messageId: 'm-1', threadId: 'league:L1', reporterUserId: 'u-rep', reason: 'harassment', status: 'pending', createdAt: T, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.leagueChatMessage.findFirst.mockResolvedValue({ message: 'you are trash', userId: 'u-sam', createdAt: T, metadata: null, league: { name: 'Iron Horse' } })
  prismaMock.bracketLeagueMessage.findFirst.mockResolvedValue(null)
  prismaMock.platformChatMessage.findFirst.mockResolvedValue(null)
  prismaMock.appUser.findMany.mockResolvedValue([{ id: 'u-rep', username: 'reporter' }, { id: 'u-sam', username: 'sam' }])
  prismaMock.platformMessageReport.updateMany.mockResolvedValue({ count: 2 })
})

describe('listReportsForReview', () => {
  it('shows each report with the real message, its author, the league and the reporter', async () => {
    prismaMock.platformMessageReport.findMany.mockResolvedValue([report(), report({ id: 'r-2', reporterUserId: 'u-sam' })])
    const [first] = await listReportsForReview()
    expect(prismaMock.platformMessageReport.findMany.mock.calls[0][0].where).toEqual({ status: 'pending' })
    expect(first.message).toMatchObject({ store: 'league', text: 'you are trash', authorUsername: 'sam', roomName: 'Iron Horse', deleted: false })
    expect(first.reporter.username).toBe('reporter')
    expect(first.reportsOnMessage).toBe(2)
  })

  it('finds a DM message in the platform table', async () => {
    prismaMock.platformMessageReport.findMany.mockResolvedValue([report({ threadId: 'thread-uuid' })])
    prismaMock.platformChatMessage.findFirst.mockResolvedValue({ body: 'dm text', senderUserId: 'u-sam', createdAt: T, metadata: null })
    const [r] = await listReportsForReview()
    expect(prismaMock.leagueChatMessage.findFirst).not.toHaveBeenCalled()
    expect(r.message).toMatchObject({ store: 'platform', text: 'dm text', roomName: null })
  })
})

describe('reviewReport', () => {
  it('remove: soft-deletes the league message the way chat already renders, and resolves every report on it', async () => {
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report())
    const res = await reviewReport('r-1', 'remove', 'admin:owner')
    expect(res).toEqual({ ok: true, action: 'remove', reportsClosed: 2 })
    const upd = prismaMock.leagueChatMessage.update.mock.calls[0][0]
    expect(upd.where).toEqual({ id: 'm-1' })
    expect(upd.data.message).toBe('[message deleted]')
    expect(upd.data.metadata).toMatchObject({ removedByModeration: true, deletedByUserId: 'admin:owner', moderationReportId: 'r-1' })
    expect(typeof upd.data.metadata.deletedAt).toBe('string')
    expect(prismaMock.platformMessageReport.updateMany).toHaveBeenCalledWith({
      where: { messageId: 'm-1', threadId: 'league:L1', status: 'pending' },
      data: { status: 'resolved' },
    })
  })

  it('remove on a DM uses the platform table and its `body` column', async () => {
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report({ threadId: 'thread-uuid' }))
    prismaMock.platformChatMessage.findFirst.mockResolvedValue({ body: 'dm text', senderUserId: 'u-sam', createdAt: T, metadata: null })
    await reviewReport('r-1', 'remove', 'admin:owner')
    expect(prismaMock.platformChatMessage.update.mock.calls[0][0].data.body).toBe('[message deleted]')
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
  })

  it('does not rewrite a message its author already deleted, but still closes the reports', async () => {
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report())
    prismaMock.leagueChatMessage.findFirst.mockResolvedValue({ message: '[message deleted]', userId: 'u-sam', createdAt: T, metadata: { deletedAt: 'x' }, league: { name: 'L' } })
    await expect(reviewReport('r-1', 'remove', 'admin:owner')).resolves.toMatchObject({ ok: true })
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
    expect(prismaMock.platformMessageReport.updateMany).toHaveBeenCalled()
  })

  it('dismiss: leaves the message and dismisses every pending report on it', async () => {
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report())
    await reviewReport('r-1', 'dismiss', 'admin:owner')
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
    expect(prismaMock.platformMessageReport.updateMany.mock.calls[0][0].data).toEqual({ status: 'dismissed' })
  })

  it('refuses a report that is missing or already closed', async () => {
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(null)
    await expect(reviewReport('nope', 'remove', 'a')).resolves.toMatchObject({ ok: false, status: 404 })
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report({ status: 'resolved' }))
    await expect(reviewReport('r-1', 'remove', 'a')).resolves.toMatchObject({ ok: false, status: 409 })
    expect(prismaMock.leagueChatMessage.update).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/moderation/reports/[reportId]', () => {
  const call = (body: unknown) =>
    POST(new Request('https://www.allfantasy.ai/api/admin/moderation/reports/r-1', { method: 'POST', body: JSON.stringify(body) }), { params: { reportId: 'r-1' } })

  it('refuses anyone who is not an admin, before touching anything', async () => {
    requireAdminMock.mockResolvedValue({ ok: false, res: new Response('Forbidden', { status: 403 }) })
    expect((await call({ action: 'remove' })).status).toBe(403)
    expect(prismaMock.platformMessageReport.findUnique).not.toHaveBeenCalled()
  })

  it('rejects an unknown action', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: 'owner' } })
    expect((await call({ action: 'ban' })).status).toBe(400)
  })

  it('removes for an admin and records who did it', async () => {
    requireAdminMock.mockResolvedValue({ ok: true, user: { id: 'owner' } })
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report())
    const res = await call({ action: 'remove' })
    expect(res.status).toBe(200)
    expect(prismaMock.leagueChatMessage.update.mock.calls[0][0].data.metadata.deletedByUserId).toBe('admin:owner')
  })
})
