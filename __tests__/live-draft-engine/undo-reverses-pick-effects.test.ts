/**
 * undoLastPick reverses what the pick did, not just the pick row (2026-11-15):
 *   - an auction pick's winning bid goes back to the winner's budget;
 *   - an NBA devy / C2C college pick's draft right is removed, so the player can be drafted again.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/draft-archive/events', () => ({ recordArchiveEvent: vi.fn().mockResolvedValue({}) }))
const rights = vi.hoisted(() => ({ removeDraftCollegeRight: vi.fn(async () => {}) }))
vi.mock('@/lib/devy/nbaDraftRights', () => rights)

const ctx = vi.hoisted(() => {
  const state = {
    session: {} as Record<string, unknown>,
    pick: {} as Record<string, unknown>,
    updates: [] as Record<string, unknown>[],
    audits: [] as Record<string, unknown>[],
    deleted: [] as string[],
  }
  const tx = {
    draftPick: { delete: vi.fn(async ({ where }: { where: { id: string } }) => { state.deleted.push(where.id) }) },
    draftSession: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.updates.push(data); return {} }) },
    draftPickAuditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { state.audits.push(data) }) },
  }
  const prisma = {
    league: { findUnique: vi.fn(async () => ({ settings: {} })) },
    draftSession: { findFirst: vi.fn(async () => ({ ...state.session, picks: [state.pick] })) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  }
  return { state, tx, prisma }
})
vi.mock('@/lib/prisma', () => ({ prisma: ctx.prisma }))

const { undoLastPick, refundAuctionBudget } = await import('@/lib/live-draft-engine/DraftSessionService')

beforeEach(() => {
  vi.clearAllMocks()
  ctx.state.updates = []
  ctx.state.audits = []
  ctx.state.deleted = []
  ctx.state.session = { id: 's1', leagueId: 'L1', status: 'in_progress', timerSeconds: null, draftType: 'snake', auctionBudgets: null, version: 1 }
  ctx.state.pick = { id: 'p9', overall: 9, round: 1, slot: 9, rosterId: 'r2', playerId: 'nfl:1', playerName: 'A Player', position: 'RB', team: 'KC', source: 'user', amount: null, assetType: 'player', pickMetadata: null }
})

describe('undo an auction pick', () => {
  it('gives the winning bid back to the winner and records the refund', async () => {
    ctx.state.session = { ...ctx.state.session, draftType: 'auction', auctionBudgets: { r1: 200, r2: 158 } }
    ctx.state.pick = { ...ctx.state.pick, amount: 42 }
    expect(await undoLastPick('L1', { actorUserId: 'commish' })).toBe(true)
    expect(ctx.state.updates[0]!.auctionBudgets).toEqual({ r1: 200, r2: 200 })
    expect(ctx.state.audits[0]!.metadata).toMatchObject({ refundedAuctionAmount: 42 })
    expect(ctx.state.deleted).toEqual(['p9'])
  })

  it('a snake draft pick with an amount on it refunds nothing', async () => {
    ctx.state.session = { ...ctx.state.session, auctionBudgets: { r2: 10 } }
    ctx.state.pick = { ...ctx.state.pick, amount: 42 }
    await undoLastPick('L1')
    expect(ctx.state.updates[0]).not.toHaveProperty('auctionBudgets')
  })

  it('an unreadable budget map is left alone rather than invented', () => {
    expect(refundAuctionBudget(null, 'r2', 5)).toBeNull()
    expect(refundAuctionBudget({ r1: 10 }, 'r2', 5)).toBeNull()
    expect(refundAuctionBudget([1, 2], 'r2', 5)).toBeNull()
    expect(refundAuctionBudget({ r2: 3 }, 'r2', 5)).toEqual({ r2: 8 })
  })
})

describe('undo a college pick', () => {
  it('removes the draft right inside the same transaction, before the pick goes', async () => {
    ctx.state.pick = { ...ctx.state.pick, playerId: 'espn:ncaab:77', assetType: 'c2c_college', pickMetadata: { draftCollegeRightsId: 'dr1' } }
    await undoLastPick('L1', { actorUserId: 'commish' })
    expect(rights.removeDraftCollegeRight).toHaveBeenCalledWith(ctx.tx, 'L1', expect.objectContaining({ id: 'p9', assetType: 'c2c_college', rosterId: 'r2' }))
    expect(rights.removeDraftCollegeRight.mock.invocationCallOrder[0]).toBeLessThan(ctx.tx.draftPick.delete.mock.invocationCallOrder[0]!)
  })

  it('a right that changed hands stops the undo, and the pick stays', async () => {
    rights.removeDraftCollegeRight.mockRejectedValueOnce(Object.assign(new Error('College ownership changed'), { status: 409 }))
    await expect(undoLastPick('L1')).rejects.toThrow('College ownership changed')
    expect(ctx.state.deleted).toEqual([])
  })
})
