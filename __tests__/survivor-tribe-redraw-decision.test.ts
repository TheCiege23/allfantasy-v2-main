// @vitest-environment node
/**
 * The commissioner's answer to a tribe-imbalance recommendation: random redraw (the default),
 * reassign by hand (host only), merge now, or postpone. When nobody answers before the next
 * council, the default runs on its own as Chimmy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { db, shuffle, advance, alert } = vi.hoisted(() => ({
  db: {
    survivorCommissionerAction: { findFirst: vi.fn(), create: vi.fn() },
    survivorAuditEntry: { create: vi.fn() },
    league: { findUnique: vi.fn() },
    survivorGameState: { findUnique: vi.fn() },
    survivorTribe: { findMany: vi.fn() },
    survivorPlayer: { findMany: vi.fn() },
  },
  shuffle: vi.fn(),
  advance: vi.fn(),
  alert: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/survivor/survivorSetupTransaction', () => ({ withSurvivorSetupTransaction: (_leagueId: string, work: (tx: typeof db) => Promise<unknown>) => work(db) }))
vi.mock('@/lib/survivor/SurvivorTribeShuffleEngine', () => ({ runShuffle: shuffle }))
vi.mock('@/lib/survivor/gameStateMachine', () => ({ advancePhase: advance }))
vi.mock('@/lib/survivor/survivorCommissionerAlerts', () => ({ notifySurvivorCommissionerOnce: alert }))

import { autoApplyPendingTribeRedraw, getPendingTribeRedraw, rebalanceTribesBeforeCouncil, respondToTribeRedraw } from '@/lib/survivor/survivorTribeRedrawDecision'

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

describe('rebalanceTribesBeforeCouncil (never freeze, never a two-manager tie)', () => {
  const cast = (sizes: number[]) => sizes.flatMap((size, slot) => Array.from({ length: size }, () => ({ tribeId: `t${slot + 1}` })))
  beforeEach(() => {
    vi.clearAllMocks()
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', mergeTriggeredAt: null, activeCouncilId: null })
    db.survivorTribe.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }])
    db.survivorCommissionerAction.findFirst.mockResolvedValue(null)
    shuffle.mockResolvedValue({ ok: true })
    advance.mockResolvedValue({})
    alert.mockResolvedValue({ sent: true })
  })

  it('leaves tribes alone while every tribe has three or more managers', async () => {
    db.survivorPlayer.findMany.mockResolvedValue(cast([4, 3, 3, 3]))
    expect(await rebalanceTribesBeforeCouncil('league', 8)).toEqual({ action: 'none' })
    expect(shuffle).not.toHaveBeenCalled()
    expect(advance).not.toHaveBeenCalled()
  })

  // Self-votes are off, so two managers can only vote for each other: every such council is a tie.
  it('redraws when a tribe is down to two managers, into tribes of at least three', async () => {
    db.survivorPlayer.findMany.mockResolvedValue(cast([4, 3, 3, 2]))
    expect(await rebalanceTribesBeforeCouncil('league', 5)).toEqual({ action: 'redrawn', tribeCount: 4 })
    expect(alert).toHaveBeenCalledWith('league', 'tribes_rebalanced', expect.objectContaining({ dedupeKey: '5:redrawn', body: expect.stringContaining('down to 2 managers') }))
  })

  it('starts the merge instead when the cast cannot fill two tribes of three', async () => {
    db.survivorTribe.findMany.mockResolvedValue([{ id: 't1' }, { id: 't2' }])
    db.survivorPlayer.findMany.mockResolvedValue(cast([3, 2]))
    expect(await rebalanceTribesBeforeCouncil('league', 11)).toEqual({ action: 'merged' })
    expect(shuffle).not.toHaveBeenCalled()
    expect(advance).toHaveBeenCalledWith('league', 'automatic', undefined, { toPhase: 'merge', notes: 'tribe_too_small_merge_now' })
  })

  it('redraws as Chimmy the moment a tribe is down to one manager, and tells the commissioner once', async () => {
    db.survivorPlayer.findMany.mockResolvedValue(cast([3, 3, 2, 1]))
    expect(await rebalanceTribesBeforeCouncil('league', 9)).toEqual({ action: 'redrawn', tribeCount: 3 })
    expect(shuffle).toHaveBeenCalledWith('league', { actorUserId: 'survivor-ai-host' })
    expect(alert).toHaveBeenCalledWith('league', 'tribes_rebalanced', expect.objectContaining({ dedupeKey: '9:redrawn', body: expect.stringContaining('3 tribes') }))
  })

  it('answers a pending recommendation with the redraw instead of leaving it open', async () => {
    db.survivorPlayer.findMany.mockResolvedValue(cast([3, 3, 2, 0]))
    db.survivorCommissionerAction.findFirst.mockImplementation(async ({ where }) =>
      where.actionType === 'sit_out_shuffle_recommendation' ? { ...recommendation, week: 9 } : null)
    expect(await rebalanceTribesBeforeCouncil('league', 9)).toEqual({ action: 'redrawn', tribeCount: 2 })
    expect(shuffle).toHaveBeenCalledWith('league', { db, actorUserId: 'survivor-ai-host', recommendationId: 'recommendation' })
  })

  it('starts the merge when no redraw can run', async () => {
    db.survivorPlayer.findMany.mockResolvedValue(cast([3, 3, 2, 1]))
    shuffle.mockResolvedValue({ ok: false, error: 'Current tribe assignments do not match the active cast.' })
    expect(await rebalanceTribesBeforeCouncil('league', 9)).toEqual({ action: 'merged' })
    expect(advance).toHaveBeenCalledWith('league', 'automatic', undefined, { toPhase: 'merge', notes: 'tribe_too_small_merge_now' })
    expect(alert).toHaveBeenCalledWith('league', 'tribes_rebalanced', expect.objectContaining({ dedupeKey: '9:merged' }))
  })

  it('does nothing after the merge or while a council is open', async () => {
    db.survivorPlayer.findMany.mockResolvedValue(cast([3, 3, 2, 1]))
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'merge', mergeTriggeredAt: new Date(), activeCouncilId: null })
    expect(await rebalanceTribesBeforeCouncil('league', 9)).toEqual({ action: 'none' })
    db.survivorGameState.findUnique.mockResolvedValue({ phase: 'pre_merge', mergeTriggeredAt: null, activeCouncilId: 'open' })
    expect(await rebalanceTribesBeforeCouncil('league', 9)).toEqual({ action: 'none' })
    expect(shuffle).not.toHaveBeenCalled()
  })
})
