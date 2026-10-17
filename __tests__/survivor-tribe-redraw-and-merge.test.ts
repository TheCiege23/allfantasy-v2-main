import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, provision } = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorCommissionerAction: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    survivorPlayer: { findMany: vi.fn(), update: vi.fn() },
    survivorTribe: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    survivorTribeMember: { deleteMany: vi.fn(), create: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    survivorChatChannel: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    survivorChatMessage: { create: vi.fn() },
  },
  provision: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_id: string, fn: (tx: typeof db) => unknown) => fn(db) }))
vi.mock('@/lib/survivor/survivorTribeChatProvisioning', () => ({ provisionSurvivorChats: provision }))

import { dealTribes, decideTribeRedraw, getTribeRedrawStatus } from '@/lib/survivor/survivorTribeRedraw'
import { applySurvivorMergeCast } from '@/lib/survivor/survivorMergeCast'

const cast = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, userId: `u${i}`, redraftRosterId: `r${i}` }))
const tribes = ['t1', 't2', 't3', 't4'].map((id, i) => ({ id, name: `Tribe ${i + 1}` }))

beforeEach(() => {
  vi.clearAllMocks()
  db.survivorCommissionerAction.findMany.mockResolvedValue([{ actionType: 'sit_out_shuffle_recommendation', week: 5 }])
  db.survivorCommissionerAction.findFirst.mockResolvedValue(null)
  db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', activeCouncilId: null, currentWeek: 6, pausedSnapshot: null })
  db.survivorPlayer.findMany.mockResolvedValue(cast)
  db.survivorTribe.findMany.mockResolvedValue(tribes)
  db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'league-chat' })
})

describe('random tribe redraw', () => {
  it('deals a shuffled cast so tribe sizes differ by at most one', () => {
    const ids = cast.map(p => p.userId)
    const sizes = [...dealTribes(ids, ['a', 'b', 'c', 'd']).values()].reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>())
    expect([...sizes.values()].sort()).toEqual([2, 3, 3, 3])
    expect([...dealTribes(ids, ['a', 'b'], () => 0).keys()]).not.toEqual(ids)
  })

  it('reports the recommendation, a postponement, and a finished redraw', async () => {
    expect(await getTribeRedrawStatus('league')).toEqual({ status: 'recommended', recommendedWeek: 5 })
    db.survivorCommissionerAction.findMany.mockResolvedValueOnce([{ actionType: 'sit_out_shuffle_recommendation', week: 5 }, { actionType: 'tribe_redraw_postponed', week: 5 }])
    expect((await getTribeRedrawStatus('league')).status).toBe('postponed')
    db.survivorCommissionerAction.findMany.mockResolvedValueOnce([])
    expect((await getTribeRedrawStatus('league')).status).toBe('none')
  })

  it('moves every active manager, rebuilds member rows and chats, and announces it', async () => {
    const result = await decideTribeRedraw('league', 'commish', 'approve')
    expect(result).toMatchObject({ ok: true })
    expect(db.survivorPlayer.update).toHaveBeenCalledTimes(11)
    expect(db.survivorTribeMember.create).toHaveBeenCalledTimes(11)
    expect(provision).toHaveBeenCalledWith('league', expect.objectContaining({ actorUserId: 'commish' }))
    expect(db.survivorCommissionerAction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'tribe_redraw_approved' }) }))
    expect(db.survivorChatMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ content: expect.stringContaining('redrawn at random') }) }))
  })

  it('keeps only as many tribes as can hold a vote', async () => {
    db.survivorPlayer.findMany.mockResolvedValue(cast.slice(0, 5))
    const result = await decideTribeRedraw('league', 'commish', 'approve')
    expect(result.ok && Object.keys(result.tribeSizes)).toHaveLength(2)
    expect(db.survivorTribe.update).toHaveBeenCalledWith({ where: { id: 't3' }, data: { isActive: false } })
  })

  it('refuses during an open vote, after the merge, or a second time', async () => {
    db.survivorGameState.findUnique.mockResolvedValueOnce({ phase: 'pre_merge', activeCouncilId: 'council', currentWeek: 6, pausedSnapshot: null })
    expect(await decideTribeRedraw('league', 'commish', 'approve')).toMatchObject({ ok: false, status: 409 })
    db.survivorGameState.findUnique.mockResolvedValueOnce({ phase: 'post_merge', activeCouncilId: null, currentWeek: 6, pausedSnapshot: null })
    expect(await decideTribeRedraw('league', 'commish', 'approve')).toMatchObject({ ok: false, status: 409 })
    db.survivorCommissionerAction.findMany.mockResolvedValueOnce([{ actionType: 'sit_out_shuffle_recommendation', week: 5 }, { actionType: 'tribe_redraw_approved', week: 6 }])
    expect(await decideTribeRedraw('league', 'commish', 'approve')).toMatchObject({ ok: false, status: 409 })
    expect(db.survivorPlayer.update).not.toHaveBeenCalled()
  })

  it('records a postponement without moving anyone', async () => {
    expect(await decideTribeRedraw('league', 'commish', 'postpone')).toMatchObject({ ok: true })
    expect(db.survivorCommissionerAction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actionType: 'tribe_redraw_postponed' }) }))
    expect(db.survivorPlayer.update).not.toHaveBeenCalled()
  })
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
