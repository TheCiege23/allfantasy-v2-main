// @vitest-environment node
/**
 * The commissioner's answer to a tribe-imbalance recommendation: random redraw (the default),
 * reassign by hand (host only), merge now, or postpone. When nobody answers before the next
 * council, the default runs on its own as Chimmy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, shuffle, advance } = vi.hoisted(() => ({
  db: {
    survivorCommissionerAction: { findFirst: vi.fn(), create: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    league: { findUnique: vi.fn() },
  },
  shuffle: vi.fn(),
  advance: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_leagueId: string, work: (tx: typeof db) => Promise<unknown>) => work(db) }))
vi.mock('@/lib/survivor/SurvivorTribeShuffleEngine', () => ({ runShuffle: shuffle }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: advance }))

import { autoApplyPendingTribeRedraw, getPendingTribeRedraw, respondToTribeRedraw } from '@/lib/survivor/survivorTribeRedrawDecision'

const recommendation = { id: 'recommendation', week: 4, newState: { minTribeSize: 2, maxTribeSize: 5, tribeSizes: [{ tribeId: 'a', tribeName: 'Alpha', activeCount: 2 }, { tribeId: 'b', tribeName: 'Beta', activeCount: 5 }] } }

describe('tribe redraw commissioner decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.survivorCommissionerAction.findFirst.mockImplementation(async ({ where }) =>
      where.actionType === 'sit_out_shuffle_recommendation' ? recommendation : null)
    db.league.findUnique.mockResolvedValue({ settings: { commissionerParticipationMode: 'non_participating_host' } })
    shuffle.mockResolvedValue({ ok: true })
    advance.mockResolvedValue({})
  })

  it('shows a pending system recommendation with counts and the three choices, not teammate picks', async () => {
    expect(await getPendingTribeRedraw('league')).toEqual({
      id: 'recommendation', week: 4, minTribeSize: 2, maxTribeSize: 5,
      tribeSizes: [{ tribeId: 'a', tribeName: 'Alpha', activeCount: 2 }, { tribeId: 'b', tribeName: 'Beta', activeCount: 5 }],
      defaultDecision: 'approve', options: ['approve', 'postpone', 'manual', 'merge'],
    })
    expect(db.survivorCommissionerAction.findFirst.mock.calls[1][0].where.actionType).toEqual({ in: ['sit_out_shuffle_approved', 'sit_out_shuffle_postponed', 'sit_out_shuffle_manual', 'sit_out_shuffle_merged'] })
  })

  it('approves one random redraw without accepting a commissioner seed or mapping', async () => {
    expect(await respondToTribeRedraw('league', 'commish', 'recommendation', 'approve')).toEqual({ ok: true, decision: 'approve', automatic: false })
    expect(shuffle).toHaveBeenCalledWith('league', { db, actorUserId: 'commish', recommendationId: 'recommendation' })
    expect(db.survivorCommissionerAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'sit_out_shuffle_approved', description: 'recommendation', wasConfirmed: true }) })
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'tribe_redraw_approved', actorUserId: 'commish' }) })
    expect(advance).not.toHaveBeenCalled()
  })

  it('postpones without changing teams and rejects repeated decisions', async () => {
    expect(await respondToTribeRedraw('league', 'commish', 'recommendation', 'postpone')).toEqual({ ok: true, decision: 'postpone', automatic: false })
    expect(shuffle).not.toHaveBeenCalled()
    db.survivorCommissionerAction.findFirst.mockResolvedValue({ id: 'prior' })
    expect(await respondToTribeRedraw('league', 'commish', 'recommendation', 'approve')).toEqual(expect.objectContaining({ ok: false, status: 409 }))
  })

  it('reassign by hand is for a non-participating host only, and moves nobody by itself', async () => {
    db.league.findUnique.mockResolvedValue({ settings: { commissionerParticipationMode: 'participating_player' } })
    expect(await respondToTribeRedraw('league', 'commish', 'recommendation', 'manual')).toEqual(expect.objectContaining({ ok: false, status: 403 }))
    expect(db.survivorCommissionerAction.create).not.toHaveBeenCalled()

    db.league.findUnique.mockResolvedValue({ settings: { commissionerParticipationMode: 'non_participating_host' } })
    expect(await respondToTribeRedraw('league', 'host', 'recommendation', 'manual')).toEqual({ ok: true, decision: 'manual', automatic: false })
    expect(shuffle).not.toHaveBeenCalled()
    expect(db.survivorCommissionerAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'sit_out_shuffle_manual' }) })
  })

  it('merge now records the decision and then advances the season to the merge', async () => {
    expect(await respondToTribeRedraw('league', 'commish', 'recommendation', 'merge')).toEqual({ ok: true, decision: 'merge', automatic: false, mergeStarted: true })
    expect(db.survivorCommissionerAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'sit_out_shuffle_merged' }) })
    expect(advance).toHaveBeenCalledWith('league', 'commissioner', 'commish', { toPhase: 'merge', notes: 'tribe_imbalance_merge_now' })
    expect(shuffle).not.toHaveBeenCalled()
  })
})

describe('autoApplyPendingTribeRedraw (the default when nobody answers)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.survivorCommissionerAction.findFirst.mockImplementation(async ({ where }) =>
      where.actionType === 'sit_out_shuffle_recommendation' ? recommendation : null)
    shuffle.mockResolvedValue({ ok: true })
  })

  it('does nothing without a pending recommendation, or in the recommendation week itself', async () => {
    db.survivorCommissionerAction.findFirst.mockResolvedValue(null)
    expect(await autoApplyPendingTribeRedraw('league', 5)).toEqual({ applied: false, reason: 'none_pending' })
    db.survivorCommissionerAction.findFirst.mockImplementation(async ({ where }) => where.actionType === 'sit_out_shuffle_recommendation' ? recommendation : null)
    expect(await autoApplyPendingTribeRedraw('league', 4)).toEqual({ applied: false, reason: 'commissioner_window_open' })
    expect(shuffle).not.toHaveBeenCalled()
  })

  it('runs the random redraw as Chimmy once a later council is about to open', async () => {
    expect(await autoApplyPendingTribeRedraw('league', 5)).toEqual({ applied: true })
    expect(shuffle).toHaveBeenCalledWith('league', { db, actorUserId: 'survivor-ai-host', recommendationId: 'recommendation' })
    expect(db.survivorCommissionerAction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actionType: 'sit_out_shuffle_approved', commissionerId: 'survivor-ai-host', wasConfirmed: false, newState: { decision: 'approve', automatic: true } }) })
    expect(db.survivorAuditEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'tribe_redraw_auto_applied', actorUserId: null }) })
  })

  it('leaves a redraw that cannot run for the commissioner', async () => {
    shuffle.mockResolvedValue({ ok: false, error: 'A redraw is available only between councils before the merge.' })
    expect(await autoApplyPendingTribeRedraw('league', 5)).toEqual({ applied: false, reason: 'A redraw is available only between councils before the merge.' })
    expect(db.survivorCommissionerAction.create).not.toHaveBeenCalled()
  })
})
