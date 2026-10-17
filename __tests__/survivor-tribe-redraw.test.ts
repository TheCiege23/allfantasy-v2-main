import { beforeEach, describe, expect, it, vi } from 'vitest'

const { config, provision } = vi.hoisted(() => ({ config: vi.fn(), provision: vi.fn() }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: config }))
vi.mock('@/lib/survivor/survivorTribeChatProvisioning', () => ({ provisionSurvivorChats: provision }))

import { runShuffle } from '@/lib/survivor/SurvivorTribeShuffleEngine'

function database() {
  const tribes = [
    { id: 'tribe-a', members: [{ rosterId: 'ra' }, { rosterId: 'rb' }] },
    { id: 'tribe-b', members: [{ rosterId: 'rc' }, { rosterId: 'eliminated' }] },
  ]
  return {
    survivorGameState: { findUnique: vi.fn().mockResolvedValue({ phase: 'pre_merge', activeCouncilId: null, currentWeek: 3 }) },
    survivorTribe: { findMany: vi.fn().mockResolvedValue(tribes), updateMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn().mockResolvedValue([
      { userId: 'a', redraftRosterId: 'ra', tribeId: 'tribe-a' },
      { userId: 'b', redraftRosterId: 'rb', tribeId: 'tribe-a' },
      { userId: 'c', redraftRosterId: 'rc', tribeId: 'tribe-b' },
    ]), update: vi.fn() },
    survivorChatChannel: { findMany: vi.fn().mockResolvedValue([{ id: 'old-a' }, { id: 'old-b' }]), updateMany: vi.fn() },
    survivorTribeMember: { deleteMany: vi.fn(), create: vi.fn() },
    survivorTribeChatMember: { deleteMany: vi.fn(), create: vi.fn() },
    survivorTribeSwap: { create: vi.fn() },
    survivorChatMessage: { create: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
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
    expect(db.survivorTribeMember.create).toHaveBeenCalledTimes(3)
    expect(db.survivorTribeMember.create.mock.calls.map(([call]) => call.data.rosterId).sort()).toEqual(['ra', 'rb', 'rc'])
    expect(db.survivorPlayer.update).toHaveBeenCalledTimes(3)
    expect(provision).toHaveBeenCalledWith('league', expect.objectContaining({ db }))
    expect(db.survivorChatMessage.create).toHaveBeenCalledWith({ data: expect.objectContaining({ channelId: 'league-chat', senderName: 'Chimmy' }) })
    expect(db.survivorTribeSwap.create).toHaveBeenCalledWith({ data: expect.objectContaining({ swapType: 'random_shuffle' }) })
  })

  it('refuses to redraw during an open council without changing memberships', async () => {
    const db = database()
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', activeCouncilId: 'open', currentWeek: 3 })
    expect(await runShuffle('league', { db: db as never, seed: 7 })).toEqual(expect.objectContaining({ ok: false }))
    expect(db.survivorTribeMember.deleteMany).not.toHaveBeenCalled()
    expect(db.survivorChatChannel.updateMany).not.toHaveBeenCalled()
  })
})
