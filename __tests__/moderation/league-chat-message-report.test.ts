// @vitest-environment node
/**
 * Reporting a league chat message (App Store guideline 1.2). League chat lives in a
 * virtual room ("league:<id>"), not a platform thread, so the platform path —
 * which checks thread membership and platform_chat_messages — refused every
 * league report. The league branch must accept a real report and still refuse
 * the ones that would let anybody file reports about any league.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  leagueChatMessage: { findFirst: vi.fn() },
  bracketLeagueMessage: { findFirst: vi.fn() },
  bracketLeagueMember: { findUnique: vi.fn() },
  platformChatThreadMember: { findFirst: vi.fn() },
  platformChatMessage: { findFirst: vi.fn() },
  platformMessageReport: { findFirst: vi.fn(), create: vi.fn() },
}))
const accessMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: accessMock }))

import { createMessageReport } from '@/lib/moderation/ReportSubmissionService'

const ROOM = 'league:L1'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.leagueChatMessage.findFirst.mockResolvedValue({ userId: 'u-sam' })
  prismaMock.bracketLeagueMessage.findFirst.mockResolvedValue(null)
  prismaMock.platformMessageReport.findFirst.mockResolvedValue(null)
  prismaMock.platformMessageReport.create.mockResolvedValue({ id: 'r-1' })
  accessMock.mockResolvedValue({ via: 'roster' })
})

describe('reporting a league chat message', () => {
  it('records a member’s report against the league room', async () => {
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'harassment')).resolves.toEqual({ id: 'r-1' })
    expect(prismaMock.leagueChatMessage.findFirst).toHaveBeenCalledWith({ where: { id: 'm-1', leagueId: 'L1' }, select: { userId: true } })
    expect(accessMock).toHaveBeenCalledWith('L1', 'u-me')
    expect(prismaMock.platformMessageReport.create).toHaveBeenCalledWith({
      data: { messageId: 'm-1', threadId: ROOM, reporterUserId: 'u-me', reason: 'harassment', status: 'pending' },
      select: { id: true },
    })
    // Never falls through to the platform-thread path, which would refuse it.
    expect(prismaMock.platformChatThreadMember.findFirst).not.toHaveBeenCalled()
  })

  it('refuses someone who cannot read the league', async () => {
    accessMock.mockResolvedValue(null)
    await expect(createMessageReport('u-outsider', 'm-1', ROOM, 'spam')).resolves.toBeNull()
    expect(prismaMock.platformMessageReport.create).not.toHaveBeenCalled()
  })

  it('refuses a message that is not in that league', async () => {
    prismaMock.leagueChatMessage.findFirst.mockResolvedValue(null)
    await expect(createMessageReport('u-me', 'm-elsewhere', ROOM, 'spam')).resolves.toBeNull()
    expect(prismaMock.platformMessageReport.create).not.toHaveBeenCalled()
  })

  it('refuses reporting your own message', async () => {
    prismaMock.leagueChatMessage.findFirst.mockResolvedValue({ userId: 'u-me' })
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'spam')).resolves.toBeNull()
  })

  it('does not file a second pending report for the same message', async () => {
    prismaMock.platformMessageReport.findFirst.mockResolvedValue({ id: 'r-existing' })
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'spam')).resolves.toEqual({ id: 'r-existing' })
    expect(prismaMock.platformMessageReport.create).not.toHaveBeenCalled()
  })

  it('handles a bracket league room the same way, by bracket membership', async () => {
    prismaMock.leagueChatMessage.findFirst.mockResolvedValue(null)
    prismaMock.bracketLeagueMessage.findFirst.mockResolvedValue({ userId: 'u-sam' })
    prismaMock.bracketLeagueMember.findUnique.mockResolvedValue({ id: 'bm-1' })
    await expect(createMessageReport('u-me', 'bm-msg', ROOM, 'spam')).resolves.toEqual({ id: 'r-1' })
    prismaMock.bracketLeagueMember.findUnique.mockResolvedValue(null)
    await expect(createMessageReport('u-outsider', 'bm-msg', ROOM, 'spam')).resolves.toBeNull()
  })
})
