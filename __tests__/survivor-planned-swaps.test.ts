// @vitest-environment node
/**
 * Planned swaps through the real seal/reveal service: a 2 → 3 swap creates its new tribe only at the
 * reveal and moves every huddle; back-to-original reactivates folded tribes and retires the extra one;
 * the runner step seals a scheduled week once and records a swap it cannot draw.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  survivorTribeSwap: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  survivorTribe: { findMany: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
  survivorLeagueConfig: { findUnique: vi.fn() },
  survivorTribeMember: { deleteMany: vi.fn(), create: vi.fn() },
  survivorTribeChatMember: { deleteMany: vi.fn(), create: vi.fn() },
  survivorPlayer: { findMany: vi.fn(), update: vi.fn() },
  survivorWeeklyScore: { findMany: vi.fn() },
  survivorChatChannel: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  survivorChatMessage: { create: vi.fn() },
  survivorAuditEntry: { create: vi.fn(), findFirst: vi.fn() },
  survivorGameState: { updateMany: vi.fn(), findUnique: vi.fn() },
  league: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/SurvivorLeagueConfig', () => ({ getSurvivorConfig: vi.fn(async () => ({ configId: 'cfg' })) }))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({ getActiveRosterIdsForLeague: vi.fn(async () => ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: vi.fn(async (_id: string, fn: (d: typeof db) => unknown) => fn(db)) }))
vi.mock('@/lib/survivor/survivorTribeChatProvisioning', () => ({ provisionSurvivorChats: vi.fn(async () => ({ leagueChannelId: 'lc' })) }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueSurvivorCoreNotification: vi.fn(async () => undefined) }))

import { revealDueTribeSwap, sealTribeSwap } from '@/lib/survivor/tribeSwapService'
import { ensureScheduledTribeSwap } from '@/lib/survivor/survivorScheduledSwaps'

beforeEach(() => {
  vi.clearAllMocks()
  db.league.findUnique.mockResolvedValue({ sport: 'NFL', language: 'en', settings: {} })
  db.survivorTribe.findMany.mockResolvedValue([
    { id: 'scorps', name: 'Scorps', slotIndex: 0, catalogId: 'scorpion', members: [{ rosterId: 'r1' }, { rosterId: 'r2' }, { rosterId: 'r3' }] },
    { id: 'shrooms', name: 'Shrooms', slotIndex: 1, catalogId: null, members: [{ rosterId: 'r4' }, { rosterId: 'r5' }, { rosterId: 'r6' }] },
  ])
  db.survivorTribeSwap.findFirst.mockResolvedValue(null)
  db.survivorTribeSwap.create.mockResolvedValue({ id: 'swap-9' })
  db.survivorChatChannel.findFirst.mockResolvedValue({ id: 'league-chat' })
  db.survivorChatChannel.findMany.mockResolvedValue([{ id: 'old-huddle' }])
  db.survivorPlayer.findMany.mockResolvedValue([1, 2, 3, 4, 5, 6].map((n) => ({ userId: `u${n}`, redraftRosterId: `r${n}` })))
  db.survivorLeagueConfig.findUnique.mockResolvedValue({ id: 'cfg' })
  db.survivorTribe.create.mockResolvedValue({ id: 'squids' })
})

describe('a 2 → 3 swap', () => {
  it('seals three tribes without creating the new one, then creates it at the reveal', async () => {
    await sealTribeSwap('L', 4, 'random_shuffle', new Date('2026-10-27T12:00:00Z'), { swap: { mode: 'resize', tribeCount: 3 }, actorUserId: 'host' })
    const created = db.survivorTribeSwap.create.mock.calls[0]![0].data
    expect(created.swapType).toBe('resize')
    expect(created.afterSnapshot.map((t: { tribeId: string }) => t.tribeId)).toEqual(['scorps', 'shrooms', 'new:1'])
    expect(created.newTribes).toMatchObject({ retire: [], created: 1, tribeCount: 3 })
    expect(db.survivorTribe.create).not.toHaveBeenCalled()
    expect(db.survivorChatMessage.create.mock.calls[0]![0].data.content).toContain('three tribes')
    expect(JSON.stringify(db.survivorAuditEntry.create.mock.calls)).not.toContain('"r1"')

    const pending = { id: 'swap-9', week: 4, swapType: 'resize', revealAt: new Date('2026-10-30T00:15:00Z'), revealedAt: null, beforeSnapshot: created.beforeSnapshot, afterSnapshot: created.afterSnapshot, newTribes: created.newTribes }
    db.survivorTribeSwap.findFirst.mockResolvedValue(pending)
    db.survivorTribeSwap.findUnique.mockResolvedValue(pending)
    expect(await revealDueTribeSwap('L', { now: new Date('2026-10-30T00:15:00Z') })).toEqual({ revealed: true, swapId: 'swap-9' })
    expect(db.survivorTribe.create).toHaveBeenCalledWith({ data: expect.objectContaining({ leagueId: 'L', configId: 'cfg', slotIndex: 2, isActive: true }), select: { id: true } })
    const moved = db.survivorTribeMember.create.mock.calls.map((c) => c[0].data.tribeId)
    expect(new Set(moved)).toEqual(new Set(['scorps', 'shrooms', 'squids']))
    expect(db.survivorGameState.updateMany).toHaveBeenCalledWith({ where: { leagueId: 'L' }, data: { activeTribeCount: 3 } })
    expect(db.survivorChatChannel.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['old-huddle'] } } }))
  })
})

describe('back to the original tribes', () => {
  it('reactivates the originals and retires the extra tribe at the reveal', async () => {
    const before = [{ tribeId: 'scorps', rosterIds: ['r1', 'r4'] }, { tribeId: 'shrooms', rosterIds: ['r2', 'r5'] }, { tribeId: 'squids', rosterIds: ['r3', 'r6'] }]
    const after = [{ tribeId: 'scorps', rosterIds: ['r1', 'r2', 'r3'] }, { tribeId: 'shrooms', rosterIds: ['r4', 'r5', 'r6'] }]
    const pending = { id: 'swap-10', week: 7, swapType: 'return_to_original', revealAt: new Date(0), revealedAt: null, beforeSnapshot: before, afterSnapshot: after, newTribes: { retire: ['squids'], created: 0 } }
    db.survivorTribeSwap.findFirst.mockResolvedValue(pending)
    db.survivorTribeSwap.findUnique.mockResolvedValue(pending)
    await revealDueTribeSwap('L', { now: new Date('2026-11-20T00:00:00Z') })
    expect(db.survivorTribe.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['scorps', 'shrooms'] } }, data: { isActive: true, phase: 'pre_merge' } })
    expect(db.survivorTribe.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['squids'] } }, data: { isActive: false, phase: 'dissolved' } })
    expect(db.survivorChatMessage.create.mock.calls.at(-1)![0].data.content).toBe('The original tribes are back. Idols travel with their owners, and your tribe chat has switched over.')
  })
})

describe('the runner step for scheduled swaps', () => {
  it('seals the week’s swap once, records one it cannot draw, and ignores weeks without one', async () => {
    db.league.findUnique.mockResolvedValue({ sport: 'NFL', language: 'en', settings: { survivorGovernance: { swapSchedule: [{ week: 6, mode: 'resize', tribeCount: 3 }] } } })
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', mergeTriggeredAt: null })
    db.survivorAuditEntry.findFirst.mockResolvedValue(null)
    expect(await ensureScheduledTribeSwap('L', 5)).toBe('none')
    expect(await ensureScheduledTribeSwap('L', 6)).toBe('sealed')
    expect(db.survivorTribeSwap.create).toHaveBeenCalledTimes(1)
    db.survivorTribeSwap.findFirst.mockResolvedValue({ id: 'swap-9' })
    expect(await ensureScheduledTribeSwap('L', 6)).toBe('already_drawn')

    db.survivorTribeSwap.findFirst.mockResolvedValue(null)
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'post_merge', mergeTriggeredAt: new Date() })
    expect(await ensureScheduledTribeSwap('L', 6)).toBe('skipped')
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'scheduled_swap_skipped', week: 6 }) })
  })
})
