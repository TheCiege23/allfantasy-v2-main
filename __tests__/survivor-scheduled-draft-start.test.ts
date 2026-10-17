import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  due: vi.fn(), session: vi.fn(), pool: vi.fn(), prewarm: vi.fn(), start: vi.fn(), lock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { leagueSettings: { findMany: m.due }, draftSession: { findFirst: m.session } },
}))
vi.mock('@/lib/draft-room/ensureDraftPoolReady', () => ({
  getDraftPoolReadiness: m.pool, triggerDraftPoolPrewarmBackground: m.prewarm,
}))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ startDraftSession: m.start }))
vi.mock('@/lib/draft/draftLock', () => ({ withControlLock: m.lock }))

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
  })
  it('starts a due native live draft exactly once through the control lock', async () => {
    const now = new Date('2026-10-20T19:00:00Z')
    expect(await startScheduledSurvivorDrafts(now)).toMatchObject({ scanned: 1, started: 1, errors: [] })
    expect(m.due).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ autostart: true, draftDateUtc: { lte: now, gte: expect.any(Date) } }),
    }))
    expect(m.lock).toHaveBeenCalledWith('league-1', expect.any(Function))
    expect(m.start).toHaveBeenCalledOnce()
  })
  it('scans guillotine leagues as well as survivor leagues', async () => {
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
})
