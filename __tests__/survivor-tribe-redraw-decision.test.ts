import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, shuffle } = vi.hoisted(() => ({
  db: {
    survivorCommissionerAction: { findFirst: vi.fn(), create: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
  },
  shuffle: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_leagueId: string, work: (tx: typeof db) => Promise<unknown>) => work(db) }))
vi.mock('@/lib/survivor/SurvivorTribeShuffleEngine', () => ({ runShuffle: shuffle }))

import { getPendingTribeRedraw, respondToTribeRedraw } from '@/lib/survivor/survivorTribeRedrawDecision'

describe('tribe redraw commissioner decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.survivorCommissionerAction.findFirst.mockImplementation(async ({ where }) =>
      where.actionType === 'sit_out_shuffle_recommendation'
        ? { id: 'recommendation', week: 4, newState: { minTribeSize: 2, maxTribeSize: 5 } }
        : null)
    shuffle.mockResolvedValue({ ok: true })
  })

  it('shows a pending system recommendation with counts, not teammate choices', async () => {
    expect(await getPendingTribeRedraw('league')).toEqual({ id: 'recommendation', week: 4, minTribeSize: 2, maxTribeSize: 5 })
  })

  it('approves one random redraw without accepting a commissioner seed or mapping', async () => {
    expect(await respondToTribeRedraw('league', 'commish', 'recommendation', 'approve')).toEqual({ ok: true, decision: 'approve' })
    expect(shuffle).toHaveBeenCalledWith('league', { db, actorUserId: 'commish', recommendationId: 'recommendation' })
    expect(db.survivorCommissionerAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'sit_out_shuffle_approved', description: 'recommendation' }) })
  })

  it('postpones without changing teams and rejects repeated decisions', async () => {
    expect(await respondToTribeRedraw('league', 'commish', 'recommendation', 'postpone')).toEqual({ ok: true, decision: 'postpone' })
    expect(shuffle).not.toHaveBeenCalled()
    db.survivorCommissionerAction.findFirst.mockResolvedValue({ id: 'prior' })
    expect(await respondToTribeRedraw('league', 'commish', 'recommendation', 'approve')).toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })
})
