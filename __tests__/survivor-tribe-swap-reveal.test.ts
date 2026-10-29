import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorTribeSwap: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  survivorTribe: { findMany: vi.fn(), updateMany: vi.fn() },
  survivorTribeMember: { deleteMany: vi.fn(), create: vi.fn() },
  survivorTribeChatMember: { deleteMany: vi.fn(), create: vi.fn() },
  survivorPlayer: { findMany: vi.fn(), update: vi.fn() },
  survivorChatChannel: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  survivorChatMessage: { create: vi.fn() },
  survivorAuditEntry: { create: vi.fn() },
  league: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn(async () => ({ configId: 'cfg' })) }))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({ getActiveRosterIdsForLeague: vi.fn(async () => ['r1', 'r2', 'r3', 'r4']) }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: vi.fn(async (_id: string, fn: (d: typeof db) => unknown) => fn(db)) }))
vi.mock('@/lib/survivor/survivorTribeChatProvisioning', () => ({ provisionSurvivorChats: vi.fn(async () => ({ leagueChannelId: 'lc' })) }))

import {
  drawSwapAssignment, isSwapSealed, mergeNameSuggestions, swapHeadline, swapMemberStatuses, swapViewForClient, tallyMergeNameVotes,
} from '@/lib/survivor/tribeSwapReveal'
import { revealDueTribeSwap, sealTribeSwap } from '@/lib/survivor/tribeSwapService'

const before = [{ tribeId: 'vela', rosterIds: ['r1', 'r2'] }, { tribeId: 'koa', rosterIds: ['r3', 'r4'] }]
const after = [{ tribeId: 'vela', rosterIds: ['r1', 'r3'] }, { tribeId: 'koa', rosterIds: ['r2', 'r4'] }]

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findUnique.mockResolvedValue({ sport: 'NBA' })
  db.survivorTribe.findMany.mockResolvedValue([
    { id: 'vela', members: [{ rosterId: 'r1' }, { rosterId: 'r2' }] },
    { id: 'koa', members: [{ rosterId: 'r3' }, { rosterId: 'r4' }] },
  ])
  db.survivorTribeSwap.create.mockResolvedValue({ id: 'swap-1' })
  db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'league-chat' })
  db.survivorChatChannel.findMany.mockResolvedValue([{ id: 'old-vela-chat' }])
  db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'u2', redraftRosterId: 'r2' }, { userId: 'u3', redraftRosterId: 'r3' }])
})

describe('pure swap rules', () => {
  it('deals every manager into the same tribes with sizes within one', () => {
    const drawn = drawSwapAssignment(before, () => 0)
    expect(drawn.map((t) => t.tribeId)).toEqual(['vela', 'koa'])
    expect(drawn.flatMap((t) => t.rosterIds).sort()).toEqual(['r1', 'r2', 'r3', 'r4'])
    expect(drawn.map((t) => t.rosterIds.length)).toEqual([2, 2])
  })
  it('From / Stays statuses and the headline', () => {
    const statuses = swapMemberStatuses(before, after)
    expect(statuses.find((s) => s.rosterId === 'r3')).toEqual({ rosterId: 'r3', tribeId: 'vela', fromTribeId: 'koa', moved: true })
    expect(statuses.find((s) => s.rosterId === 'r1')!.moved).toBe(false)
    expect(swapHeadline(4)).toBe('Four managers changed tribes')
    expect(swapHeadline(1)).toBe('One manager changed tribes')
  })
  it('a sealed swap exposes only the current tribes and the reveal time', () => {
    const sealed = swapViewForClient({ week: 5, revealAt: new Date('2026-11-02T23:00:00Z'), revealedAt: null, beforeSnapshot: before, afterSnapshot: after })!
    expect(sealed.sealed).toBe(true)
    expect(sealed.after).toBeNull()
    expect(sealed.members).toBeNull()
    expect(JSON.stringify(sealed)).not.toContain('"r3"]},{"tribeId":"koa","rosterIds":["r2"')
    const open = swapViewForClient({ week: 5, revealAt: new Date(0), revealedAt: new Date(1), beforeSnapshot: before, afterSnapshot: after })!
    expect(open.after).toEqual(after)
    expect(open.movedCount).toBe(2)
    // Legacy rows (no revealAt) were applied immediately and are not sealed.
    expect(isSwapSealed({ revealAt: null, revealedAt: null })).toBe(false)
  })
  it('suggests three unused catalogue names, stable per league', () => {
    const names = ['Kaniva', 'Koa', 'Honoa', 'Vela', 'Mahina', 'Tavaka', 'Oruna']
    const picks = mergeNameSuggestions('league-1', names, ['Vela', 'koa'])
    expect(picks).toHaveLength(3)
    expect(picks).not.toContain('Vela')
    expect(picks).not.toContain('Koa')
    expect(mergeNameSuggestions('league-1', names, ['Vela', 'koa'])).toEqual(picks)
    expect(tallyMergeNameVotes(['A', 'B', 'C'], ['B', 'C', 'B', 'zzz'])).toBe('B')
    expect(tallyMergeNameVotes(['A', 'B', 'C'], ['C', 'B'])).toBe('B')
    expect(tallyMergeNameVotes(['A', 'B', 'C'], [])).toBeNull()
  })
})

