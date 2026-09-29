// @vitest-environment node
/**
 * Reporting a message in the app/draft shell's chat ("draftroom:<sessionKey>") and the mock draft
 * simulator's chat ("mockdraft:<draftId>") — App Store guideline 1.2. Both chats keep their messages
 * in tables of their own, so neither the league branch nor the platform-thread branch could resolve
 * them: every report was refused. Each room must accept a real report and still refuse the ones that
 * would let anybody report anything.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  leagueChatMessage: { findFirst: vi.fn() },
  bracketLeagueMessage: { findFirst: vi.fn() },
  bracketLeagueMember: { findUnique: vi.fn() },
  platformChatThreadMember: { findFirst: vi.fn() },
  platformChatMessage: { findFirst: vi.fn() },
  platformMessageReport: { findFirst: vi.fn(), create: vi.fn() },
  draftRoomChatMessage: { findFirst: vi.fn() },
  mockDraftChat: { findFirst: vi.fn() },
}))
const leagueAccess = vi.hoisted(() => vi.fn())
const mockDraftAccess = vi.hoisted(() => vi.fn())

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueAccess: vi.fn() }))
vi.mock('@/lib/draft/access', () => ({ canAccessLeague: leagueAccess }))
vi.mock('@/lib/mock-draft-engine/MockDraftSessionService', () => ({ canAccessMockDraft: mockDraftAccess }))

import { createMessageReport } from '@/lib/moderation/ReportSubmissionService'
import { draftRoomReportThreadId, mockDraftReportThreadId } from '@/lib/moderation/reportRooms'

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.platformMessageReport.findFirst.mockResolvedValue(null)
  prismaMock.platformMessageReport.create.mockResolvedValue({ id: 'r-1' })
  prismaMock.draftRoomChatMessage.findFirst.mockResolvedValue({ userId: 'u-sam' })
  prismaMock.mockDraftChat.findFirst.mockResolvedValue({ userId: 'u-sam' })
  leagueAccess.mockResolvedValue(true)
  mockDraftAccess.mockResolvedValue(true)
})

describe('draft shell chat — "draftroom:<sessionKey>"', () => {
  const LIVE = draftRoomReportThreadId('live:L1')

  it('records a report on a live session the reporter can read', async () => {
    await expect(createMessageReport('u-me', 'm-1', LIVE, 'harassment')).resolves.toEqual({ id: 'r-1' })
    expect(prismaMock.draftRoomChatMessage.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-1', sessionKey: 'live:L1' },
      select: { userId: true },
    })
    expect(leagueAccess).toHaveBeenCalledWith('L1', 'u-me')
    expect(prismaMock.platformMessageReport.create).toHaveBeenCalledWith({
      data: { messageId: 'm-1', threadId: LIVE, reporterUserId: 'u-me', reason: 'harassment', status: 'pending' },
      select: { id: true },
    })
    // Never falls through to the platform-thread path, which would refuse it.
    expect(prismaMock.platformChatThreadMember.findFirst).not.toHaveBeenCalled()
  })

  it('refuses a live session whose league the reporter cannot read', async () => {
    leagueAccess.mockResolvedValue(false)
    await expect(createMessageReport('u-outsider', 'm-1', LIVE, 'spam')).resolves.toBeNull()
    expect(prismaMock.platformMessageReport.create).not.toHaveBeenCalled()
  })

  it('a mock session needs no league check — its chat is read without one', async () => {
    await expect(createMessageReport('u-me', 'm-1', draftRoomReportThreadId('mock:D9'), 'spam')).resolves.toEqual({ id: 'r-1' })
    expect(leagueAccess).not.toHaveBeenCalled()
  })

  it('refuses a message that is not in that session', async () => {
    prismaMock.draftRoomChatMessage.findFirst.mockResolvedValue(null)
    await expect(createMessageReport('u-me', 'm-elsewhere', LIVE, 'spam')).resolves.toBeNull()
    expect(prismaMock.platformMessageReport.create).not.toHaveBeenCalled()
  })

  it('refuses reporting your own message', async () => {
    prismaMock.draftRoomChatMessage.findFirst.mockResolvedValue({ userId: 'u-me' })
    await expect(createMessageReport('u-me', 'm-1', LIVE, 'spam')).resolves.toBeNull()
  })

  it('refuses a malformed session key', async () => {
    await expect(createMessageReport('u-me', 'm-1', draftRoomReportThreadId('nonsense'), 'spam')).resolves.toBeNull()
    expect(prismaMock.platformMessageReport.create).not.toHaveBeenCalled()
  })
})

describe('mock draft chat — "mockdraft:<draftId>"', () => {
  const ROOM = mockDraftReportThreadId('D9')

  it('records a report from someone who can open the mock draft', async () => {
    await expect(createMessageReport('u-me', 'm-1', ROOM, 'hate_speech')).resolves.toEqual({ id: 'r-1' })
    expect(prismaMock.mockDraftChat.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-1', mockDraftId: 'D9' },
      select: { userId: true },
    })
    expect(mockDraftAccess).toHaveBeenCalledWith('D9', 'u-me')
  })

  it('refuses someone who cannot open the mock draft', async () => {
    mockDraftAccess.mockResolvedValue(false)
    await expect(createMessageReport('u-outsider', 'm-1', ROOM, 'spam')).resolves.toBeNull()
    expect(prismaMock.platformMessageReport.create).not.toHaveBeenCalled()
  })

  it('refuses a message that is not in that mock draft', async () => {
    prismaMock.mockDraftChat.findFirst.mockResolvedValue(null)
    await expect(createMessageReport('u-me', 'm-elsewhere', ROOM, 'spam')).resolves.toBeNull()
  })
})

describe('[control] a platform thread still takes the platform path', () => {
  it('a DM thread id is not mistaken for either new room', async () => {
    prismaMock.platformChatThreadMember.findFirst.mockResolvedValue({ id: 'tm' })
    prismaMock.platformChatMessage.findFirst.mockResolvedValue({ id: 'm-1', senderUserId: 'u-sam' })
    await expect(createMessageReport('u-me', 'm-1', 'thread-abc', 'spam')).resolves.toEqual({ id: 'r-1' })
    expect(prismaMock.draftRoomChatMessage.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.mockDraftChat.findFirst).not.toHaveBeenCalled()
  })
})
