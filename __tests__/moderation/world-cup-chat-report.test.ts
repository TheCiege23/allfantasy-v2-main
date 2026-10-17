// @vitest-environment node
/**
 * World Cup bracket pool chat — Report (App Store guideline 1.2). Its messages live in their own
 * table (WorldCupBracketChatEvent), so no report path could resolve them. The "worldcup:<id>" room
 * must accept a real report under the chat's own read rule and refuse everything that would let
 * anybody report anything — and the admin queue must be able to show and remove what it accepts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  leagueChatMessage: { findFirst: vi.fn(), update: vi.fn() },
  bracketLeagueMessage: { findFirst: vi.fn(), update: vi.fn() },
  bracketLeagueMember: { findUnique: vi.fn() },
  platformChatThreadMember: { findFirst: vi.fn() },
  platformChatMessage: { findFirst: vi.fn(), update: vi.fn() },
  platformMessageReport: { findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
  worldCupBracketChatEvent: { findFirst: vi.fn(), update: vi.fn() },
  worldCupBracketChallenge: { findUnique: vi.fn() },
  worldCupBracketParticipant: { findUnique: vi.fn() },
  appUser: { findMany: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn() }))

import { createMessageReport } from '@/lib/moderation/ReportSubmissionService'
import { listReportsForReview, reviewReport } from '@/lib/moderation/AdminReportReview'
import { worldCupReportThreadId } from '@/lib/moderation/reportRooms'

const ROOM = worldCupReportThreadId('WC1')
const T = new Date('2026-09-29T03:00:00.000Z')
const row = (over: Record<string, unknown> = {}) => ({ userId: 'u-sam', isAiGenerated: false, metadata: { messageType: 'text', visibility: 'public' }, ...over })

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.worldCupBracketChatEvent.findFirst.mockResolvedValue(row())
  prismaMock.worldCupBracketChallenge.findUnique.mockResolvedValue({ ownerUserId: 'u-owner' })
  prismaMock.worldCupBracketParticipant.findUnique.mockResolvedValue({ id: 'p1' })
  prismaMock.platformMessageReport.findFirst.mockResolvedValue(null)
  prismaMock.platformMessageReport.create.mockResolvedValue({ id: 'r-1' })
})

describe('reporting a World Cup pool message', () => {
  it("records a participant's report against the pool room", async () => {
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'harassment')).resolves.toEqual({ id: 'r-1' })
    expect(prismaMock.worldCupBracketChatEvent.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-1', challengeId: 'WC1' },
      select: { userId: true, isAiGenerated: true, metadata: true },
    })
    expect(prismaMock.platformMessageReport.create).toHaveBeenCalledWith({
      data: { messageId: 'm-1', threadId: ROOM, reporterUserId: 'u-me', reason: 'harassment', status: 'pending' },
      select: { id: true },
    })
    expect(prismaMock.platformChatThreadMember.findFirst).not.toHaveBeenCalled()
  })

  it('the pool owner can report without being a participant', async () => {
    prismaMock.worldCupBracketParticipant.findUnique.mockResolvedValue(null)
    await expect(createMessageReport('u-owner', 'm-1', ROOM, 'spam')).resolves.toEqual({ id: 'r-1' })
  })

  it('refuses someone who is neither owner nor participant', async () => {
    prismaMock.worldCupBracketParticipant.findUnique.mockResolvedValue(null)
    await expect(createMessageReport('u-outsider', 'm-1', ROOM, 'spam')).resolves.toBeNull()
    expect(prismaMock.platformMessageReport.create).not.toHaveBeenCalled()
  })

  it("refuses a private row the reporter can't see", async () => {
    prismaMock.worldCupBracketChatEvent.findFirst.mockResolvedValue(row({ metadata: { visibility: 'private_to_user', targetUserId: 'u-other' } }))
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'spam')).resolves.toBeNull()
  })

  it('accepts a private row sent TO the reporter', async () => {
    prismaMock.worldCupBracketChatEvent.findFirst.mockResolvedValue(row({ metadata: { visibility: 'private_to_user', targetUserId: 'u-me' } }))
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'harassment')).resolves.toEqual({ id: 'r-1' })
  })

  it("refuses Chimmy's answers and system rows — no human author", async () => {
    prismaMock.worldCupBracketChatEvent.findFirst.mockResolvedValue(row({ isAiGenerated: true }))
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'spam')).resolves.toBeNull()
    prismaMock.worldCupBracketChatEvent.findFirst.mockResolvedValue(row({ metadata: { messageType: 'system' } }))
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'spam')).resolves.toBeNull()
  })

  it('refuses a message that is not in that pool, and your own message', async () => {
    prismaMock.worldCupBracketChatEvent.findFirst.mockResolvedValue(null)
    await expect(createMessageReport('u-me', 'm-x', ROOM, 'spam')).resolves.toBeNull()
    prismaMock.worldCupBracketChatEvent.findFirst.mockResolvedValue(row({ userId: 'u-me' }))
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'spam')).resolves.toBeNull()
  })
})

describe('the admin queue handles a World Cup report', () => {
  const report = { id: 'r-1', messageId: 'm-1', threadId: ROOM, reporterUserId: 'u-rep', reason: 'harassment', status: 'pending', createdAt: T }

  beforeEach(() => {
    prismaMock.worldCupBracketChatEvent.findFirst.mockResolvedValue({
      eventBody: 'your bracket is trash', userId: 'u-sam', createdAt: T, metadata: { messageType: 'text' }, challenge: { name: 'Office Pool' },
    })
    prismaMock.appUser.findMany.mockResolvedValue([{ id: 'u-rep', username: 'rep' }, { id: 'u-sam', username: 'sam' }])
    prismaMock.platformMessageReport.updateMany.mockResolvedValue({ count: 1 })
  })

  it('shows the real message, its author and the pool', async () => {
    prismaMock.platformMessageReport.findMany.mockResolvedValue([report])
    const [r] = await listReportsForReview()
    expect(r.message).toMatchObject({ store: 'world_cup', text: 'your bracket is trash', authorUsername: 'sam', roomName: 'Office Pool', deleted: false })
  })

  it('Remove soft-deletes it in its own table, recording the moderation', async () => {
    prismaMock.platformMessageReport.findUnique.mockResolvedValue(report)
    await expect(reviewReport('r-1', 'remove', 'admin')).resolves.toMatchObject({ ok: true })
    const call = prismaMock.worldCupBracketChatEvent.update.mock.calls[0][0]
    expect(call.where).toEqual({ id: 'm-1' })
    expect(call.data.eventBody).toBe('[message deleted]')
    expect(call.data.metadata).toMatchObject({ removedByModeration: true, moderationReportId: 'r-1' })
    expect(prismaMock.platformChatMessage.update).not.toHaveBeenCalled()
  })
})
