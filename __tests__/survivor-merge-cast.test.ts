import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db } = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorPlayer: { findMany: vi.fn(), update: vi.fn() },
    survivorTribe: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    survivorChatChannel: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    survivorChatMessage: { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }))

import { applySurvivorMergeCast } from '@/lib/survivor/survivorMergeCast'

const cast = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, userId: `u${i}`, redraftRosterId: `r${i}` }))

beforeEach(() => {
  vi.clearAllMocks()
  db.survivorPlayer.findMany.mockResolvedValue(cast)
  db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'league-chat' })
})

describe('merge cast', () => {
  beforeEach(() => {
    db.league.findUnique.mockResolvedValue({ userId: 'host', settings: { commissionerParticipationMode: 'non_participating_host' } })
    db.survivorTribe.findFirst.mockResolvedValue({ id: 'merged', name: 'Merged — Week 9' })
    db.survivorPlayer.findMany.mockResolvedValue(cast.slice(0, 10))
    db.survivorChatChannel.findFirst.mockResolvedValue(null)
    db.survivorChatChannel.create.mockResolvedValue({ id: 'merge-chat' })
  })

  it('opens one merge chat for the remaining cast and the host, and closes tribe huddles', async () => {
    expect(await applySurvivorMergeCast('league', 9)).toEqual({ mergeChannelId: 'merge-chat', members: 10 })
    expect(db.survivorChatChannel.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ channelType: 'merge', memberUserIds: [...cast.slice(0, 10).map(p => p.userId), 'host'] }) }))
    expect(db.survivorPlayer.update).toHaveBeenCalledWith(expect.objectContaining({ data: { canAccessMergeChat: true, canAccessTribeChat: false, tribeId: 'merged' } }))
    expect(db.survivorChatChannel.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ channelType: 'tribe' }), data: expect.objectContaining({ isArchived: true }) }))
    expect(db.survivorChatMessage.create).toHaveBeenCalledOnce()
  })

  it('only re-syncs membership when run again', async () => {
    db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'merge-chat' })
    await applySurvivorMergeCast('league', 9)
    expect(db.survivorChatChannel.create).not.toHaveBeenCalled()
    expect(db.survivorChatMessage.create).not.toHaveBeenCalled()
  })
})