describe('sealing and revealing the swap', () => {
  it('seals the draw without touching memberships, chats, or the audit trail contents', async () => {
    db.survivorTribeSwap.findFirst.mockResolvedValue(null)
    const now = new Date('2026-11-01T12:00:00Z') // Sunday
    const sealed = await sealTribeSwap('L', 5, 'random_shuffle', now)
    expect(sealed.id).toBe('swap-1')
    expect(sealed.revealAt.getTime()).toBeGreaterThan(now.getTime())
    const created = db.survivorTribeSwap.create.mock.calls[0]![0].data
    expect(created.revealAt).toEqual(sealed.revealAt)
    expect(db.survivorTribeMember.deleteMany).not.toHaveBeenCalled()
    expect(db.survivorTribeMember.create).not.toHaveBeenCalled()
    expect(db.survivorPlayer.update).not.toHaveBeenCalled()
    expect(db.survivorChatChannel.updateMany).not.toHaveBeenCalled()
    expect(JSON.stringify(db.survivorAuditEntry.create.mock.calls)).not.toContain('afterSnapshot')
    expect(JSON.stringify(db.survivorAuditEntry.create.mock.calls)).not.toContain('"r1"')
  })
  it('does not reveal before the lineup lock, then applies the draw and switches chats', async () => {
    const pending = { id: 'swap-1', week: 5, revealAt: new Date('2026-11-02T23:00:00Z'), revealedAt: null, beforeSnapshot: before, afterSnapshot: after }
    db.survivorTribeSwap.findFirst.mockResolvedValue(pending)
    db.survivorTribeSwap.findUnique.mockResolvedValue(pending)
    expect(await revealDueTribeSwap('L', { now: new Date('2026-11-02T22:59:00Z') })).toEqual({ revealed: false })
    expect(db.survivorTribeMember.create).not.toHaveBeenCalled()

    expect(await revealDueTribeSwap('L', { now: new Date('2026-11-02T23:00:00Z') })).toEqual({ revealed: true, swapId: 'swap-1' })
    expect(db.survivorTribeMember.create).toHaveBeenCalledWith({ data: { tribeId: 'vela', rosterId: 'r3', isLeader: false } })
    expect(db.survivorPlayer.update).toHaveBeenCalledWith({ where: { leagueId_userId: { leagueId: 'L', userId: 'u3' } }, data: { tribeId: 'vela', canAccessTribeChat: true } })
    expect(db.survivorChatChannel.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['old-vela-chat'] } } }))
    expect(db.survivorTribeSwap.update).toHaveBeenCalledWith({ where: { id: 'swap-1' }, data: { revealedAt: new Date('2026-11-02T23:00:00Z') } })
  })
})
