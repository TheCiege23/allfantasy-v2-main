import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  zombieAnnouncement: { findMany: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
  leagueChatMessage: { upsert: vi.fn() },
  platformNotification: { upsert: vi.fn() },
  league: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
import { processZombieAnnouncementQueue } from '@/lib/zombie/scheduledAnnouncementDelivery'

const announcement = (patch: Record<string, unknown> = {}) => ({
  id: 'a1', title: 'The horde grows', content: 'Three new infections.', week: 2,
  type: 'commissioner_note', isPublic: true, targetUserId: null,
  league: { leagueId: 'L1' }, ...patch,
})

beforeEach(() => {
  vi.resetAllMocks()
  db.zombieAnnouncement.findMany.mockResolvedValue([{ id: 'a1' }])
  db.zombieAnnouncement.updateMany.mockResolvedValue({ count: 1 })
  db.zombieAnnouncement.findUniqueOrThrow.mockResolvedValue(announcement())
  db.league.findUnique.mockResolvedValue({ userId: 'owner' })
  db.$transaction.mockImplementation(async (work: (tx: typeof db) => Promise<unknown>) => work(db))
})

describe('scheduled Zombie announcements', () => {
  it('delivers a public announcement to native league chat with a stable receipt', async () => {
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 1, errors: [] })
    expect(db.leagueChatMessage.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'zombie-announcement:a1' },
      create: expect.objectContaining({ leagueId: 'L1', userId: 'owner', type: 'host_announcement', message: 'The horde grows\n\nThree new infections.' }),
      update: {},
    }))
    expect(db.platformNotification.upsert).not.toHaveBeenCalled()
  })

  it.each([false, true])('delivers targeted content privately even when isPublic=%s', async isPublic => {
    db.zombieAnnouncement.findUniqueOrThrow.mockResolvedValue(announcement({ isPublic, targetUserId: 'whisperer' }))
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 1, errors: [] })
    expect(db.leagueChatMessage.upsert).not.toHaveBeenCalled()
    expect(db.platformNotification.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { sourceKey: 'zombie-announcement:a1' },
      create: expect.objectContaining({ userId: 'whisperer', leagueId: 'L1', title: 'The horde grows' }),
      update: {},
    }))
  })

  it('holds private content without a recipient instead of broadcasting it', async () => {
    db.zombieAnnouncement.findUniqueOrThrow.mockResolvedValue(announcement({ isPublic: false }))
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 0, errors: ['announcement a1: delivery failed; pending retry'] })
    expect(db.leagueChatMessage.upsert).not.toHaveBeenCalled()
    expect(db.platformNotification.upsert).not.toHaveBeenCalled()
  })

  it('uses a bounded ordered due queue and leaves weekly reports to their approval workflow', async () => {
    await processZombieAnnouncementQueue()
    expect(db.zombieAnnouncement.findMany).toHaveBeenCalledWith({
      where: { isPosted: false, scheduledFor: { not: null, lte: expect.any(Date) }, type: { not: 'weekly_update' } },
      orderBy: [{ scheduledFor: 'asc' }, { id: 'asc' }], take: 100, select: { id: true },
    })
    expect(db.zombieAnnouncement.updateMany).toHaveBeenCalledWith({
      where: { id: 'a1', isPosted: false, scheduledFor: { not: null, lte: expect.any(Date) }, type: { not: 'weekly_update' } },
      data: { isPosted: true, postedAt: expect.any(Date) },
    })
  })

  it('does not deliver a row already claimed, cancelled, postponed or changed to a weekly report', async () => {
    db.zombieAnnouncement.updateMany.mockResolvedValue({ count: 0 })
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 0, errors: [] })
    expect(db.zombieAnnouncement.findUniqueOrThrow).not.toHaveBeenCalled()
    expect(db.leagueChatMessage.upsert).not.toHaveBeenCalled()
  })

  it('reports failed delivery without leaking content and continues other announcements', async () => {
    db.zombieAnnouncement.findMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    db.leagueChatMessage.upsert.mockRejectedValueOnce(new Error('Sensitive Whisperer content in a database error'))
    db.zombieAnnouncement.findUniqueOrThrow.mockResolvedValueOnce(announcement()).mockResolvedValueOnce(announcement({ id: 'a2' }))
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 1, errors: ['announcement a1: delivery failed; pending retry'] })
    expect(db.leagueChatMessage.upsert).toHaveBeenCalledTimes(2)
  })

  it('holds delivery when the league owner is unavailable', async () => {
    db.league.findUnique.mockResolvedValue(null)
    expect(await processZombieAnnouncementQueue()).toEqual({ posted: 0, errors: ['announcement a1: delivery failed; pending retry'] })
    expect(db.leagueChatMessage.upsert).not.toHaveBeenCalled()
  })
})
