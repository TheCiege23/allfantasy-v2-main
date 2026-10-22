import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  due: vi.fn(), session: vi.fn(), pool: vi.fn(), prewarm: vi.fn(), start: vi.fn(), lock: vi.fn(),
  notifyStart: vi.fn(), enqueue: vi.fn(), priorNotice: vi.fn(), league: vi.fn(),
  readiness: vi.fn(), alert: vi.fn(),
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
vi.mock('@/lib/survivor/survivorDraftStartReadiness', () => ({ getSurvivorDraftStartReadiness: m.readiness }))
vi.mock('@/lib/survivor/survivorCommissionerAlerts', () => ({ notifySurvivorCommissionerOnce: m.alert, SURVIVOR_SEATS_ALERT_LEAD_MS: 24 * 60 * 60 * 1000 }))

import { startScheduledSurvivorDrafts } from '@/lib/survivor/startScheduledSurvivorDrafts'

describe('scheduled Survivor draft start', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    m.due.mockResolvedValue([{ leagueId: 'league-1', league: { platform: 'allfantasy' } }])
    m.session.mockResolvedValue({ status: 'pre_draft', sessionKind: 'live', sleeperDraftId: null })
    m.pool.mockResolvedValue({ ready: true })
    m.start.mockResolvedValue({ ok: true })
    m.lock.mockImplementation(async (_leagueId: string, action: () => Promise<unknown>) =>
      ({ acquired: true, value: await action() }))
    m.notifyStart.mockResolvedValue(undefined)
    m.priorNotice.mockResolvedValue(null)
    m.league.mockResolvedValue({ userId: 'commish' })
    m.readiness.mockResolvedValue({ ready: true })
    m.alert.mockResolvedValue({ sent: true, notificationId: 'n' })
  })
  it('warns the commissioner a day ahead when a scheduled draft could not start, once per draft time', async () => {
    const now = new Date('2026-10-20T19:00:00Z')
    const draftDateUtc = new Date('2026-10-21T18:00:00Z')
    // First scan: nothing due. Second scan: tomorrow's draft, with a seat problem.
    m.due.mockResolvedValueOnce([]).mockResolvedValueOnce([{ leagueId: 'league-2', draftDateUtc, league: { platform: 'allfantasy' } }])
    m.session.mockResolvedValue({ status: 'pre_draft', sessionKind: 'live', sleeperDraftId: null, teamCount: 16, rounds: 12, slotOrder: [] })
    m.readiness.mockResolvedValueOnce({ ready: false, error: 'Claim all 2 open Survivor cast seats before starting the draft.' })
    await startScheduledSurvivorDrafts(now)
    expect(m.due.mock.calls[1][0].where.draftDateUtc).toEqual({ gt: now, lte: new Date('2026-10-21T19:00:00Z') })
    expect(m.alert).toHaveBeenCalledWith('league-2', 'seats_unclaimed_before_draft', expect.objectContaining({
      dedupeKey: draftDateUtc.toISOString(),
      body: expect.stringContaining('Claim all 2 open Survivor cast seats'),
      deepLinkPath: '/league/league-2/draft',
    }))
    expect(m.start).not.toHaveBeenCalled()
  })
  it('stays quiet a day ahead when every seat is claimed', async () => {
    m.due.mockResolvedValueOnce([]).mockResolvedValueOnce([{ leagueId: 'league-2', draftDateUtc: new Date('2026-10-21T18:00:00Z'), league: { platform: 'allfantasy' } }])
    m.session.mockResolvedValue({ status: 'pre_draft', sessionKind: 'live', sleeperDraftId: null, teamCount: 16, rounds: 12, slotOrder: [] })
    await startScheduledSurvivorDrafts(new Date('2026-10-20T19:00:00Z'))
    expect(m.alert).not.toHaveBeenCalled()
  })
  it('starts a due native live draft exactly once through the control lock', async () => {
    const now = new Date('2026-10-20T19:00:00Z')
    expect(await startScheduledSurvivorDrafts(now)).toMatchObject({ scanned: 1, started: 1, errors: [] })
    expect(m.due).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ autostart: true, draftDateUtc: { lte: now, gte: expect.any(Date) } }),
    }))
    expect(m.lock).toHaveBeenCalledWith('league-1', expect.any(Function))
    expect(m.start).toHaveBeenCalledOnce()
    expect(m.notifyStart).toHaveBeenCalledWith('league-1')
  })
  it('scans Guilly leagues as well as survivor leagues', async () => {
    await startScheduledSurvivorDrafts(new Date('2026-10-20T19:00:00Z'))
    expect(m.due.mock.calls[0][0].where.league).toEqual({
      is: { OR: [{ survivorMode: true }, { guillotineMode: true }, { leagueVariant: 'guillotine' }] },
    })
  })
  it('does not start a provider draft, a completed draft, or a cold player pool', async () => {
    m.due.mockResolvedValueOnce([{ leagueId: 'external', league: { platform: 'sleeper' } }])
    expect((await startScheduledSurvivorDrafts()).started).toBe(0)
    m.session.mockResolvedValueOnce({ status: 'completed' })
    expect((await startScheduledSurvivorDrafts()).started).toBe(0)
    m.pool.mockResolvedValueOnce({ ready: false })
    expect((await startScheduledSurvivorDrafts()).started).toBe(0)
    expect(m.prewarm).toHaveBeenCalledWith('league-1')
    expect(m.start).not.toHaveBeenCalled()
  })
  it('keeps a cast blocker retryable on a later tick', async () => {
    m.start.mockResolvedValueOnce({ ok: false, reason: 'SURVIVOR_CAST_INCOMPLETE', error: 'Claim every seat.' })
    expect(await startScheduledSurvivorDrafts()).toMatchObject({ started: 0, skipped: 1, errors: [] })
    expect(await startScheduledSurvivorDrafts()).toMatchObject({ started: 1, errors: [] })
  })
  it('tells the commissioner once why the scheduled draft is waiting', async () => {
    m.start.mockResolvedValue({ ok: false, reason: 'SURVIVOR_CAST_INCOMPLETE', error: 'Claim all 2 open Survivor cast seats before starting the draft.' })
    await startScheduledSurvivorDrafts()
    expect(m.enqueue).toHaveBeenCalledWith('league-1', 'draft_cast_incomplete', expect.objectContaining({
      recipientUserId: 'commish', body: expect.stringContaining('Claim all 2 open'),
    }))
    m.priorNotice.mockResolvedValue({ id: 'sent-already' })
    await startScheduledSurvivorDrafts()
    expect(m.enqueue).toHaveBeenCalledOnce()
    expect(m.notifyStart).not.toHaveBeenCalled()
  })
})
