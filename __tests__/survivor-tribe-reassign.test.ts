// @vitest-environment node
/**
 * A non-participating host moves one manager between tribes by hand, between councils and before
 * the merge. Membership, legacy chat rows, the player's tribe and the huddles move together, and
 * Chimmy announces it. A playing commissioner may never do this.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  db: {
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorPlayer: { findUnique: vi.fn(), update: vi.fn() },
    survivorTribe: { findFirst: vi.fn() },
    survivorTribeMember: { deleteMany: vi.fn(), create: vi.fn() },
    survivorTribeChatMember: { deleteMany: vi.fn(), create: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
  },
  provision: vi.fn(),
  chat: vi.fn(),
  tribes: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: m.db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_leagueId: string, work: (tx: typeof m.db) => Promise<unknown>) => work(m.db) }))
vi.mock('@/lib/survivor/survivorTribeChatProvisioning', () => ({ provisionSurvivorChats: m.provision }))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({ createSurvivorChatMessage: m.chat }))
vi.mock('@/lib/survivor/SurvivorTribeService', () => ({ getTribesWithMembers: m.tribes }))

import { reassignSurvivorTribeMember } from '@/lib/survivor/survivorTribeReassign'

describe('reassignSurvivorTribeMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    m.db.league.findUnique.mockResolvedValue({ settings: { commissionerParticipationMode: 'non_participating_host' } })
    m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', activeCouncilId: null, currentWeek: 6 })
    m.db.survivorPlayer.findUnique.mockResolvedValue({ id: 'sp-1', displayName: 'Jordan', playerState: 'active', redraftRosterId: 'r1', tribeId: 'alpha' })
    m.db.survivorTribe.findFirst.mockResolvedValue({ id: 'beta', name: 'Beta' })
    m.db.survivorTribeMember.deleteMany.mockResolvedValue({ count: 1 })
    m.db.survivorTribeChatMember.deleteMany.mockResolvedValue({ count: 1 })
    m.provision.mockResolvedValue({ ok: true, created: false, leagueChannelId: 'league-chat', tribeChannels: [] })
    m.tribes.mockResolvedValue([{ id: 'alpha', members: [] }, { id: 'beta', members: [{ rosterId: 'r1' }] }])
  })

  it('moves the manager, refreshes the huddles and announces it', async () => {
    const result = await reassignSurvivorTribeMember('L1', { userId: 'u1', toTribeId: 'beta', actorUserId: 'host' })
    expect(result).toEqual({ ok: true, userId: 'u1', fromTribeId: 'alpha', toTribeId: 'beta', tribes: [{ id: 'alpha', members: [] }, { id: 'beta', members: [{ rosterId: 'r1' }] }] })
    expect(m.db.survivorTribeMember.deleteMany).toHaveBeenCalledWith({ where: { rosterId: 'r1', tribe: { leagueId: 'L1' } } })
    expect(m.db.survivorTribeMember.create).toHaveBeenCalledWith({ data: { tribeId: 'beta', rosterId: 'r1', isLeader: false } })
    expect(m.db.survivorTribeChatMember.deleteMany).toHaveBeenCalledWith({ where: { rosterId: 'r1', isAiHost: false, tribe: { leagueId: 'L1' } } })
    expect(m.db.survivorTribeChatMember.create).toHaveBeenCalledWith({ data: { tribeId: 'beta', rosterId: 'r1', isAiHost: false } })
    expect(m.db.survivorPlayer.update).toHaveBeenCalledWith({ where: { id: 'sp-1' }, data: { tribeId: 'beta', canAccessTribeChat: true } })
    expect(m.provision).toHaveBeenCalledWith('L1', { db: m.db, actorUserId: 'host' })
    expect(m.chat).toHaveBeenCalledWith(m.db, { data: expect.objectContaining({ channelId: 'league-chat', senderIsHost: true, content: 'Jordan now sits with Beta. Open the Tribe Board to see the new lineup.' }) })
    expect(m.db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'tribe_member_reassigned', week: 6, actorUserId: 'host', targetUserId: 'u1', data: { fromTribeId: 'alpha', toTribeId: 'beta', rosterId: 'r1' } }) })
  })

  it('refuses a playing commissioner before touching anything', async () => {
    m.db.league.findUnique.mockResolvedValue({ settings: { commissionerParticipationMode: 'participating_player' } })
    expect(await reassignSurvivorTribeMember('L1', { userId: 'u1', toTribeId: 'beta', actorUserId: 'commish' })).toEqual(expect.objectContaining({ ok: false, status: 403 }))
    expect(m.db.survivorTribeMember.deleteMany).not.toHaveBeenCalled()
    expect(m.provision).not.toHaveBeenCalled()
  })

  it('moves nobody while a council is open, after the merge, onto the same tribe, or without a roster', async () => {
    m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', activeCouncilId: 'c1', currentWeek: 6 })
    expect(await reassignSurvivorTribeMember('L1', { userId: 'u1', toTribeId: 'beta', actorUserId: 'host' })).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'post_merge', activeCouncilId: null, currentWeek: 9 })
    expect(await reassignSurvivorTribeMember('L1', { userId: 'u1', toTribeId: 'beta', actorUserId: 'host' })).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    m.db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', activeCouncilId: null, currentWeek: 6 })
    m.db.survivorTribe.findFirst.mockResolvedValue({ id: 'alpha', name: 'Alpha' })
    expect(await reassignSurvivorTribeMember('L1', { userId: 'u1', toTribeId: 'alpha', actorUserId: 'host' })).toEqual({ ok: false, status: 409, error: 'Jordan is already on Alpha.' })
    m.db.survivorPlayer.findUnique.mockResolvedValue({ id: 'sp-1', displayName: 'Jordan', playerState: 'active', redraftRosterId: null, tribeId: 'alpha' })
    expect(await reassignSurvivorTribeMember('L1', { userId: 'u1', toTribeId: 'beta', actorUserId: 'host' })).toEqual(expect.objectContaining({ ok: false, status: 404 }))
    expect(m.db.survivorTribeMember.deleteMany).not.toHaveBeenCalled()
  })
})
