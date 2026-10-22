import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The minute draft tick, for native guillotine leagues: start only when full; otherwise hold. */

const m = vi.hoisted(() => ({
  due: vi.fn(), session: vi.fn(), pool: vi.fn(), prewarm: vi.fn(), start: vi.fn(), lock: vi.fn(),
  notifyStart: vi.fn(), enqueue: vi.fn(), priorNotice: vi.fn(), league: vi.fn(),
  loadState: vi.fn(), plan: vi.fn(), hold: vi.fn(), prepare: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    leagueSettings: { findMany: m.due }, draftSession: { findFirst: m.session },
    survivorNotification: { findFirst: m.priorNotice }, league: { findUnique: m.league },
  },
}))
vi.mock('@/lib/draft-notifications', () => ({ notifyDraftStartingSoon: m.notifyStart }))
vi.mock('@/lib/survivor/notificationEngine', () => ({ enqueueNotification: m.enqueue }))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({
  getDraftPoolReadiness: m.pool, triggerDraftPoolPrewarmBackground: m.prewarm,
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ startDraftSession: m.start }))
vi.mock('@/lib/draft/draftLock', () => ({ withControlLock: m.lock }))
vi.mock('@/lib/guillotine/lateStartSeats', () => ({
  loadGuillotineSeatState: m.loadState,
  planGuillotineScheduledDraft: m.plan,
  holdGuillotineScheduledDraft: m.hold,
  prepareGuillotineSeatsForStart: m.prepare,
}))

import { startScheduledSurvivorDrafts } from '@/lib/survivor/startScheduledSurvivorDrafts'

const NOW = new Date('2026-10-19T00:01:00Z')
const STATE = { leagueId: 'g1', configuredSize: 16, claimed: 2 }

describe('scheduled native Guilly draft', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.due.mockResolvedValue([{ leagueId: 'g1', league: { platform: 'allfantasy' } }])
    m.session.mockResolvedValue({ status: 'pre_draft', sessionKind: 'live', sleeperDraftId: null })
    m.pool.mockResolvedValue({ ready: true })
    m.start.mockResolvedValue({ ok: true })
    m.lock.mockImplementation(async (_leagueId: string, action: () => Promise<unknown>) => ({ acquired: true, value: await action() }))
    m.notifyStart.mockResolvedValue(undefined)
    m.loadState.mockResolvedValue(STATE)
    m.hold.mockResolvedValue('rolled')
    m.prepare.mockResolvedValue(null)
  })

  it('full at the scheduled time: starts as before', async () => {
    m.plan.mockResolvedValue({ action: 'start', seats: 16, claimed: 16, shrinkTo: null, claimedExceedsSupported: false, supportedSeats: 16 })
    expect(await startScheduledSurvivorDrafts(NOW)).toMatchObject({ started: 1, errors: [] })
    expect(m.start).toHaveBeenCalledOnce()
    expect(m.hold).not.toHaveBeenCalled()
  })

  it('not full: does not start; rolls through the control lock', async () => {
    const plan = { action: 'roll', from: new Date('2026-10-19T00:00:00Z'), to: new Date('2026-10-26T00:00:00Z'), seats: 16, claimed: 2, previousSeats: 16 }
    m.plan.mockResolvedValue(plan)
    expect(await startScheduledSurvivorDrafts(NOW)).toMatchObject({ started: 0, skipped: 1, rolled: 1, errors: [] })
    expect(m.start).not.toHaveBeenCalled()
    expect(m.pool).not.toHaveBeenCalled()
    expect(m.lock).toHaveBeenCalledWith('g1', expect.any(Function))
    expect(m.hold).toHaveBeenCalledWith(STATE, plan)
    expect(m.notifyStart).not.toHaveBeenCalled()
  })

  it('below the floor: does not start', async () => {
    m.plan.mockResolvedValue({ action: 'blocked_floor', seats: 3, claimed: 2 })
    m.hold.mockResolvedValue('blocked')
    expect(await startScheduledSurvivorDrafts(NOW)).toMatchObject({ started: 0, skipped: 1 })
    expect(m.start).not.toHaveBeenCalled()
  })

  it('full at the reduced count: removes seats inside the lock, then starts', async () => {
    const plan = { action: 'start', seats: 15, claimed: 15, shrinkTo: 15, claimedExceedsSupported: false, supportedSeats: 15 }
    m.plan.mockResolvedValue(plan)
    m.prepare.mockResolvedValue({ ok: true, removed: ['r16'], leagueSize: 15 })
    expect(await startScheduledSurvivorDrafts(NOW)).toMatchObject({ started: 1 })
    expect(m.prepare).toHaveBeenCalledWith(STATE, plan)
    expect(m.prepare.mock.invocationCallOrder[0]).toBeLessThan(m.start.mock.invocationCallOrder[0])
  })

  it('a seat removal that is refused does not start the draft', async () => {
    m.plan.mockResolvedValue({ action: 'start', seats: 15, claimed: 15, shrinkTo: 15, claimedExceedsSupported: false, supportedSeats: 15 })
    m.prepare.mockResolvedValue({ ok: false, reason: 'draft_has_picks' })
    const summary = await startScheduledSurvivorDrafts(NOW)
    expect(summary.started).toBe(0)
    expect(summary.errors[0]).toMatchObject({ leagueId: 'g1', error: expect.stringContaining('draft_has_picks') })
    expect(m.start).not.toHaveBeenCalled()
  })

  it('every other league (no guillotine state) starts exactly as before', async () => {
    m.loadState.mockResolvedValue(null)
    expect(await startScheduledSurvivorDrafts(NOW)).toMatchObject({ started: 1 })
    expect(m.plan).not.toHaveBeenCalled()
    expect(m.hold).not.toHaveBeenCalled()
    expect(m.prepare).not.toHaveBeenCalled()
    expect(m.start).toHaveBeenCalledOnce()
  })
})
