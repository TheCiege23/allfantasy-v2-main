import { beforeEach, describe, expect, it, vi } from 'vitest'

const { config, provision } = vi.hoisted(() => ({ config: vi.fn(), provision: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: config }))
vi.mock('@/lib/survivor/survivorTribeChatProvisioning', () => ({ provisionSurvivorChats: provision }))

import { runShuffle } from '@/lib/survivor/SurvivorTribeShuffleEngine'
import { survivorRedrawTribeCount } from '@/lib/survivor/survivorTribeRedrawActions'

function database() {
  const tribes = [
    { id: 'tribe-a', members: [{ rosterId: 'ra' }, { rosterId: 'rb' }] },
    { id: 'tribe-b', members: [{ rosterId: 'rc' }, { rosterId: 'rd' }, { rosterId: 'eliminated' }] },
  ]
  return {
    survivorGameState: { findUnique: vi.fn().mockResolvedValue({ phase: 'pre_merge', activeCouncilId: null, currentWeek: 3 }) },
    survivorTribe: { findMany: vi.fn().mockResolvedValue(tribes), updateMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn().mockResolvedValue([
      { userId: 'a', redraftRosterId: 'ra', tribeId: 'tribe-a' },
      { userId: 'b', redraftRosterId: 'rb', tribeId: 'tribe-a' },
      { userId: 'c', redraftRosterId: 'rc', tribeId: 'tribe-b' },
      { userId: 'd', redraftRosterId: 'rd', tribeId: 'tribe-b' },
    ]), update: vi.fn() },
    survivorChatChannel: { findMany: vi.fn().mockResolvedValue([{ id: 'old-a' }, { id: 'old-b' }]), updateMany: vi.fn() },
    survivorTribeMember: { deleteMany: vi.fn(), create: vi.fn() },
    survivorTribeChatMember: { deleteMany: vi.fn(), create: vi.fn() },
    survivorTribeSwap: { create: vi.fn() },
    survivorChatMessage: { create: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    survivorCommissionerAction: { findMany: vi.fn().mockResolvedValue([]) },
  }
}

describe('commissioner-approved tribe redraw engine', () => {
  beforeEach(() => { vi.clearAllMocks(); config.mockResolvedValue({ configId: 'config' }); provision.mockResolvedValue({ ok: true, leagueChannelId: 'league-chat' }) })

  it('redraws only active managers and archives all old private huddles before provisioning new ones', async () => {
    const db = database()
    const result = await runShuffle('league', { db: db as never, seed: 7, actorUserId: 'commish' })
    expect(result.ok).toBe(true)
    expect(db.survivorChatChannel.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['old-a', 'old-b'] } },
      data: expect.objectContaining({ isArchived: true, memberUserIds: [], readOnlyUserIds: [] }) })
    expect(db.survivorTribeMember.create).toHaveBeenCalledTimes(4)
    expect(db.survivorTribeMember.create.mock.calls.map(([call]) => call.data.rosterId).sort()).toEqual(['ra', 'rb', 'rc', 'rd'])
    expect(db.survivorPlayer.update).toHaveBeenCalledTimes(4)
    expect(provision).toHaveBeenCalledWith('league', expect.objectContaining({ db }))
    expect(db.survivorChatMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ channelId: 'league-chat', senderName: 'Chimmy' }) })
    expect(db.survivorTribeSwap.create).toHaveBeenCalledWith({ data: expect.objectContaining({ swapType: 'random_shuffle' }) })
  })

  it('gives every larger tribe a manager who did not sit out last week', async () => {
    // NBA rehearsal week 7: a plain shuffle put all five of week 6's sit-outs into the one tribe of
    // five; it had to sit someone out and nobody in it could, so the week never settled.
    const tribes = ['t1', 't2', 't3', 't4'].map(id => ({ id, members: [] as Array<{ rosterId: string }> }))
    const players = Array.from({ length: 17 }, (_, i) => ({ userId: `u${i}`, redraftRosterId: `r${i}`, tribeId: tribes[i % 4].id }))
    players.forEach(player => tribes.find(tribe => tribe.id === player.tribeId)!.members.push({ rosterId: player.redraftRosterId }))
    const rested = new Set(players.slice(0, 13).map(player => player.userId))
    for (let seed = 1; seed <= 50; seed++) {
      const db = database()
      db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', activeCouncilId: null, currentWeek: 7 })
      db.survivorTribe.findMany.mockResolvedValue(tribes)
      db.survivorPlayer.findMany.mockResolvedValue(players)
      db.survivorCommissionerAction.findMany.mockResolvedValue([...rested].map(targetUserId => ({ targetUserId })))
      expect(await runShuffle('league', { db: db as never, seed })).toEqual({ ok: true })
      expect(db.survivorCommissionerAction.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ week: 6, actionType: 'sit_out_accepted' }) }))
      const byTribe = new Map<string, string[]>()
      for (const [call] of db.survivorTribeMember.create.mock.calls) byTribe.set(call.data.tribeId, [...(byTribe.get(call.data.tribeId) ?? []), call.data.rosterId])
      const smallest = Math.min(...[...byTribe.values()].map(members => members.length))
      for (const members of byTribe.values()) {
        if (members.length === smallest) continue
        expect(members.some(rosterId => !rested.has(rosterId.replace('r', 'u')))).toBe(true)
      }
    }
  })

  it('refuses to redraw during an open council without changing memberships', async () => {
    const db = database()
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', activeCouncilId: 'open', currentWeek: 3 })
    expect(await runShuffle('league', { db: db as never, seed: 7 })).toEqual(expect.objectContaining({ ok: false }))
    expect(db.survivorTribeMember.deleteMany).not.toHaveBeenCalled()
    expect(db.survivorChatChannel.updateMany).not.toHaveBeenCalled()
  })

  it('folds a small cast into fewer tribes so no tribe is left with one manager', async () => {
    // Rehearsal week 7: ten managers across four tribes became 3/3/2/2, and a tribe of one froze week 9.
    const db = database()
    const tribes = ['t1', 't2', 't3', 't4'].map(id => ({ id, members: [] as Array<{ rosterId: string }> }))
    const players = Array.from({ length: 10 }, (_, i) => ({ userId: `u${i}`, redraftRosterId: `r${i}`, tribeId: tribes[i % 4].id }))
    players.forEach(player => tribes.find(tribe => tribe.id === player.tribeId)!.members.push({ rosterId: player.redraftRosterId }))
    db.survivorTribe.findMany.mockResolvedValue(tribes)
    db.survivorPlayer.findMany.mockResolvedValue(players)
    expect(await runShuffle('league', { db: db as never, seed: 11 })).toEqual({ ok: true })
    const sizes = new Map<string, number>()
    for (const [call] of db.survivorTribeMember.create.mock.calls) sizes.set(call.data.tribeId, (sizes.get(call.data.tribeId) ?? 0) + 1)
    expect([...sizes.entries()].sort()).toEqual([['t1', 4], ['t2', 3], ['t3', 3]])
    expect(db.survivorTribe.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['t4'] } }, data: { isActive: false, phase: 'dissolved' } })
    expect(db.survivorChatMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ content: expect.stringContaining('into 3 tribes') }) })
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ data: expect.objectContaining({ tribeCount: 3, previousTribeCount: 4, retiredTribeIds: ['t4'] }) }) })
  })

  it('keeps every tribe while the cast still fills them, and refuses a cast too small to split', async () => {
    const db = database()
    await runShuffle('league', { db: db as never, seed: 7 })
    expect(db.survivorTribe.updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }))
    db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'a', redraftRosterId: 'ra', tribeId: 'tribe-a' }, { userId: 'c', redraftRosterId: 'rc', tribeId: 'tribe-b' }])
    db.survivorTribe.findMany.mockResolvedValue([{ id: 'tribe-a', members: [{ rosterId: 'ra' }] }, { id: 'tribe-b', members: [{ rosterId: 'rc' }] }])
    expect(await runShuffle('league', { db: db as never, seed: 7 })).toEqual({ ok: false, error: expect.stringContaining('merge') })
  })
})

describe('survivorRedrawTribeCount', () => {
  it('keeps tribes at three or more managers, between two and today\'s count', () => {
    expect(survivorRedrawTribeCount(16, 4)).toBe(4)
    expect(survivorRedrawTribeCount(12, 4)).toBe(4)
    expect(survivorRedrawTribeCount(11, 4)).toBe(3)
    expect(survivorRedrawTribeCount(10, 4)).toBe(3)
    expect(survivorRedrawTribeCount(8, 4)).toBe(2)
    expect(survivorRedrawTribeCount(5, 3)).toBe(2)
    expect(survivorRedrawTribeCount(4, 2)).toBe(2)
    expect(survivorRedrawTribeCount(3, 2)).toBeNull()
    expect(survivorRedrawTribeCount(10, 1)).toBeNull()
  })
})
