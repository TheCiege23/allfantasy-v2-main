import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Cancel and edit are guarded on `pending` in the WRITE itself (2026-11-26). They read the claim as
 * pending and then wrote by id alone, so a cancel landing after the run awarded the claim turned it
 * "cancelled" while the player stayed on the roster, and an edit rewrote a settled claim.
 */

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: { waiverClaim: { findFirst: h.findFirst, updateMany: h.updateMany, findUnique: h.findUnique, update: h.update } },
}))
vi.mock('@/lib/ai-learning-system/recordEvent', () => ({ recordAfLearningEvent: vi.fn() }))
vi.mock('@/lib/guillotine/guillotineGuard', () => ({ isRosterChopped: async () => false }))
vi.mock('@/lib/survivor/SurvivorRosterState', () => ({ isRosterCurrentlyEliminated: async () => false }))
vi.mock('@/lib/devy/waiver/DevyWaiverRules', () => ({ validateDevyWaiverClaim: async () => ({ allowed: true }) }))
vi.mock('@/lib/survivor/SurvivorEffectEngine', () => ({ isWaiverFrozenForRoster: async () => false }))
vi.mock('@/lib/waiver-wire/settings-service', () => ({ getEffectiveLeagueWaiverSettings: async () => ({}) }))
vi.mock('@/lib/waiver-wire/waiver-state-service', () => ({ getLeagueWaiverState: async () => null }))
vi.mock('@/lib/waiver-wire/transaction-eligibility', () => ({ assertWaiverClaimEligibility: async () => undefined }))
vi.mock('@/lib/waiver-wire/daily-schedule-gate', () => ({ loadDailyTransactionPolicy: async () => null }))
vi.mock('@/lib/waiver-wire/season-phase-gate', () => ({ loadWaiverPhasePolicy: async () => null }))

import { cancelClaim, updateClaim } from '@/lib/waiver-wire/claim-service'

const pendingRow = { id: 'c1', leagueId: 'L', rosterId: 'R', addPlayerId: 'X', dropPlayerId: null, faabBid: 5, status: 'pending', metadata: null }

beforeEach(() => {
  vi.clearAllMocks()
  h.findFirst.mockResolvedValue(pendingRow)
})

describe('cancel', () => {
  it('cancels a pending claim, and only while it is still pending', async () => {
    h.updateMany.mockResolvedValue({ count: 1 })
    expect(await cancelClaim('c1', 'L', 'R')).toBe(true)
    expect(h.updateMany).toHaveBeenCalledWith({ where: { id: 'c1', leagueId: 'L', rosterId: 'R', status: 'pending' }, data: { status: 'cancelled' } })
    expect(h.update).not.toHaveBeenCalled()
  })

  it('reports false when the run settled the claim between the read and the write', async () => {
    h.updateMany.mockResolvedValue({ count: 0 })
    expect(await cancelClaim('c1', 'L', 'R')).toBe(false)
  })
})

describe('edit', () => {
  it('edits a pending claim and returns the row', async () => {
    h.updateMany.mockResolvedValue({ count: 1 })
    h.findUnique.mockResolvedValue({ ...pendingRow, faabBid: 9 })
    expect(await updateClaim('c1', 'L', 'R', { faabBid: 9 })).toMatchObject({ faabBid: 9 })
    expect(h.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: 'c1', status: 'pending' }, data: { faabBid: 9 } })
  })

  it('returns null, writing nothing, when the claim was settled first', async () => {
    h.updateMany.mockResolvedValue({ count: 0 })
    expect(await updateClaim('c1', 'L', 'R', { faabBid: 9 })).toBeNull()
    expect(h.update).not.toHaveBeenCalled()
  })
})
